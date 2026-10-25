/**
 * MediaCatalogProvider — un servicio de Kiba que vende archivos con licencia (fotos, música,
 * modelos 3D, documentos) de un catálogo que el publisher controla.
 *
 *   const source = await FolderSource.open({ dir: './catalogo', publicBaseUrl: PUBLIC_ENDPOINT });
 *   const agent = new MediaCatalogProvider({ wallet, service: 'fotos-de-ana', pricePerCall: 0.05,
 *     source, license: { name: 'commercial' }, endpoint: PUBLIC_ENDPOINT });
 *   await agent.bootstrap(); await agent.listen(5011);
 *
 * Tres operaciones:
 *   - buscar y ver son PÚBLICAS y gratis: GET /catalog/search?q=…&type=…  ·  GET /catalog/items/:id
 *     (el gateway de Kiba las usa para la búsqueda federada; el gateway no acepta precio cero).
 *   - licenciar es PAGADA: POST /service { assetId } cobra el precio del ítem y devuelve el enlace de
 *     descarga (firmado, con caducidad) y el bloque `license` (hash + términos). Kiba emite con él la
 *     credencial verificable del comprador.
 *
 * El catálogo vive donde el publisher quiera: `CatalogSource` son cuatro funciones (list, search,
 * get, deliver). `FolderSource` las implementa sobre una carpeta con un items.csv o items.json
 * (la vía de subida masiva). Para S3, una base de datos propia o un feed, implementa la interfaz;
 * Kiba nunca se conecta a la base de datos del publisher.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { AgentProvider } from './provider';
import type { AgentConfig } from './types';
import { mergeLicenseTerms, type LicenseGrant, type LicenseTerms } from './license';

export type CatalogMediaType = 'image' | 'audio' | 'video' | 'model' | 'document' | 'other';

/** Un ítem del catálogo tal como se anuncia (sin el archivo). */
export interface CatalogItem {
  id: string;
  title: string;
  type: CatalogMediaType;
  description?: string;
  tags?: string[];
  mimeType?: string;
  bytes?: number;
  /** SHA-256 hex del archivo (lo que identifica el activo en la licencia). */
  sha256?: string;
  /** Precio en USD de la licencia de este ítem; si falta, el precio base del servicio. */
  priceUsd?: number;
  /** Vista previa pública (miniatura, 15 s de audio…), si existe. */
  previewUrl?: string;
  /** Términos propios de este ítem; se completan con los del servicio. */
  terms?: LicenseTerms;
  attributionText?: string;
  createdAt?: string;
}

/** Cómo se entrega el archivo: una ruta local que el servicio sirve, o una URL del publisher. */
export interface CatalogDelivery {
  filename: string;
  mimeType: string;
  bytes?: number;
  sha256?: string;
  /** URL ya lista (p.ej. firmada por S3). Si falta, se sirve `path` con un enlace firmado. */
  url?: string;
  path?: string;
}

export interface CatalogSource {
  list(opts?: { cursor?: string; limit?: number }): Promise<{ items: CatalogItem[]; next?: string }>;
  search(query: string, opts?: { type?: CatalogMediaType; limit?: number }): Promise<CatalogItem[]>;
  get(id: string): Promise<CatalogItem | null>;
  deliver(id: string): Promise<CatalogDelivery | null>;
  /** Vista previa (opcional): archivo público sin pago. */
  preview?(id: string): Promise<CatalogDelivery | null>;
}

export interface MediaCatalogConfig extends AgentConfig {
  source: CatalogSource;
  /** Base pública de este servicio para los enlaces de descarga y vista previa (por defecto `endpoint`). */
  publicBaseUrl?: string;
  /** Vida del enlace de descarga firmado, en segundos (24 h por defecto). */
  downloadTtlSec?: number;
  /** Secreto de los enlaces firmados. Por defecto, aleatorio por proceso (los enlaces mueren al reiniciar). */
  downloadSecret?: string;
}

export interface CatalogRequest {
  /** 'license' (por defecto si hay assetId), 'get' o 'search'. */
  op?: 'license' | 'get' | 'search';
  assetId?: string;
  query?: string;
  type?: CatalogMediaType;
  limit?: number;
}

