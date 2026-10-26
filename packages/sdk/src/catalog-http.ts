/**
 * HttpCatalogSource — un `CatalogSource` que lee el catálogo de la API HTTP que una empresa YA
 * tiene (un banco de fotos, una discográfica, una tienda de modelos 3D) y lo traduce al formato de
 * Kiba con una función `map` que escribe el publisher. La empresa no migra nada: Kiba nunca se
 * conecta a su base de datos; este proceso (el del publisher) llama a su API con su propia clave.
 *
 *   const source = new HttpCatalogSource({
 *     baseUrl: 'https://api.empresa.com/v1',
 *     headers: { Authorization: `Bearer ${process.env.EMPRESA_API_KEY}` },
 *     listPath: 'items',                       // o fetchItems(api) para paginar a tu manera
 *     map: (raw) => ({ id: raw.sku, title: raw.name, type: 'image', priceUsd: raw.price_cents / 100,
 *                      previewUrl: raw.thumbnail_url, downloadPath: `items/${raw.sku}/download-link` }),
 *   });
 *   new MediaCatalogProvider({ ..., source });
 *
 * - El catálogo se carga la primera vez que se usa y se cachea en memoria; pasado `refreshMs`
 *   (5 min) se recarga en segundo plano y mientras tanto se sigue sirviendo la copia anterior. Si
 *   la API falla al recargar, se conserva la última copia buena.
 * - Buscar, listar y ver son en memoria (misma puntuación que FolderSource).
 * - Al licenciar, `deliver` devuelve el enlace de descarga DE LA EMPRESA: `downloadUrl` tal cual,
 *   o, con `downloadPath`, lo pide a su API en ese momento (enlaces firmados de vida corta). Si la
 *   API no da el SHA-256 del archivo, se descarga una vez para calcularlo y se cachea.
 */
import { createHash } from 'node:crypto';
import { searchCatalogItems, mimeTypeFor, type CatalogDelivery, type CatalogItem, type CatalogMediaType, type CatalogSource } from './catalog';

/** Lo que devuelve `map`: un ítem de Kiba más cómo obtener el archivo en la API de la empresa. */
export interface HttpCatalogEntry extends CatalogItem {
  /** Enlace de descarga listo para el comprador (estático o firmado de larga vida). */
  downloadUrl?: string;
  /**
   * Ruta de la API de la empresa (relativa a `baseUrl`, o URL absoluta) que, en el momento de la
   * compra, devuelve JSON con el enlace: `{ url | download_url | downloadUrl | href, sha256?, bytes? }`.
   * Es la opción para enlaces firmados de vida corta. Se llama con las mismas cabeceras (`headers`).
   */
  downloadPath?: string;
  /** Nombre del archivo entregado (por defecto, el último segmento de la URL de descarga). */
  filename?: string;
}

