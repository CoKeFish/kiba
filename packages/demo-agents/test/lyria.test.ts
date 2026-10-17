/**
 * Tests del agente Lyria (music-generator). El agente es un wrapper sobre la API de Lyria
 * (Gemini /v1beta/interactions), así que probamos lo que puede romperse sin gastar dinero:
 *
 *   1. Normalización del request (sinónimos), pricing y construcción del input/body (puro).
 *   2. Extracción del audio y la letra de la respuesta de Lyria (steps/content).
 *   3. El wrapper completo (generate) contra un Lyria FALSO local: guarda el MP3 en un dir
 *      temporal, devuelve audioUrl/lyrics, manda la API key en el header y mapea errores
 *      (403/429). Más la caducidad de archivos (sweepExpired) y el filtro de nombres seguros.
 *
 * Correr:  npm test            (dentro de packages/demo-agents)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import {
  normalizeRequest,
  priceFor,
  buildInput,
  buildBody,
  extractOutput,
  isSafeName,
  storeAudio,
  sweepExpired,
  approxDurationSec,
  generate,
  PRICE_CLIP_USDC,
  PRICE_SONG_USDC,
  MODEL_SONG,
  MODEL_CLIP,
  MAX_INPUT_CHARS,
  type LyriaConfig,
} from '../src/lyria-core';

// ─── 1. normalizeRequest / priceFor / buildInput (puro) ───────────────────────

test('normalizeRequest: sinónimos, formato y flags', () => {
  for (const key of ['prompt', 'text', 'description', 'query', 'input', 'song']) {
    assert.equal(normalizeRequest({ [key]: ' lo-fi beat ' }).prompt, 'lo-fi beat', `sinónimo ${key}`);
  }
  assert.equal(normalizeRequest({ prompt: 'x' }).format, 'song');
  for (const v of ['clip', 'short', '30s', 'jingle']) {
    assert.equal(normalizeRequest({ prompt: 'x', format: v }).format, 'clip', `format ${v}`);
  }
  assert.equal(normalizeRequest({ prompt: 'x', type: 'clip' }).format, 'clip');
  assert.equal(normalizeRequest({ prompt: 'x', instrumental: 'true' }).instrumental, true);
  assert.equal(normalizeRequest({ prompt: 'x', noVocals: true }).instrumental, true);
  assert.equal(normalizeRequest({ prompt: 'x', letra: 'la la' }).lyrics, 'la la');
});

test('priceFor: clip vs canción; floor para requests vacías', () => {
  assert.equal(priceFor({ prompt: 'x' }), PRICE_SONG_USDC);
  assert.equal(priceFor({ prompt: 'x', format: 'clip' }), PRICE_CLIP_USDC);
  assert.equal(priceFor({}), PRICE_SONG_USDC);
  assert.ok(PRICE_CLIP_USDC < PRICE_SONG_USDC, 'el floor on-chain es el clip');
});

test('buildInput / buildBody: prompt, letra, instrumental, modelo y límites', () => {
  assert.throws(() => buildInput(normalizeRequest({})), /missing 'prompt'/);
  const plain = buildBody(normalizeRequest({ prompt: 'a calm piano piece' }));
  assert.deepEqual(plain, { model: MODEL_SONG, input: 'a calm piano piece' });
  const clip = buildBody(normalizeRequest({ prompt: 'jingle', format: 'clip' }));
  assert.equal(clip.model, MODEL_CLIP);
  const rich = buildInput(normalizeRequest({ prompt: 'pop', lyrics: 'la la la', instrumental: true }));
  assert.match(rich, /^pop\n\nUse exactly these lyrics:\nla la la\n\nInstrumental only, no vocals\.$/);
  assert.throws(() => buildInput(normalizeRequest({ prompt: 'x'.repeat(MAX_INPUT_CHARS + 1) })), /too long/);
});

// ─── 2. extractOutput / helpers ───────────────────────────────────────────────

const AUDIO = Buffer.from('ID3fake-mp3-bytes-for-tests');

function fakeResponse(opts: { lyrics?: string; audio?: Buffer; mime?: string } = {}) {
  const steps: unknown[] = [];
  if (opts.lyrics !== undefined) steps.push({ type: 'model_output', content: [{ type: 'text', text: opts.lyrics }] });
  steps.push({
    type: 'model_output',
    content: [{ type: 'audio', mime_type: opts.mime ?? 'audio/mpeg', data: (opts.audio ?? AUDIO).toString('base64') }],
  });
  return { id: 'int-1', status: 'completed', model: MODEL_SONG, steps };
}

test('extractOutput: audio base64 + letra; sin audio → error', () => {
  const out = extractOutput(fakeResponse({ lyrics: '[Verse]\nhola' }));
  assert.ok(out.audio.equals(AUDIO));
  assert.equal(out.mimeType, 'audio/mpeg');
  assert.equal(out.lyrics, '[Verse]\nhola');
  const noLyrics = extractOutput(fakeResponse());
  assert.equal(noLyrics.lyrics, undefined);
  assert.throws(() => extractOutput({ steps: [{ content: [{ type: 'text', text: 'only text' }] }] }), /no audio/);
});

test('isSafeName / approxDurationSec', () => {
  assert.equal(isSafeName('0123456789abcdef01234567.mp3'), true);
  assert.equal(isSafeName('../etc/passwd'), false);
  assert.equal(isSafeName('0123456789abcdef01234567.exe'), false);
  assert.equal(isSafeName('ABCDEF.mp3'), false);
  assert.equal(approxDurationSec(192_000 * 10, 'audio/mpeg'), 10 * 8); // 10 s × 8 bits… 1.92 MB ≈ 80 s a 192 kbps
  assert.equal(approxDurationSec(1000, 'audio/wav'), 0);
});

// ─── 3. generate contra un Lyria falso ────────────────────────────────────────

interface FakeLyria {
  config: LyriaConfig;
  seen: Array<{ path: string; key?: string; body: unknown }>;
  close: () => Promise<void>;
}

async function startFakeLyria(opts: { status?: number; lyrics?: string } = {}): Promise<FakeLyria> {
  const seen: FakeLyria['seen'] = [];
  const audioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyria-test-'));
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ path: req.url!, key: req.headers['x-goog-api-key'] as string, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(opts.status ?? 200, { 'content-type': 'application/json' });
      if (opts.status && opts.status >= 400) {
        res.end(JSON.stringify({ error: { message: 'limit: 0 requests per day on Free Tier', code: 'too_many_requests' } }));
        return;
      }
      res.end(JSON.stringify(fakeResponse({ lyrics: opts.lyrics ?? '[Chorus]\nlo pago con Kiba' })));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        seen,
        config: {
          apiKey: 'AQ.test',
          baseUrl: `http://127.0.0.1:${port}`,
          timeoutMs: 2_000,
          audioDir,
          publicBaseUrl: 'https://agent-lyria.example/',
          ttlMs: 60_000,
        },
        close: async () => {
          await new Promise<void>((r) => server.close(() => r()));
          await fs.rm(audioDir, { recursive: true, force: true });
        },
      });
    });
  });
}

test('generate: llama a Lyria con la key, guarda el MP3 y devuelve enlace + letra', async () => {
  const fake = await startFakeLyria();
  try {
    const out = await generate(fake.config, { prompt: 'pop alegre en español', format: 'clip' });
    assert.equal(fake.seen.length, 1);
    assert.equal(fake.seen[0].path, '/v1beta/interactions');
    assert.equal(fake.seen[0].key, 'AQ.test');
    assert.deepEqual(fake.seen[0].body, { model: MODEL_CLIP, input: 'pop alegre en español' });
    assert.equal(out.format, 'clip');
    assert.equal(out.model, MODEL_CLIP);
    assert.match(out.audioUrl, /^https:\/\/agent-lyria\.example\/audio\/[a-f0-9]{24}\.mp3$/);
    assert.equal(out.bytes, AUDIO.length);
    assert.equal(out.lyrics, '[Chorus]\nlo pago con Kiba');
    assert.ok(out.expiresAt > Date.now());
    const name = out.audioUrl.split('/').pop()!;
    assert.ok(isSafeName(name));
    const stored = await fs.readFile(path.join(fake.config.audioDir, name));
    assert.ok(stored.equals(AUDIO), 'el archivo guardado es el audio devuelto por Lyria');
  } finally {
    await fake.close();
  }
});

test('generate: errores legibles (429 tier, 403 key, sin key)', async () => {
  const tier = await startFakeLyria({ status: 429 });
  try {
    await assert.rejects(generate(tier.config, { prompt: 'x' }), /429.*Free Tier/);
    await assert.rejects(generate({ ...tier.config, apiKey: '' }, { prompt: 'x' }), /GEMINI_API_KEY/);
  } finally {
    await tier.close();
  }
  const forbidden = await startFakeLyria({ status: 403 });
  try {
    await assert.rejects(generate(forbidden.config, { prompt: 'x' }), /API key \(403\)/);
  } finally {
    await forbidden.close();
  }
});

test('sweepExpired: borra solo los archivos caducados con nombre seguro', async () => {
  const audioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyria-sweep-'));
  const config: LyriaConfig = { apiKey: 'k', baseUrl: 'http://x', timeoutMs: 1, audioDir, publicBaseUrl: 'http://x', ttlMs: 1_000 };
  try {
    const old = await storeAudio(config, AUDIO, 'audio/mpeg');
    const fresh = await storeAudio(config, AUDIO, 'audio/mpeg');
    await fs.writeFile(path.join(audioDir, 'keep.txt'), 'no es audio');
    const past = new Date(Date.now() - 10_000);
    await fs.utimes(path.join(audioDir, old), past, past);
    const removed = await sweepExpired(config);
    assert.equal(removed, 1);
    const left = (await fs.readdir(audioDir)).sort();
    assert.deepEqual(left, [fresh, 'keep.txt'].sort());
  } finally {
    await fs.rm(audioDir, { recursive: true, force: true });
  }
});