export interface CatalogLicenseResult {
  op: 'license';
  asset: CatalogItem;
  downloadUrl: string;
  expiresAt: number;
  license: LicenseGrant;
  next: string;
}

const DOWNLOAD_TTL_SEC = 24 * 60 * 60;

export class MediaCatalogProvider extends AgentProvider {
  readonly source: CatalogSource;
  private readonly catalogBase: string;
  private readonly ttlSec: number;
  private readonly secret: Buffer;
  private readonly serviceTerms?: LicenseTerms;

  constructor(cfg: MediaCatalogConfig) {
    const { source, publicBaseUrl, downloadTtlSec, downloadSecret, ...base } = cfg;
    // `priceFn` necesita `this`, que no existe antes de super(): se resuelve en diferido.
    const late: { self?: MediaCatalogProvider } = {};
    super({
      ...base,
      catalog: true,
      priceFn: base.priceFn ?? ((req: unknown) => late.self!.priceFor(req)),
    });
    late.self = this;
    this.source = source;
    this.catalogBase = (publicBaseUrl ?? base.endpoint ?? '').replace(/\/+$/, '');
    this.ttlSec = downloadTtlSec ?? DOWNLOAD_TTL_SEC;
    this.secret = downloadSecret ? Buffer.from(downloadSecret) : randomBytes(32);
    this.serviceTerms = base.license;
    this.serve<CatalogRequest, unknown>((req) => this.handle(req));
    this.mountCatalogRoutes(this.app);
  }

  /** Precio de ESTA petición: el del ítem para licenciar; el precio base para lo demás. */
  async priceFor(req: unknown): Promise<number> {
    const r = (req ?? {}) as CatalogRequest;
    if (r.assetId && (r.op ?? 'license') === 'license') {
      const item = await this.source.get(String(r.assetId));
      if (item?.priceUsd != null) return item.priceUsd;
    }
    return this.config.pricePerCall;
  }

  private async handle(req: CatalogRequest): Promise<unknown> {
    const r = req ?? {};
    const op = r.op ?? (r.assetId ? 'license' : 'search');
    if (op === 'search') {
      const items = await this.source.search(String(r.query ?? ''), { type: r.type, limit: r.limit });
      return { op, items, next: 'Pick an item and call again with { assetId } to license and download it.' };
    }
    if (!r.assetId) throw new Error('assetId required');
    const item = await this.source.get(String(r.assetId));
    if (!item) throw new Error(`unknown asset: ${r.assetId}`);
    if (op === 'get') return { op, item };
    return this.license(item);
  }

  private async license(item: CatalogItem): Promise<CatalogLicenseResult> {
    const d = await this.source.deliver(item.id);
    if (!d) throw new Error(`asset not available: ${item.id}`);
    const sha256 = d.sha256 ?? item.sha256 ?? (d.path ? await sha256File(d.path) : undefined);
    if (!sha256) throw new Error(`cannot hash asset ${item.id}: provide sha256 or a local path`);
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSec;
    const downloadUrl = d.url ?? this.signedDownloadUrl(item.id, expiresAt);
    const license: LicenseGrant = {
      assetId: item.id,
      title: item.title,
      assetSha256: sha256,
      filename: d.filename,
      mimeType: d.mimeType,
      ...(d.bytes != null ? { bytes: d.bytes } : {}),
      assetUrl: downloadUrl,
      ...(item.attributionText ? { attributionText: item.attributionText } : {}),
      terms: mergeLicenseTerms(this.serviceTerms, item.terms),
    };
    return {
      op: 'license',
      asset: { ...item, sha256 },
      downloadUrl,
      expiresAt,
      license,
      next:
        'Give the user the downloadUrl. The purchase comes with a verifiable license credential issued by Kiba ' +
        '(see `license` in the Kiba response); mention attribution if the terms require it.',
    };
  }

