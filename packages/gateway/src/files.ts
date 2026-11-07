/**
 * Archivos de resultados.
 *
 * Los servicios entregan archivos (modelos 3D, texturas, miniaturas, audio, medios comprados)
 * como enlaces a su proveedor o a su propio servidor, y esos enlaces caducan: Meshy borra los
 * modelos a los 3 días, el agente de Lyria sus MP3 a las 24 h. Para que el almacén de
 * resultados guarde el archivo y no solo "dónde estaba", al completarse una llamada el gateway
 * descarga los archivos que trae la respuesta, los guarda en RESULT_FILES_DIR (un volumen) y
 * reescribe los enlaces a URLs propias (/v1/files/<id>/<nombre>) que no caducan. Si un archivo
 * no se puede copiar (tamaño, red, tipo), su enlace original se deja tal cual.
 *
 * Qué cuenta como archivo: una cadena de la respuesta que sea una sola URL http(s) y cuya clave
 * lo indique — fuerte (download, audio, model, texture, asset, file, media, thumbnail) o, si la
 * ruta lleva una extensión de archivo conocida, débil (url, href, src, link, image…). La página
 * raspada por el web-scraper (`url`, sin extensión) o la lista de enlaces de una página
 * (`links`) no cuentan.
 *
 * Los enlaces servidos son públicos con el id (16 bytes aleatorios), igual que los enlaces
 * firmados que sustituyen: el asistente los pone en el chat y el usuario los abre sin iniciar
 * sesión. Las descargas pasan por el mismo filtro anti-SSRF que el proxy x402.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { db } from './db';
import { assertAllowedUrl } from './net-guard';

export const MAX_FILES_PER_RESULT = 16;
export const MAX_FILE_BYTES = (Number(process.env.RESULT_FILES_MAX_MB) || 64) * 1024 * 1024;
export const MAX_RESULT_BYTES = MAX_FILE_BYTES * 4;
/**
 * Tiempo máximo que una llamada espera por sus copias: las descargas van en paralelo y lo que
 * no haya terminado al vencer conserva su enlace original (la respuesta no se retiene más).
 */
function budgetMs(): number {
  return Number(process.env.RESULT_FILES_BUDGET_MS) || 20_000;
}
const MAX_REDIRECTS = 3;

/** RESULT_FILES=0 apaga la copia (kill-switch; los tests del almacén lo usan). */
function enabled(): boolean {
  return process.env.RESULT_FILES !== '0';
}

export interface ResultFileRow {
  id: string;
  result_id: string;
  user_id: number;
  /** Dónde estaba el enlace en la respuesta (p.ej. `modelUrls.glb`, `textureUrls.0.base_color`). */
  key_path: string;
  name: string;
  content_type: string;
  bytes: number;
  sha256: string;
  source_url: string;
  created_at: number;
}

export interface FoundFile {
  keyPath: string;
  url: string;
}

// ─── Dónde viven ─────────────────────────────────────────────────────────────

/** En Docker el cwd es /app/packages/gateway y el volumen /app/data → /app/data/files. */
export function filesDir(): string {
  return process.env.RESULT_FILES_DIR || path.resolve(process.cwd(), '../../data/files');
}

export function filePath(id: string): string {
  return path.join(filesDir(), id);
}

export async function initFilesDir(): Promise<void> {
  await mkdir(filesDir(), { recursive: true });
}

function publicBase(): string {
  return (process.env.PUBLIC_URL || 'http://localhost:8000').replace(/\/+$/, '');
}

export function fileUrl(id: string, name: string): string {
  return `${publicBase()}/v1/files/${id}/${encodeURIComponent(name)}`;
}

// ─── Qué enlaces de una respuesta son archivos ──────────────────────────────

const FILE_EXT =
  /\.(glb|gltf|fbx|obj|mtl|usdz|stl|3mf|zip|mp3|wav|ogg|m4a|flac|mp4|webm|png|jpe?g|webp|gif|svg|otf|ttf|woff2?|pdf)$/i;
const STRONG_KEY = /download|audio|model|texture|asset|file|media|thumbnail/i;
const WEAK_LAST_KEY = /(url|href|src|link|image|photo|picture|cover)$/i;

function isFileLink(segments: string[], value: string): boolean {
  if (value.length > 2048 || /\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  if (value.startsWith(`${publicBase()}/v1/files/`)) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (segments.some((s) => STRONG_KEY.test(s))) return true;
  const last = segments[segments.length - 1] ?? '';
  return WEAK_LAST_KEY.test(last) && FILE_EXT.test(u.pathname);
}

/** Los enlaces a archivos de una respuesta, con la clave donde aparecen (en orden). */
export function findFileUrls(result: unknown): FoundFile[] {
  const out: FoundFile[] = [];
  const walk = (value: unknown, segments: string[]) => {
    if (typeof value === 'string') {
      if (segments.length > 0 && isFileLink(segments, value)) out.push({ keyPath: segments.join('.'), url: value });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, [...segments, String(i)]));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, [...segments, k]);
    }
  };
  walk(result, []);
  return out;
}