/** Acceso a la API de la empresa que reciben `fetchItems` (con baseUrl, cabeceras y timeout ya puestos). */
export interface HttpCatalogApi {
  getJson(pathOrUrl: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
}

export interface HttpCatalogSourceOptions<Raw = unknown> {
  /** Base de la API de la empresa, p.ej. `https://api.empresa.com/v1`. */
  baseUrl: string;
  /** Ruta (relativa a `baseUrl`) que devuelve todos los ítems: un array, o `{ items | data | results: [] }`. Por defecto `items`. */
  listPath?: string;
  /** Carga a medida (paginación propia, varios endpoints…). Si está, sustituye a `listPath`. */
  fetchItems?: (api: HttpCatalogApi) => Promise<Raw[]>;
  /** Traduce un registro de la empresa a un ítem de Kiba. `null` lo omite (p.ej. ítems retirados). */
  map: (raw: Raw) => HttpCatalogEntry | null | undefined;
  /** Cabeceras de la API (la clave de la empresa). Solo se envían al origen de `baseUrl`. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Cada cuánto se recarga el catálogo, en ms (5 min por defecto; 0 = nunca, solo `refresh()`). */
  refreshMs?: number;
  /** Timeout de cada llamada a la API, en ms (10 s por defecto). */
  timeoutMs?: number;
  /**
   * Base pública del servicio de Kiba. Si se da, `previewUrl` se anuncia como
   * `<publicBaseUrl>/catalog/preview/<id>` (que redirige a la miniatura de la empresa); si no, se
   * anuncia la URL de la miniatura de la empresa tal cual.
   */
  publicBaseUrl?: string;
  /** Tamaño máximo que se descarga para calcular el SHA-256 (200 MB por defecto). */
  maxHashBytes?: number;
  /** `fetch` a usar (por defecto el global; útil en tests). */
  fetch?: typeof fetch;
}

interface Entry extends CatalogItem {
  downloadUrl?: string;
  downloadPath?: string;
  filename?: string;
  /** URL de la miniatura de la empresa (la anunciada puede ser la del servicio). */
  companyPreview?: string;
}

interface HashInfo {
  sha256: string;
  bytes: number;
  contentType?: string;
}

const MEDIA_TYPES: readonly CatalogMediaType[] = ['image', 'audio', 'video', 'model', 'document', 'other'];
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class HttpCatalogSource<Raw = unknown> implements CatalogSource {
  private readonly base: URL;
  private readonly publicBase: string;
  private readonly refreshMs: number;
  private readonly timeoutMs: number;
  private readonly maxHashBytes: number;
  private readonly fetchImpl: typeof fetch;
  private items = new Map<string, Entry>();
  private loadedAtMs = 0;
  private loading: Promise<void> | null = null;
  /** `${id}:${bytes}` → SHA-256 del archivo (calculado descargándolo una vez). */
  private readonly hashes = new Map<string, Promise<HashInfo>>();
  readonly api: HttpCatalogApi;

  constructor(private readonly opts: HttpCatalogSourceOptions<Raw>) {
    if (!opts.baseUrl) throw new Error('HttpCatalogSource: baseUrl is required');
    this.base = new URL(opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`);
    this.publicBase = (opts.publicBaseUrl ?? '').replace(/\/+$/, '');
    this.refreshMs = opts.refreshMs ?? 5 * 60_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxHashBytes = opts.maxHashBytes ?? 200 * 1024 * 1024;
    this.fetchImpl = opts.fetch ?? fetch;
    this.api = { getJson: (p, q) => this.getJson(p, q) };
  }

  /** Crea la fuente y hace la primera carga (falla si la API no responde). */
  static async open<R = unknown>(opts: HttpCatalogSourceOptions<R>): Promise<HttpCatalogSource<R>> {
    const s = new HttpCatalogSource<R>(opts);
    await s.refresh();
    return s;
  }

  get size(): number {
    return this.items.size;
  }

  /** Cuándo se cargó el catálogo por última vez (ms epoch; 0 = nunca). */
  get loadedAt(): number {
    return this.loadedAtMs;
  }

  /** Recarga el catálogo ahora (las llamadas concurrentes comparten la misma carga). Devuelve el nº de ítems. */
  async refresh(): Promise<number> {
    if (!this.loading) this.loading = this.load().finally(() => (this.loading = null));
    await this.loading;
    return this.items.size;
  }

  /**
   * Calcula y cachea por adelantado el SHA-256 de los ítems que no lo traen, para que el primer
   * comprador no espere la descarga (y para ver al arrancar si algún enlace de la empresa falla).
   */
  async prehash(ids?: string[], concurrency = 4): Promise<{ ok: number; failed: string[] }> {
    await this.ensure();
    const queue = (ids ?? [...this.items.keys()]).filter((id) => !this.items.get(id)?.sha256);
    const failed: string[] = [];
    let ok = 0;
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          if (await this.deliver(id)) ok++;
          else failed.push(id);
        } catch {
          failed.push(id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    return { ok, failed };
  }

  async list(opts?: { cursor?: string; limit?: number }): Promise<{ items: CatalogItem[]; next?: string }> {
    await this.ensure();
    const all = [...this.items.values()];
    const start = Math.max(0, Number(opts?.cursor) || 0);
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const page = all.slice(start, start + limit).map(strip);
    return { items: page, ...(start + limit < all.length ? { next: String(start + limit) } : {}) };
  }

  async search(query: string, opts?: { type?: CatalogMediaType; limit?: number }): Promise<CatalogItem[]> {
    await this.ensure();
    return searchCatalogItems(this.items.values(), query, opts).map(strip);
  }

  async get(id: string): Promise<CatalogItem | null> {
    await this.ensure();
    const e = this.items.get(id);
    return e ? strip(e) : null;
  }

  async deliver(id: string): Promise<CatalogDelivery | null> {
    await this.ensure();
    const e = this.items.get(id);
    if (!e) return null;
    let url = e.downloadUrl ? this.resolve(e.downloadUrl) : undefined;
    let sha256 = e.sha256;
    let bytes = e.bytes;
    if (e.downloadPath) {
      const body = (await this.getJson(e.downloadPath)) as Record<string, unknown> | null;
      const link = pickString(body, ['url', 'download_url', 'downloadUrl', 'href']);
      if (link) url = this.resolve(link);
      const s = pickString(body, ['sha256', 'hash']);
      if (!sha256 && s && SHA256_HEX.test(s.toLowerCase())) sha256 = s.toLowerCase();
      bytes ??= num(body?.bytes ?? body?.size);
    }
    if (!url) throw new Error(`no download link for ${id}`);
    const filename = e.filename ?? (basenameOf(url) || id);
    let mimeType = e.mimeType ?? mimeTypeFor(filename);
    if (!sha256) {
      const h = await this.hashOf(e.id, bytes, url);
      sha256 = h.sha256;
      bytes ??= h.bytes;
      if (mimeType === 'application/octet-stream' && h.contentType) mimeType = h.contentType;
    }
    return { url, filename, mimeType, sha256, ...(bytes != null ? { bytes } : {}) };
  }

  async preview(id: string): Promise<CatalogDelivery | null> {
    await this.ensure();
    const url = this.items.get(id)?.companyPreview;
    if (!url) return null;
    const filename = basenameOf(url) || `${id}-preview`;
    return { url, filename, mimeType: mimeTypeFor(filename) };
  }

  // ─── carga y caché ───────────────────────────────────────────

  private async ensure(): Promise<void> {
    if (!this.loadedAtMs) {
      await this.refresh();
      return;
    }
    if (this.refreshMs > 0 && Date.now() - this.loadedAtMs > this.refreshMs && !this.loading) {
      // Stale-while-revalidate: se sirve la copia actual mientras se recarga.
      this.refresh().catch((err: Error) => console.warn(`[kiba-sdk] HttpCatalogSource refresh failed, keeping the last copy: ${err.message}`));
    }
  }

  private async load(): Promise<void> {
    const raws = this.opts.fetchItems
      ? await this.opts.fetchItems(this.api)
      : (extractItems(await this.getJson(this.opts.listPath ?? 'items')) as Raw[]);
    if (!Array.isArray(raws)) throw new Error('HttpCatalogSource: fetchItems must return an array');
    const next = new Map<string, Entry>();
    const problems: string[] = [];
    raws.forEach((raw, i) => {
      let mapped: HttpCatalogEntry | null | undefined;
      try {
        mapped = this.opts.map(raw);
      } catch (err) {
        problems.push(`#${i}: map threw: ${(err as Error).message}`);
        return;
      }
      if (!mapped) return;
      const problem = validate(mapped);
      if (problem) problems.push(`#${i} (${String(mapped.id)}): ${problem}`);
      else if (next.has(mapped.id)) problems.push(`#${i}: duplicate id ${mapped.id}`);
      else next.set(mapped.id, this.toEntry(mapped));
    });
    // Un registro roto en el feed de la empresa no tumba el catálogo entero: se omite y se avisa.
    if (problems.length) console.warn(`[kiba-sdk] HttpCatalogSource skipped ${problems.length} item(s): ${problems.slice(0, 10).join('; ')}`);
    this.items = next;
    this.loadedAtMs = Date.now();
  }

  private toEntry(m: HttpCatalogEntry): Entry {
    const { previewUrl, sha256, ...rest } = m;
    const companyPreview = previewUrl ? this.resolve(previewUrl) : undefined;
    const advertised = companyPreview && this.publicBase ? `${this.publicBase}/catalog/preview/${encodeURIComponent(m.id)}` : companyPreview;
    return {
      ...rest,
      ...(sha256 ? { sha256: sha256.toLowerCase() } : {}),
      ...(advertised ? { previewUrl: advertised } : {}),
      ...(companyPreview ? { companyPreview } : {}),
    };
  }

  private hashOf(id: string, bytes: number | undefined, url: string): Promise<HashInfo> {
    const key = `${id}:${bytes ?? ''}`;
    let p = this.hashes.get(key);
    if (!p) {
      p = this.download(url);
      this.hashes.set(key, p);
      p.catch(() => this.hashes.delete(key));
    }
    return p;
  }

  /** Descarga el archivo (sin las cabeceras de la API: es el enlace del comprador) y calcula su SHA-256. */
  private async download(url: string): Promise<HashInfo> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(Math.max(this.timeoutMs, 60_000)), redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`cannot download ${url} to hash it: HTTP ${res.status}`);
    const h = createHash('sha256');
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxHashBytes) {
        await reader.cancel();
        throw new Error(`file too large to hash (> ${this.maxHashBytes} bytes): give sha256 in map`);
      }
      h.update(value);
    }
    const ct = res.headers.get('content-type')?.split(';')[0].trim();
    return { sha256: h.digest('hex'), bytes: total, ...(ct ? { contentType: ct } : {}) };
  }

  // ─── HTTP ────────────────────────────────────────────────────

  private resolve(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return new URL(pathOrUrl.replace(/^\/+/, ''), this.base).toString();
  }

  private async getJson(pathOrUrl: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const url = new URL(this.resolve(pathOrUrl));
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    // La clave de la empresa solo viaja a SU API, nunca a otro origen que aparezca en sus respuestas.
    const headers: Record<string, string> = { accept: 'application/json' };
    if (url.origin === this.base.origin) {
      const h = typeof this.opts.headers === 'function' ? await this.opts.headers() : this.opts.headers;
      Object.assign(headers, h ?? {});
    }
    const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`catalog API ${url.pathname} → HTTP ${res.status}`);
    return res.json();
  }
}