  // ─── enlaces firmados ────────────────────────────────────────

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('hex');
  }

  signedDownloadUrl(id: string, exp: number): string {
    return `${this.catalogBase}/catalog/download/${encodeURIComponent(id)}?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  verifyDownloadToken(id: string, exp: number, sig: string): 'ok' | 'expired' | 'invalid' {
    if (!Number.isFinite(exp) || !/^[a-f0-9]{64}$/.test(sig)) return 'invalid';
    const expected = Buffer.from(this.sign(id, exp), 'hex');
    const given = Buffer.from(sig, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
    return exp < Math.floor(Date.now() / 1000) ? 'expired' : 'ok';
  }

  // ─── rutas públicas ──────────────────────────────────────────

  /** Monta las rutas públicas del catálogo en una app de express (la propia o una ajena). */
  mountCatalogRoutes(app: Express): void {
    app.get('/catalog', (_req: Request, res: Response) => {
      res.json({
        service: this.config.service,
        catalog: true,
        pricePerCall: this.config.pricePerCall,
        license: this.serviceTerms ?? null,
        search: `${this.catalogBase}/catalog/search?q=`,
      });
    });
    app.get('/catalog/search', (req: Request, res: Response) => {
      const q = String(req.query.q ?? '');
      const type = typeof req.query.type === 'string' ? (req.query.type as CatalogMediaType) : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      void this.source
        .search(q, { type, limit })
        .then((items) => res.json({ service: this.config.service, query: q, items: items.map((i) => this.publicItem(i)) }))
        .catch((err: Error) => res.status(500).json({ error: err.message }));
    });
    app.get('/catalog/items', (req: Request, res: Response) => {
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      void this.source
        .list({ cursor, limit })
        .then((page) => res.json({ ...page, items: page.items.map((i) => this.publicItem(i)) }))
        .catch((err: Error) => res.status(500).json({ error: err.message }));
    });
    app.get('/catalog/items/:id', (req: Request, res: Response) => {
      void this.source
        .get(String(req.params.id))
        .then((item) => (item ? res.json(this.publicItem(item)) : res.status(404).json({ error: 'not found' })))
        .catch((err: Error) => res.status(500).json({ error: err.message }));
    });
    app.get('/catalog/preview/:id', (req: Request, res: Response) => {
      if (!this.source.preview) return res.status(404).json({ error: 'no preview' });
      void this.source
        .preview(String(req.params.id))
        .then((d) => (d ? sendDelivery(res, d, 'public, max-age=3600') : res.status(404).json({ error: 'no preview' })))
        .catch((err: Error) => res.status(500).json({ error: err.message }));
    });
    app.get('/catalog/download/:id', (req: Request, res: Response) => {
      const id = String(req.params.id);
      const verdict = this.verifyDownloadToken(id, Number(req.query.exp), String(req.query.sig ?? ''));
      if (verdict === 'invalid') return res.status(403).json({ error: 'invalid download link' });
      if (verdict === 'expired') return res.status(410).json({ error: 'download link expired' });
      void this.source
        .deliver(id)
        .then((d) => (d ? sendDelivery(res, d, 'private, max-age=3600') : res.status(404).json({ error: 'not found' })))
        .catch((err: Error) => res.status(500).json({ error: err.message }));
    });
  }

  /** Lo que se publica de un ítem (con precio efectivo y términos efectivos). */
  publicItem(item: CatalogItem): CatalogItem & { priceUsd: number; terms: LicenseTerms } {
    return {
      ...item,
      priceUsd: item.priceUsd ?? this.config.pricePerCall,
      terms: mergeLicenseTerms(this.serviceTerms, item.terms),
    };
  }
}

function sendDelivery(res: Response, d: CatalogDelivery, cacheControl: string): void {
  if (d.url) {
    res.redirect(302, d.url);
    return;
  }
  if (!d.path) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.setHeader('Content-Type', d.mimeType);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Disposition', `inline; filename="${d.filename.replace(/["\\\r\n]/g, '_')}"`);
  if (d.bytes != null) res.setHeader('Content-Length', String(d.bytes));
  createReadStream(d.path)
    .on('error', () => {
      if (!res.headersSent) res.status(404).json({ error: 'not found' });
      else res.end();
    })
    .pipe(res);
}

export async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

