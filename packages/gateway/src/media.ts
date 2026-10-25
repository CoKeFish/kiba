/**
 * Búsqueda federada de medios con licencia.
 *
 * Un asistente pregunta "una pista lo-fi para mi video" y el gateway consulta en paralelo el
 * endpoint público `GET /catalog/search` de cada servicio de catálogo (MediaCatalogProvider del
 * SDK), con timeout corto, y devuelve los ítems normalizados con precio y resumen de licencia.
 * Es gratis: no pasa por el pago. Comprar es `call_agent(service, { assetId })`.
 *
 * Qué servicios son catálogos se aprende sobre la marcha: el que responde 404 en /catalog/search
 * se recuerda como "no catálogo" durante un rato y no se vuelve a molestar. Primera versión: fan-out
 * en vivo; cuando haya muchos catálogos, un índice en Postgres alimentado por /catalog/items.
 */
import axios from 'axios';
import { listAgents } from './proxy';

export interface MediaSearchOptions {
  query: string;
  type?: string;
  maxPriceUsd?: number;
  limit?: number;
}

export interface MediaHit {
  service: string;
  assetId: string;
  title: string;
  type: string;
  description?: string;
  tags?: string[];
  mimeType?: string;
  bytes?: number;
  priceUsd: number;
  previewUrl?: string;
  sha256?: string;
  license?: { name?: string; attribution?: boolean; exclusive?: boolean; user?: string[]; notes?: string };
}

interface AgentLike {
  service: string;
  endpoint?: string;
}

export interface MediaSearchDeps {
  listAgents: () => Promise<unknown[]>;
  fetchJson: (url: string, params: Record<string, unknown>, timeoutMs: number) => Promise<{ status: number; data: unknown }>;
  now?: () => number;
}

const NOT_CATALOG_TTL_MS = 10 * 60_000;
const PER_CATALOG_TIMEOUT_MS = Number(process.env.MEDIA_SEARCH_TIMEOUT_MS) || 3_000;
const MAX_ITEMS = 50;

/** endpoint → cuándo se comprobó que NO es catálogo (404). */
const notCatalog = new Map<string, number>();

const defaultDeps: MediaSearchDeps = {
  listAgents: () => listAgents(),
  fetchJson: async (url, params, timeout) => {
    const r = await axios.get(url, { params, timeout, validateStatus: () => true });
    return { status: r.status, data: r.data };
  },
};

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function normalize(service: string, raw: unknown): MediaHit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const i = raw as Record<string, unknown>;
  const id = typeof i.id === 'string' ? i.id : undefined;
  const title = typeof i.title === 'string' ? i.title : id;
  const priceUsd = num(i.priceUsd);
  if (!id || !title || priceUsd === undefined) return null;
  const terms = (typeof i.terms === 'object' && i.terms ? i.terms : {}) as Record<string, unknown>;
  return {
    service,
    assetId: id,
    title,
    type: typeof i.type === 'string' ? i.type : 'other',
    ...(typeof i.description === 'string' ? { description: i.description } : {}),
    ...(Array.isArray(i.tags) ? { tags: i.tags.map(String) } : {}),
    ...(typeof i.mimeType === 'string' ? { mimeType: i.mimeType } : {}),
    ...(num(i.bytes) !== undefined ? { bytes: num(i.bytes) } : {}),
    priceUsd,
    ...(typeof i.previewUrl === 'string' ? { previewUrl: i.previewUrl } : {}),
    ...(typeof i.sha256 === 'string' ? { sha256: i.sha256 } : {}),
    license: {
      ...(typeof terms.name === 'string' ? { name: terms.name } : {}),
      ...(typeof terms.attribution === 'boolean' ? { attribution: terms.attribution } : {}),
      ...(typeof terms.exclusive === 'boolean' ? { exclusive: terms.exclusive } : {}),
      ...(Array.isArray(terms.user) ? { user: terms.user.map(String) } : {}),
      ...(typeof terms.notes === 'string' ? { notes: terms.notes } : {}),
    },
  };
}

/** Intercala los resultados de varios catálogos (uno de cada, en orden) para no favorecer a ninguno. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export async function searchMedia(
  opts: MediaSearchOptions,
  deps: MediaSearchDeps = defaultDeps,
): Promise<{ query: string; catalogsQueried: number; count: number; items: MediaHit[]; hint: string }> {
  const now = deps.now ?? Date.now;
  const query = String(opts.query ?? '').trim();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_ITEMS);
  const agents = ((await deps.listAgents()) as AgentLike[]).filter(
    (a) => typeof a?.endpoint === 'string' && a.endpoint.length > 0 && typeof a.service === 'string',
  );
  // Un endpoint, una consulta (varios servicios pueden compartir host en desarrollo).
  const byEndpoint = new Map<string, AgentLike>();
  for (const a of agents) {
    const ep = a.endpoint!.replace(/\/+$/, '');
    const seen = notCatalog.get(ep);
    if (seen !== undefined && now() - seen < NOT_CATALOG_TTL_MS) continue;
    if (!byEndpoint.has(ep)) byEndpoint.set(ep, { ...a, endpoint: ep });
  }

  const perCatalog = await Promise.all(
    [...byEndpoint.values()].map(async (a): Promise<MediaHit[]> => {
      try {
        const r = await deps.fetchJson(
          `${a.endpoint}/catalog/search`,
          { q: query, ...(opts.type ? { type: opts.type } : {}), limit },
          PER_CATALOG_TIMEOUT_MS,
        );
        if (r.status === 404) {
          notCatalog.set(a.endpoint!, now());
          return [];
        }
        const items = (r.data as { items?: unknown })?.items;
        if (r.status !== 200 || !Array.isArray(items)) return [];
        const service = typeof (r.data as { service?: unknown }).service === 'string' ? String((r.data as { service: string }).service) : a.service;
        return items.map((i) => normalize(service, i)).filter((h): h is MediaHit => h !== null);
      } catch {
        return [];
      }
    }),
  );

  const merged = interleave(perCatalog)
    .filter((h) => opts.maxPriceUsd === undefined || h.priceUsd <= opts.maxPriceUsd)
    .slice(0, limit);
  return {
    query,
    catalogsQueried: byEndpoint.size,
    count: merged.length,
    items: merged,
    hint:
      merged.length > 0
        ? 'Show the user a few options with price and previewUrl. To buy one: call_agent(service, { assetId }); the response includes the download link and a verifiable license credential.'
        : 'No licensed media matched. Try other words, or a generator service (music-generator, 3d-generator) which also delivers a license.',
  };
}

/** Solo para tests: olvida qué endpoints no eran catálogos. */
export function resetMediaSearchCache(): void {
  notCatalog.clear();
}