function strip(e: Entry): CatalogItem {
  const { downloadUrl: _u, downloadPath: _p, filename: _f, companyPreview: _c, ...item } = e;
  return item;
}

function validate(m: HttpCatalogEntry): string | null {
  if (typeof m.id !== 'string' || !m.id.trim()) return 'id must be a non-empty string';
  if (m.id.length > 128) return 'id longer than 128 chars';
  if (typeof m.title !== 'string' || !m.title.trim()) return 'title must be a non-empty string';
  if (!MEDIA_TYPES.includes(m.type)) return `type must be one of ${MEDIA_TYPES.join('|')}`;
  if (m.priceUsd !== undefined && !(Number.isFinite(m.priceUsd) && m.priceUsd > 0)) return 'priceUsd must be a positive number';
  if (m.sha256 !== undefined && !SHA256_HEX.test(String(m.sha256).toLowerCase())) return 'sha256 must be 64 hex chars';
  if (!m.downloadUrl && !m.downloadPath) return 'needs downloadUrl or downloadPath';
  return null;
}

function extractItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const b = (body ?? {}) as Record<string, unknown>;
  for (const k of ['items', 'data', 'results']) if (Array.isArray(b[k])) return b[k] as unknown[];
  throw new Error('HttpCatalogSource: list response must be an array or { items | data | results: [] } (or pass fetchItems)');
}

function pickString(o: Record<string, unknown> | null | undefined, keys: string[]): string | undefined {
  for (const k of keys) if (typeof o?.[k] === 'string' && o[k]) return o[k] as string;
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function basenameOf(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}