// ─── FolderSource: una carpeta + items.csv / items.json ───────────────────

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'model/obj',
  '.fbx': 'application/octet-stream',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

export function mimeTypeFor(filename: string): string {
  return MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

export function mediaTypeFor(mimeType: string): CatalogMediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('model/')) return 'model';
  if (/pdf|epub|text\//.test(mimeType)) return 'document';
  return 'other';
}

/** Fila de items.csv / items.json. Solo `file` es obligatorio. */
export interface CatalogRow {
  id?: string;
  file: string;
  title?: string;
  type?: CatalogMediaType;
  description?: string;
  /** Etiquetas separadas por `;` o `|` (CSV) o un array (JSON). */
  tags?: string | string[];
  price_usd?: string | number;
  /** Nombre de plantilla ('personal' | 'commercial' | 'commercial-attribution') o términos (JSON). */
  license?: string | LicenseTerms;
  attribution?: string | boolean;
  attribution_text?: string;
  preview?: string;
  created_at?: string;
}

interface FolderItem extends CatalogItem {
  file: string;
  previewFile?: string;
}

export interface FolderSourceOptions {
  dir: string;
  /** items.csv o items.json dentro de `dir` (se detecta solo si falta). */
  metadataFile?: string;
  /** Base pública del servicio, para `previewUrl` (p.ej. el `endpoint` del agente). */
  publicBaseUrl?: string;
}

export class FolderSource implements CatalogSource {
  private constructor(
    private readonly dir: string,
    private readonly items: Map<string, FolderItem>,
  ) {}