/** La misma respuesta con cada cadena igual a un enlace copiado sustituida por su URL en Kiba. */
function rewrite(value: unknown, replace: (s: string) => string): unknown {
  if (typeof value === 'string') return replace(value);
  if (Array.isArray(value)) return value.map((v) => rewrite(v, replace));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, replace);
    return out;
  }
  return value;
}

// ─── Nombre y tipo ───────────────────────────────────────────────────────────

const EXT_TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/octet-stream',
  obj: 'model/obj',
  mtl: 'model/mtl',
  usdz: 'model/vnd.usdz+zip',
  stl: 'model/stl',
  '3mf': 'model/3mf',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  pdf: 'application/pdf',
};

function extOfType(contentType: string): string | undefined {
  if (contentType === 'application/octet-stream') return undefined;
  return Object.keys(EXT_TYPES).find((ext) => EXT_TYPES[ext] === contentType);
}

/** Nombre de archivo para servirlo: el de la URL si lo tiene; si no, por la clave y el tipo. */
export function fileNameFor(url: string, keyPath: string, contentType: string): string {
  let base = '';
  try {
    base = decodeURIComponent(path.posix.basename(new URL(url).pathname));
  } catch {
    base = '';
  }
  base = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 80);
  const ext = path.posix.extname(base).slice(1).toLowerCase();
  if (base && ext && EXT_TYPES[ext]) return base;
  const typeExt = extOfType(contentType);
  const stem = base || keyPath.split('.').filter((s) => !/^\d+$/.test(s)).pop() || 'file';
  return typeExt ? `${stem}.${typeExt}` : stem;
}

