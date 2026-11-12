// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { db, initDb, pool } from '../src/db';
import { callAndStore, getResult } from '../src/results';
import {
  fileNameFor,
  filesForResult,
  findFileUrls,
  keepResultFiles,
  sendResultFile,
} from '../src/files';
import type { callOnBehalf } from '../src/proxy';

const DIR = mkdtempSync(path.join(tmpdir(), 'kiba-files-'));
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(500, 1)]);
const MP3 = Buffer.alloc(300, 2);

// Servidor "proveedor" (Meshy, Lyria, catálogo…) con archivos y casos que no deben copiarse.
let server: http.Server;
let origin = '';
let hits: string[] = [];

before(async () => {
  process.env.RESULT_FILES_DIR = DIR;
  process.env.PUBLIC_URL = 'https://api.kiba.test';
  process.env.X402_ALLOW_HTTP = '1';
  process.env.X402_ALLOW_PRIVATE = '1';
  process.env.RESULT_FILES = '1';
  process.env.RESULT_FILES_BUDGET_MS = '1500';
  await initDb();
  server = http.createServer((req, res) => {
    const u = req.url ?? '';
    hits.push(u);
    if (u.startsWith('/model.glb')) {
      res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': GLB.length });
      return res.end(GLB);
    }
    if (u.startsWith('/preview.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    if (u.startsWith('/download/abc')) {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      return res.end(MP3);
    }
    if (u.startsWith('/go')) {
      res.writeHead(302, { location: '/preview.png' });
      return res.end();
    }
    if (u.startsWith('/page')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html>no soy un archivo</html>');
    }
    if (u.startsWith('/slow.mp3')) return; // nunca responde: debe vencer el plazo, no colgar la llamada
    if (u.startsWith('/huge.zip')) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': 10 ** 12 });
      return res.end('x');
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await pool.end();
  rmSync(DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  hits = [];
  await db.exec(TRUNCATE_SQL);
});

async function createTestUser(email: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, balance_lamports, created_at)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', 0, now);
  return Number(result.lastInsertRowid);
}

async function openResult(id: string, userId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO call_results (id, user_id, service, payload, status, created_at) VALUES (?, ?, 'meshy', '{}', 'done', 1)`,
    )
    .run(id, userId);
}

function fakeCall(result: unknown): typeof callOnBehalf {
  return (async () => ({
    result,
    cost: { lamports: 1234, usd: 0.01 },
    mode: 'virtual',
    paidWith: 'credit',
    newBalance: { lamports: 0, usd: 0 },
    trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
  })) as unknown as typeof callOnBehalf;
}

// ─── Detección ───────────────────────────────────────────────────────────────

test('findFileUrls: modelo, miniatura, texturas y audio sí; la página raspada y sus enlaces no', () => {
  const meshy = {
    taskId: 't1',
    modelUrls: { glb: 'https://assets.meshy.ai/t1/output/model.glb?Expires=1&Signature=x' },
    thumbnailUrl: 'https://assets.meshy.ai/t1/output/preview.png?Expires=1',
    textureUrls: [{ base_color: 'https://assets.meshy.ai/t1/output/texture_0.png' }],
    next: 'Download it from https://assets.meshy.ai/t1/output/model.glb soon',
  };
  assert.deepEqual(
    findFileUrls(meshy).map((f) => f.keyPath),
    ['modelUrls.glb', 'thumbnailUrl', 'textureUrls.0.base_color'],
  );

  const lyria = { audioUrl: 'https://agent-lyria.kiba.tools/audio/0123456789abcdef01234567.mp3', expiresAt: 1 };
  assert.deepEqual(findFileUrls(lyria).map((f) => f.keyPath), ['audioUrl']);

  // Compra de medios: el enlace de descarga no lleva extensión pero la clave es inequívoca.
  const purchase = {
    asset: { id: 'p1', title: 'Beat' },
    downloadUrl: 'https://agent-catalog.kiba.tools/catalog/download/p1?exp=1&sig=2',
    assetUrl: 'https://agent-catalog.kiba.tools/catalog/download/p1?exp=1&sig=2',
    previewUrl: 'https://agent-catalog.kiba.tools/catalog/preview/p1',
    license: { documentUrl: 'https://api.kiba.tools/v1/licenses/l1/document' },
  };
  assert.deepEqual(findFileUrls(purchase).map((f) => f.keyPath), ['downloadUrl', 'assetUrl']);

  // web-scraper: la página (sin extensión), su markdown y la lista de enlaces no son archivos.
  const scraped = {
    url: 'https://www.youtube.com/results?search_query=x',
    markdown: '[img](https://i.ytimg.com/vi/a/hq720.jpg) https://y.test/b.glb',
    links: ['https://i.ytimg.com/vi/a/hq720.jpg', 'https://y.test/page'],
    metadata: { sourceURL: 'https://www.youtube.com/results?search_query=x' },
  };
  assert.deepEqual(findFileUrls(scraped), []);

  // Lo que ya es de Kiba no se vuelve a copiar.
  assert.deepEqual(findFileUrls({ modelUrls: { glb: 'https://api.kiba.test/v1/files/abc/model.glb' } }), []);
});

test('fileNameFor: nombre de la URL si lo tiene; si no, por la clave y el tipo', () => {
  assert.equal(fileNameFor('https://a.test/x/model.glb?sig=1', 'modelUrls.glb', 'model/gltf-binary'), 'model.glb');
  assert.equal(fileNameFor('https://c.test/catalog/download/p1?exp=1', 'downloadUrl', 'audio/mpeg'), 'p1.mp3');
  assert.equal(fileNameFor('https://c.test/dl', 'downloadUrl', 'application/octet-stream'), 'dl');
  assert.equal(fileNameFor('https://c.test/', 'textureUrls.0.base_color', 'image/png'), 'base_color.png');
  assert.equal(fileNameFor('https://c.test/a%20b.PNG', 'thumbnailUrl', 'image/png'), 'a_b.PNG');
});

// ─── Copia ───────────────────────────────────────────────────────────────────

test('keepResultFiles: copia los archivos, reescribe sus enlaces y deja igual lo que no se pudo copiar', async () => {
  const userId = await createTestUser('files@test.com');
  await openResult('res_files1', userId);
  const original = {
    modelUrls: { glb: `${origin}/model.glb?Expires=1&Signature=x` },
    thumbnailUrl: `${origin}/go`, // 302 → /preview.png
    textureUrls: [{ base_color: `${origin}/page` }], // HTML: no es un archivo
    extra: { downloadUrl: `${origin}/huge.zip` }, // demasiado grande (content-length)
    audioUrl: `${origin}/missing.mp3`, // 404
    next: `Download ${origin}/model.glb?Expires=1&Signature=x`,
  };
  const kept = await keepResultFiles({ resultId: 'res_files1', userId, result: original });
  assert.equal(kept.files.length, 2);
  const r = kept.result as typeof original;
  assert.match(r.modelUrls.glb, /^https:\/\/api\.kiba\.test\/v1\/files\/[0-9a-f]{32}\/model\.glb$/);
  assert.match(r.thumbnailUrl, /^https:\/\/api\.kiba\.test\/v1\/files\/[0-9a-f]{32}\/preview\.png$/);
  assert.equal(r.textureUrls[0].base_color, original.textureUrls[0].base_color);
  assert.equal(r.extra.downloadUrl, original.extra.downloadUrl);
  assert.equal(r.audioUrl, original.audioUrl);
  // Solo se reescriben los valores que SON el enlace; un texto que lo contiene queda igual.
  assert.equal(r.next, original.next);
  // La respuesta original no se muta.
  assert.match(original.modelUrls.glb, /^http:\/\/127\.0\.0\.1/);

  const rows = await filesForResult('res_files1');
  assert.deepEqual(
    rows.map((x) => [x.key_path, x.name, x.content_type, Number(x.bytes)]).sort(),
    [
      ['modelUrls.glb', 'model.glb', 'model/gltf-binary', GLB.length],
      ['thumbnailUrl', 'preview.png', 'image/png', PNG.length],
    ].sort(),
  );
  const glb = rows.find((x) => x.key_path === 'modelUrls.glb')!;
  assert.ok(readFileSync(path.join(DIR, glb.id)).equals(GLB));
  assert.equal(glb.sha256, createHash('sha256').update(GLB).digest('hex'));
  assert.equal(glb.source_url, original.modelUrls.glb);
  assert.equal(Number(glb.user_id), userId);
  // No quedan archivos a medias de los que fallaron.
  assert.deepEqual(
    readdirSorted(DIR),
    rows.map((x) => x.id).sort(),
  );
});

function readdirSorted(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('node:fs') as typeof import('node:fs')).readdirSync(dir).sort();
}

test('keepResultFiles: la misma URL en dos claves se descarga y guarda una sola vez', async () => {
  const userId = await createTestUser('dedupe@test.com');
  await openResult('res_files2', userId);
  const url = `${origin}/download/abc?exp=1&sig=2`;
  const kept = await keepResultFiles({
    resultId: 'res_files2',
    userId,
    result: { asset: { id: 'abc' }, downloadUrl: url, assetUrl: url },
  });
  assert.equal(kept.files.length, 1);
  assert.equal(hits.filter((h) => h.startsWith('/download/abc')).length, 1);
  const r = kept.result as { downloadUrl: string; assetUrl: string };
  assert.equal(r.downloadUrl, r.assetUrl);
  assert.match(r.downloadUrl, /\/v1\/files\/[0-9a-f]{32}\/abc\.mp3$/);
});

test('keepResultFiles: un proveedor que no responde agota el plazo y no retiene la llamada', async () => {
  const userId = await createTestUser('slow@test.com');
  await openResult('res_files6', userId);
  const t0 = Date.now();
  const kept = await keepResultFiles({
    resultId: 'res_files6',
    userId,
    result: { audioUrl: `${origin}/slow.mp3`, thumbnailUrl: `${origin}/preview.png` },
  });
  // El plazo por resultado (RESULT_FILES_BUDGET_MS=1500 en este proceso) corta la lenta; la rápida sí se copia.
  assert.ok(Date.now() - t0 < 5000, 'la copia no debe esperar más que el plazo');
  assert.equal(kept.files.length, 1);
  const r = kept.result as { audioUrl: string; thumbnailUrl: string };
  assert.equal(r.audioUrl, `${origin}/slow.mp3`);
  assert.match(r.thumbnailUrl, /\/v1\/files\/[0-9a-f]{32}\/preview\.png$/);
});

test('keepResultFiles: sin archivos no toca la respuesta ni la base de datos', async () => {
  const userId = await createTestUser('none@test.com');
  await openResult('res_files3', userId);
  const result = { ok: true, url: 'https://example.com/page' };
  const kept = await keepResultFiles({ resultId: 'res_files3', userId, result });
  assert.equal(kept.result, result);
  assert.deepEqual(await filesForResult('res_files3'), []);
  assert.deepEqual(hits, []);
});

test('keepResultFiles: no descarga de redes privadas si no está permitido (anti-SSRF)', async () => {
  const userId = await createTestUser('ssrf@test.com');
  await openResult('res_files4', userId);
  delete process.env.X402_ALLOW_PRIVATE;
  try {
    const kept = await keepResultFiles({
      resultId: 'res_files4',
      userId,
      result: { modelUrls: { glb: `${origin}/model.glb` } },
    });
    assert.equal(kept.files.length, 0);
    assert.equal((kept.result as { modelUrls: { glb: string } }).modelUrls.glb, `${origin}/model.glb`);
    assert.deepEqual(hits, []);
  } finally {
    process.env.X402_ALLOW_PRIVATE = '1';
  }
});

// ─── Integración con el almacén de resultados ───────────────────────────────

test('callAndStore: la respuesta y el resultado guardado enlazan a Kiba y llevan `files`', async () => {
  const userId = await createTestUser('store@test.com');
  const out = await callAndStore(
    { userId, service: 'meshy', payload: { taskId: 't' }, waitMs: 5000 },
    fakeCall({ taskId: 't', status: 'SUCCEEDED', modelUrls: { glb: `${origin}/model.glb` } }),
  );
  assert.equal(out.status, 'done');
  if (out.status !== 'done') return;
  const result = out.result as { modelUrls: { glb: string } };
  assert.match(result.modelUrls.glb, /^https:\/\/api\.kiba\.test\/v1\/files\/[0-9a-f]{32}\/model\.glb$/);
  assert.equal(out.files?.length, 1);
  assert.equal(out.files?.[0].url, result.modelUrls.glb);
  assert.equal(out.files?.[0].name, 'model.glb');
  assert.equal(out.files?.[0].bytes, GLB.length);

  const row = await getResult(userId, out.resultId);
  assert.equal(JSON.parse(row!.result!).modelUrls.glb, result.modelUrls.glb);
  const files = await filesForResult(out.resultId);
  assert.equal(files.length, 1);
  assert.equal(files[0].result_id, out.resultId);
});

// ─── Servir ──────────────────────────────────────────────────────────────────

test('GET /v1/files/:id/:name sirve el archivo con su tipo y nombre; 404 si no existe', async () => {
  const userId = await createTestUser('serve@test.com');
  await openResult('res_files5', userId);
  const kept = await keepResultFiles({
    resultId: 'res_files5',
    userId,
    result: { modelUrls: { glb: `${origin}/model.glb` } },
  });
  const file = kept.files[0];

  const app = express();
  app.get('/v1/files/:id/:name?', (req, res) =>
    void sendResultFile(req.params.id, res, { download: req.query.download === '1' }),
  );
  const srv = await new Promise<http.Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    const ok = await fetch(`${base}/v1/files/${file.id}/model.glb`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'model/gltf-binary');
    assert.match(ok.headers.get('content-disposition') ?? '', /inline; filename="model\.glb"/);
    assert.equal(ok.headers.get('content-length'), String(GLB.length));
    assert.ok(Buffer.from(await ok.arrayBuffer()).equals(GLB));

    // Sin nombre también sirve (el nombre va en Content-Disposition).
    assert.equal((await fetch(`${base}/v1/files/${file.id}`)).status, 200);

    // ?download=1 fuerza la descarga (el botón del dashboard, entre dominios).
    const dl = await fetch(`${base}/v1/files/${file.id}/model.glb?download=1`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition') ?? '', /^attachment; filename="model\.glb"/);

    const missing = await fetch(`${base}/v1/files/${'0'.repeat(32)}/x.glb`);
    assert.equal(missing.status, 404);
    const bad = await fetch(`${base}/v1/files/..%2F..%2Fetc%2Fpasswd`);
    assert.equal(bad.status, 404);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