  /** Lee los metadatos, comprueba que los archivos existen y calcula el SHA-256 de cada uno. */
  static async open(opts: FolderSourceOptions): Promise<FolderSource> {
    const dir = path.resolve(opts.dir);
    const rows = await readRows(dir, opts.metadataFile);
    const base = (opts.publicBaseUrl ?? '').replace(/\/+$/, '');
    const items = new Map<string, FolderItem>();
    const problems: string[] = [];
    for (const [i, row] of rows.entries()) {
      if (!row.file) {
        problems.push(`row ${i + 1}: missing file`);
        continue;
      }
      const file = safeJoin(dir, row.file);
      if (!file) {
        problems.push(`row ${i + 1}: file escapes the catalog folder: ${row.file}`);
        continue;
      }
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        problems.push(`row ${i + 1}: file not found: ${row.file}`);
        continue;
      }
      const id = slug(row.id || path.basename(row.file, path.extname(row.file)));
      if (items.has(id)) {
        problems.push(`row ${i + 1}: duplicate id ${id}`);
        continue;
      }
      const mimeType = mimeTypeFor(file);
      const previewFile = row.preview ? safeJoin(dir, row.preview) : undefined;
      const terms = parseTerms(row);
      const price = row.price_usd === undefined || row.price_usd === '' ? undefined : Number(row.price_usd);
      if (price !== undefined && !(price > 0)) {
        problems.push(`row ${i + 1}: price_usd must be a positive number`);
        continue;
      }
      items.set(id, {
        id,
        title: row.title || path.basename(row.file),
        type: row.type ?? mediaTypeFor(mimeType),
        description: row.description || undefined,
        tags: parseTags(row.tags),
        mimeType,
        bytes: stat.size,
        sha256: await sha256File(file),
        ...(price !== undefined ? { priceUsd: price } : {}),
        ...(previewFile && base ? { previewUrl: `${base}/catalog/preview/${encodeURIComponent(id)}` } : {}),
        ...(terms ? { terms } : {}),
        ...(row.attribution_text ? { attributionText: row.attribution_text } : {}),
        ...(row.created_at ? { createdAt: row.created_at } : {}),
        file,
        ...(previewFile ? { previewFile } : {}),
      });
    }
    if (problems.length) throw new Error(`catalog ${dir}: ${problems.join('; ')}`);
    return new FolderSource(dir, items);
  }

  get size(): number {
    return this.items.size;
  }

  private strip(i: FolderItem): CatalogItem {
    const { file: _f, previewFile: _p, ...item } = i;
    return item;
  }

  async list(opts?: { cursor?: string; limit?: number }): Promise<{ items: CatalogItem[]; next?: string }> {
    const all = [...this.items.values()];
    const start = Math.max(0, Number(opts?.cursor) || 0);
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const page = all.slice(start, start + limit).map((i) => this.strip(i));
    return { items: page, ...(start + limit < all.length ? { next: String(start + limit) } : {}) };
  }

  /** Búsqueda por palabras en título, descripción, etiquetas e id (ordenada por coincidencias). */
  async search(query: string, opts?: { type?: CatalogMediaType; limit?: number }): Promise<CatalogItem[]> {
    const words = tokens(query);
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
    const scored: { item: FolderItem; score: number }[] = [];
    for (const item of this.items.values()) {
      if (opts?.type && item.type !== opts.type) continue;
      if (words.length === 0) {
        scored.push({ item, score: 0 });
        continue;
      }
      const hay = `${item.title} ${item.description ?? ''} ${(item.tags ?? []).join(' ')} ${item.id}`.toLowerCase();
      let score = 0;
      for (const w of words) {
        if ((item.tags ?? []).some((t) => t.toLowerCase() === w)) score += 3;
        else if (item.title.toLowerCase().includes(w)) score += 2;
        else if (hay.includes(w)) score += 1;
      }
      if (score > 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    return scored.slice(0, limit).map((s) => this.strip(s.item));
  }

  async get(id: string): Promise<CatalogItem | null> {
    const i = this.items.get(id);
    return i ? this.strip(i) : null;
  }

  async deliver(id: string): Promise<CatalogDelivery | null> {
    const i = this.items.get(id);
    if (!i) return null;
    return { path: i.file, filename: path.basename(i.file), mimeType: i.mimeType!, bytes: i.bytes, sha256: i.sha256 };
  }

  async preview(id: string): Promise<CatalogDelivery | null> {
    const i = this.items.get(id);
    if (!i?.previewFile) return null;
    return { path: i.previewFile, filename: path.basename(i.previewFile), mimeType: mimeTypeFor(i.previewFile) };
  }
}

async function readRows(dir: string, metadataFile?: string): Promise<CatalogRow[]> {
  const candidates = metadataFile ? [metadataFile] : ['items.csv', 'items.json', 'catalog.csv', 'catalog.json'];
  for (const name of candidates) {
    const file = path.join(dir, name);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (name.endsWith('.json')) {
      const data = JSON.parse(text) as unknown;
      const arr = Array.isArray(data) ? data : (data as { items?: unknown }).items;
      if (!Array.isArray(arr)) throw new Error(`${file}: expected an array (or { items: [] })`);
      return arr as CatalogRow[];
    }
    return parseCsv(text) as unknown as CatalogRow[];
  }
  throw new Error(`no items.csv or items.json in ${dir}`);
}

/** CSV con comillas, comas y saltos de línea dentro de comillas (RFC 4180). Primera fila = cabeceras. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function parseTags(v: string | string[] | undefined): string[] | undefined {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : v.split(/[;|]/);
  const tags = arr.map((t) => String(t).trim()).filter(Boolean);
  return tags.length ? tags : undefined;
}

function parseTerms(row: CatalogRow): LicenseTerms | undefined {
  let terms: LicenseTerms | undefined;
  if (typeof row.license === 'object' && row.license) terms = { ...row.license };
  else if (typeof row.license === 'string' && row.license.trim()) {
    const s = row.license.trim();
    terms = s.startsWith('{') ? (JSON.parse(s) as LicenseTerms) : { name: s };
  }
  const attr = row.attribution;
  if (attr !== undefined && attr !== '') {
    const b = typeof attr === 'boolean' ? attr : /^(1|true|yes|sí|si)$/i.test(String(attr));
    terms = { ...(terms ?? {}), attribution: b };
  }
  return terms;
}

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Resuelve `rel` dentro de `dir`; null si intenta salirse (../). */
function safeJoin(dir: string, rel: string): string | null {
  const abs = path.resolve(dir, rel);
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return abs === dir || abs.startsWith(prefix) ? abs : null;
}