function typeFor(headerType: string, url: string): string {
  const ct = headerType.split(';')[0].trim().toLowerCase();
  if (ct && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream') return ct;
  let ext = '';
  try {
    ext = path.posix.extname(new URL(url).pathname).slice(1).toLowerCase();
  } catch {
    ext = '';
  }
  return EXT_TYPES[ext] ?? (ct || 'application/octet-stream');
}

// ─── Descarga ────────────────────────────────────────────────────────────────

interface Downloaded {
  bytes: number;
  sha256: string;
  contentType: string;
  /** La URL final tras redirecciones (de ella sale el nombre del archivo). */
  finalUrl: string;
}

/** Descarga `url` a `dest` con tope de tamaño, plazo y redirecciones revalidadas (anti-SSRF). */
async function download(url: string, dest: string, deadline: AbortSignal): Promise<Downloaded> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertAllowedUrl(current);
    const ctrl = new AbortController();
    const signal = AbortSignal.any([ctrl.signal, deadline]);
    try {
      const res = await fetch(u, { redirect: 'manual', signal, headers: { accept: '*/*' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw new Error(`redirección ${res.status} sin Location`);
        current = new URL(loc, u).href;
        continue;
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${res.status}`);
      }
      const headerType = res.headers.get('content-type') || '';
      const ct = headerType.split(';')[0].trim().toLowerCase();
      if (ct === 'text/html' || ct === 'application/xhtml+xml') {
        await res.body?.cancel().catch(() => undefined);
        throw new Error('respondió una página HTML, no un archivo');
      }
      const declared = Number(res.headers.get('content-length'));
      if (declared > MAX_FILE_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`demasiado grande (${declared} bytes)`);
      }
      if (!res.body) throw new Error('respuesta sin cuerpo');
      const hash = createHash('sha256');
      let bytes = 0;
      const out = createWriteStream(dest);
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          bytes += chunk.length;
          if (bytes > MAX_FILE_BYTES) {
            ctrl.abort();
            throw new Error(`demasiado grande (más de ${MAX_FILE_BYTES} bytes)`);
          }
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', r));
        }
        await new Promise<void>((resolve, reject) => {
          out.once('error', reject);
          out.end(resolve);
        });
      } catch (err) {
        out.destroy();
        throw err;
      }
      return { bytes, sha256: hash.digest('hex'), contentType: typeFor(headerType, u.href), finalUrl: u.href };
    } catch (err) {
      if (deadline.aborted) throw new Error(`se agotó el plazo de copia (${budgetMs()} ms)`);
      throw err;
    }
  }
  throw new Error('demasiadas redirecciones');
}

// ─── Copiar los archivos de un resultado ───────────────────────────────────

/**
 * Copia a Kiba los archivos enlazados en `result` y devuelve la respuesta con los enlaces
 * reescritos. Nunca lanza: lo que no se pudo copiar conserva su enlace original.
 */
export async function keepResultFiles(a: {
  resultId: string;
  userId: number;
  result: unknown;
}): Promise<{ result: unknown; files: ResultFileRow[] }> {
  const found = enabled() ? findFileUrls(a.result) : [];
  if (found.length === 0) return { result: a.result, files: [] };
  await initFilesDir();
  const deadline = AbortSignal.timeout(budgetMs());
  const urls = [...new Set(found.map((f) => f.url))].slice(0, MAX_FILES_PER_RESULT);
  // En paralelo: el plazo es por resultado, no por archivo.
  const downloaded = await Promise.all(
    urls.map(async (url) => {
      const keyPath = found.find((f) => f.url === url)!.keyPath;
      const id = randomBytes(16).toString('hex');
      const part = `${filePath(id)}.part`;
      try {
        const d = await download(url, part, deadline);
        await rename(part, filePath(id));
        return { url, keyPath, id, d };
      } catch (err) {
        await rm(part, { force: true }).catch(() => undefined);
        console.log(`[files] ${a.resultId}: no se copió ${keyPath} (${url.slice(0, 120)}): ${(err as Error).message}`);
        return null;
      }
    }),
  );
  const files: ResultFileRow[] = [];
  const byUrl = new Map<string, ResultFileRow>();
  let total = 0;
  for (const item of downloaded) {
    if (!item) continue;
    const { url, keyPath, id, d } = item;
    if (total + d.bytes > MAX_RESULT_BYTES) {
      await rm(filePath(id), { force: true }).catch(() => undefined);
      console.log(`[files] ${a.resultId}: no se guardó ${keyPath}: se superó el tope de bytes por resultado`);
      continue;
    }
    const row: ResultFileRow = {
      id,
      result_id: a.resultId,
      user_id: a.userId,
      key_path: keyPath,
      name: fileNameFor(d.finalUrl, keyPath, d.contentType),
      content_type: d.contentType,
      bytes: d.bytes,
      sha256: d.sha256,
      source_url: url,
      created_at: Math.floor(Date.now() / 1000),
    };
    try {
      await db
        .prepare(
          `INSERT INTO result_files (id, result_id, user_id, key_path, name, content_type, bytes, sha256, source_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.id, row.result_id, row.user_id, row.key_path, row.name, row.content_type, row.bytes, row.sha256, row.source_url, row.created_at);
    } catch (err) {
      await rm(filePath(id), { force: true }).catch(() => undefined);
      console.log(`[files] ${a.resultId}: no se registró ${keyPath}: ${(err as Error).message}`);
      continue;
    }
    files.push(row);
    byUrl.set(url, row);
    total += d.bytes;
  }
  if (files.length === 0) return { result: a.result, files };
  const result = rewrite(a.result, (s) => {
    const row = byUrl.get(s);
    return row ? fileUrl(row.id, row.name) : s;
  });
  return { result, files };
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export async function filesForResult(resultId: string): Promise<ResultFileRow[]> {
  return db
    .prepare('SELECT * FROM result_files WHERE result_id = ? ORDER BY created_at ASC, key_path ASC')
    .all<ResultFileRow>(resultId);
}

export async function getFile(id: string): Promise<ResultFileRow | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  return (await db.prepare('SELECT * FROM result_files WHERE id = ?').get<ResultFileRow>(id)) ?? null;
}

export function fileDto(row: ResultFileRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    url: fileUrl(row.id, row.name),
    contentType: row.content_type,
    bytes: Number(row.bytes),
    sha256: row.sha256,
    keyPath: row.key_path,
    sourceUrl: row.source_url,
  };
}

/**
 * GET /v1/files/:id/:name — sirve el archivo guardado (público con el id; ver cabecera).
 * `download` fuerza la descarga (Content-Disposition: attachment): el botón del dashboard lo
 * necesita porque el atributo `download` de un enlace no aplica entre dominios distintos.
 */
export async function sendResultFile(id: string, res: Response, opts: { download?: boolean } = {}): Promise<void> {
  const row = await getFile(id);
  if (!row) {
    res.status(404).json({ error: 'file not found' });
    return;
  }
  const abs = filePath(row.id);
  if (!(await stat(abs).catch(() => null))) {
    res.status(404).json({ error: 'file not available' });
    return;
  }
  const ascii = row.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  res.set({
    'Content-Type': row.content_type,
    'Content-Disposition': `${opts.download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  await new Promise<void>((resolve) => {
    res.sendFile(abs, { dotfiles: 'deny', cacheControl: false, lastModified: false }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'no se pudo leer el archivo' });
      resolve();
    });
  });
}
