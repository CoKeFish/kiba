/**
 * lyria-core — lógica del wrapper de Google Lyria (generación de música), SIN dependencias
 * del SDK ni de express y SIN efectos de arranque (no abre puertos, no lee env al importar).
 *
 * Igual que meshy-core / firecrawl-core: aquí vive toda la superficie "real" del agente
 * (normalización del request, pricing, llamada HTTP, extracción del audio y almacenamiento)
 * para testearla de forma determinista (test/lyria.test.ts). lyria.ts arma la config desde
 * el entorno, sirve los archivos de audio y delega en {@link generate}.
 *
 * Lyria es SÍNCRONO: una petición devuelve el MP3 completo (base64, varios MB) en ~40-60 s.
 * Como eso no cabe en una respuesta MCP, el agente guarda el archivo en disco (con caducidad)
 * y devuelve un enlace de descarga en su propio endpoint público (/audio/<id>.mp3).
 */
import type { LicenseGrant } from 'kiba-sdk';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LyriaFormat = 'song' | 'clip';

export interface LyriaRequest {
  /** Descripción de la música (sinónimos: text, description, query, input). */
  prompt?: string;
  /** 'song' (canción completa, hasta ~3 min) | 'clip' (30 s). Default song. */
  format?: LyriaFormat;
  /** true → sin voz (sinónimo: noVocals). */
  instrumental?: boolean;
  /** Letra propia para que la cante (sinónimo: letra). */
  lyrics?: string;
}

export interface LyriaResult {
  id: string;
  format: LyriaFormat;
  model: string;
  /** Enlace de descarga del MP3 (caduca; ver expiresAt). */
  audioUrl: string;
  mimeType: string;
  bytes: number;
  /** Duración aproximada en segundos (estimada por el bitrate). */
  approxDurationSec: number;
  /** Letra y estructura devueltas por Lyria (si las hay). */
  lyrics?: string;
  /** Epoch ms hasta el que el enlace sigue disponible. */
  expiresAt: number;
  /** Licencia del archivo entregado (hash + términos); el gateway emite la credencial. */
  license?: LicenseGrant;
  /** Qué hacer a continuación (pensado para el asistente que llama). */
  next: string;
}

/** Config de runtime del wrapper (la arma lyria.ts desde el entorno). */
export interface LyriaConfig {
  /** API key de Gemini (REQUERIDA; Lyria exige proyecto con facturación). */
  apiKey: string;
  /** Base URL de la API (default https://generativelanguage.googleapis.com). */
  baseUrl: string;
  /** Timeout de la petición a Lyria en ms (una canción tarda ~40-60 s). */
  timeoutMs: number;
  /** Carpeta local donde se guardan los MP3 generados. */
  audioDir: string;
  /** URL pública del agente; los enlaces se construyen como <publicBaseUrl>/audio/<archivo>. */
  publicBaseUrl: string;
  /** Vida de cada archivo en ms (después se borra y el enlace deja de funcionar). */
  ttlMs: number;
}

// Pricing (USDC). Referencia: Google cobra 0.04 USD por clip de 30 s y 0.08 USD por canción
// completa (nivel de pago, sin free tier); el precio de Kiba = coste + margen.
export const PRICE_CLIP_USDC = 0.05; // floor on-chain
export const PRICE_SONG_USDC = 0.1;

export const MODEL_SONG = 'lyria-3.5';
export const MODEL_CLIP = 'lyria-3-clip-preview';

/** Tope del prompt que mandamos a Lyria (prompt + letra). */
export const MAX_INPUT_CHARS = 4_000;

export interface NormalizedRequest {
  prompt: string;
  format: LyriaFormat;
  instrumental: boolean;
  lyrics: string;
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'si' || s === 'sí';
}

/** Request normalizado: los LLMs adivinan los nombres de campo, así que aceptamos sinónimos. */
export function normalizeRequest(req: unknown): NormalizedRequest {
  const r = (req ?? {}) as Record<string, unknown>;
  const fmt = str(r.format ?? r.mode ?? r.type ?? r.length ?? r.duration).toLowerCase();
  const isClip = ['clip', 'short', '30s', '30', 'preview', 'jingle'].includes(fmt);
  return {
    prompt: str(r.prompt ?? r.text ?? r.description ?? r.query ?? r.input ?? r.song),
    format: isClip ? 'clip' : 'song',
    instrumental: truthy(r.instrumental) || truthy(r.noVocals) || truthy(r.no_vocals),
    lyrics: str(r.lyrics ?? r.letra),
  };
}

/** Precio (USDC) para esta request. Determinista en el payload (el 402 y el cobro deben coincidir). */
export function priceFor(req: unknown): number {
  const n = normalizeRequest(req);
  return n.format === 'clip' ? PRICE_CLIP_USDC : PRICE_SONG_USDC;
}

/** Texto que se manda a Lyria: prompt + letra propia + nota de instrumental. Lanza si falta el prompt. */
export function buildInput(n: NormalizedRequest): string {
  if (!n.prompt) {
    throw new Error("missing 'prompt' — describe the music to generate (style, mood, instruments, language)");
  }
  let input = n.prompt;
  if (n.lyrics) input += `\n\nUse exactly these lyrics:\n${n.lyrics}`;
  if (n.instrumental) input += '\n\nInstrumental only, no vocals.';
  if (input.length > MAX_INPUT_CHARS) {
    throw new Error(`prompt too long — keep prompt plus lyrics under ${MAX_INPUT_CHARS} characters`);
  }
  return input;
}

/** Body para POST /v1beta/interactions. */
export function buildBody(n: NormalizedRequest): { model: string; input: string } {
  return { model: n.format === 'clip' ? MODEL_CLIP : MODEL_SONG, input: buildInput(n) };
}

/** Llamada HTTP a Lyria con auth, timeout y errores legibles. */
export async function callLyria(
  config: LyriaConfig,
  body: { model: string; input: string },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(config.baseUrl.replace(/\/+$/, '') + '/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    const msg = ((json?.error as { message?: string } | undefined)?.message ?? text).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Google rejected the API key (${res.status}) — check GEMINI_API_KEY`);
    }
    if (res.status === 429) {
      throw new Error(`Lyria rate limit or tier limit (429): ${msg}`);
    }
    if (res.status >= 400) throw new Error(`Lyria error ${res.status}: ${msg}`);
    if (!json) throw new Error('Lyria returned an empty or non-JSON response');
    return json;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Lyria did not answer within ${config.timeoutMs} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Saca el audio (base64) y la letra de la respuesta de /interactions (steps[].content[]). */
export function extractOutput(json: Record<string, unknown>): {
  audio: Buffer;
  mimeType: string;
  lyrics?: string;
} {
  const items: Array<Record<string, unknown>> = [];
  for (const step of (json.steps as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const c of (step.content as Array<Record<string, unknown>> | undefined) ?? []) items.push(c);
  }
  const audioItem = items.find((c) => typeof c.data === 'string' && (c.data as string).length > 0);
  if (!audioItem) throw new Error('Lyria returned no audio');
  const mimeType = str(audioItem.mime_type ?? audioItem.mimeType) || 'audio/mpeg';
  const lyrics = items
    .filter((c) => typeof c.text === 'string' && (c.text as string).trim())
    .map((c) => (c.text as string).trim())
    .join('\n\n');
  return { audio: Buffer.from(audioItem.data as string, 'base64'), mimeType, ...(lyrics ? { lyrics } : {}) };
}

export function extensionFor(mimeType: string): string {
  return /wav/i.test(mimeType) ? 'wav' : /ogg/i.test(mimeType) ? 'ogg' : 'mp3';
}

/** Nombre de archivo seguro (sin rutas): 24 hex + extensión conocida. */
export function isSafeName(name: string): boolean {
  return /^[a-f0-9]{24}\.(mp3|wav|ogg)$/.test(name);
}

/** Guarda el audio en audioDir con un id aleatorio y devuelve el nombre del archivo. */
export async function storeAudio(config: LyriaConfig, audio: Buffer, mimeType: string): Promise<string> {
  await fs.mkdir(config.audioDir, { recursive: true });
  const name = `${randomBytes(12).toString('hex')}.${extensionFor(mimeType)}`;
  await fs.writeFile(path.join(config.audioDir, name), audio);
  return name;
}

/** Borra los archivos más viejos que ttlMs. Devuelve cuántos borró. */
export async function sweepExpired(config: LyriaConfig, now = Date.now()): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await fs.readdir(config.audioDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!isSafeName(name)) continue;
    const file = path.join(config.audioDir, name);
    try {
      const st = await fs.stat(file);
      if (now - st.mtimeMs > config.ttlMs) {
        await fs.unlink(file);
        removed += 1;
      }
    } catch {
      /* ya no existe */
    }
  }
  return removed;
}

/** Duración aproximada (s) de un MP3 CBR de 192 kbps (lo que devuelve Lyria). */
export function approxDurationSec(bytes: number, mimeType: string): number {
  if (!/mp3|mpeg/i.test(mimeType)) return 0;
  return Math.round((bytes * 8) / 192_000);
}

/** Handler completo del servicio. */
export async function generate(config: LyriaConfig, req: unknown): Promise<LyriaResult> {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY is not configured on this service');
  const n = normalizeRequest(req);
  const body = buildBody(n);
  const json = await callLyria(config, body);
  const { audio, mimeType, lyrics } = extractOutput(json);
  const name = await storeAudio(config, audio, mimeType);
  const expiresAt = Date.now() + config.ttlMs;
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return {
    id: name.replace(/\.[a-z0-9]+$/, ''),
    format: n.format,
    model: body.model,
    audioUrl: `${base}/audio/${name}`,
    mimeType,
    bytes: audio.length,
    approxDurationSec: approxDurationSec(audio.length, mimeType),
    ...(lyrics ? { lyrics } : {}),
    expiresAt,
    license: {
      assetSha256: createHash('sha256').update(audio).digest('hex'),
      assetId: name.replace(/\.[a-z0-9]+$/, ''),
      title: n.prompt.slice(0, 120),
      filename: name,
      mimeType,
      bytes: audio.length,
      assetUrl: `${base}/audio/${name}`,
    },
    next:
      `Give the user the audioUrl link to listen or download (${extensionFor(mimeType).toUpperCase()}). ` +
      `The link expires in ${Math.round(config.ttlMs / 3_600_000)} h. Lyrics are in \`lyrics\`.`,
  };
}
