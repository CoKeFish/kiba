/**
 * Servicios externos: el nivel ligero de publicador.
 *
 * Un servicio externo es una API que ya cobra por su cuenta con x402 o MPP y que alguien lista
 * en Kiba con su URL, una descripción y sus parámetros. No se integra con el SDK ni recibe pagos
 * de Kiba por lotes: cada llamada se le paga al momento, directo, con el protocolo que la API
 * ya habla. Por eso estas ganancias no pasan por la retención.
 *
 * Kiba cobra su comisión encima del precio de la API (EXTERNAL_FEE_BPS): el usuario paga precio
 * más comisión, la API recibe su precio completo y la comisión se queda en la tesorería.
 *
 * Hoy Kiba paga los que cobran con x402. Los que cobran con MPP se pueden listar, pero no se
 * pueden llamar todavía.
 */
import { db } from './db';
import { lamportsToUsd } from './billing';
import { assertAllowedUrl, callX402Url, probePaidUrl, type X402CallResult } from './x402';

/** Comisión de Kiba sobre el precio de un servicio externo, en puntos básicos (500 = 5 %). */
export const EXTERNAL_FEE_BPS = (() => {
  const n = Number(process.env.EXTERNAL_FEE_BPS);
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? Math.round(n) : 500;
})();
const MAX_PER_USER = Number(process.env.EXTERNAL_MAX_PER_USER) || 50;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;
/** Prefijo con el que un servicio externo aparece en el catálogo y se llama con call_agent. */
export const EXTERNAL_PREFIX = 'ext:';

export interface ExternalParam {
  name: string;
  /** Dónde viaja: en la URL (`query`) o en el cuerpo JSON (`body`). */
  in: 'query' | 'body';
  description: string;
  required: boolean;
  /** Valor de ejemplo; también se usa para pedir la cotización al registrar. */
  example?: string;
}

export interface ExternalInput {
  slug: string;
  name: string;
  description: string;
  url: string;
  method?: string;
  params?: unknown;
}

export interface ExternalService {
  /** Identificador para call_agent: `ext:<slug>`. */
  service: string;
  slug: string;
  kind: 'external';
  name: string;
  description: string;
  url: string;
  method: Method;
  params: ExternalParam[];
  protocol: 'x402' | 'mpp';
  /** false = listado pero Kiba todavía no puede pagarlo (MPP). */
  payable: boolean;
  /** Último precio cotizado por la API, sin la comisión de Kiba (unidades base). null = sin cotización. */
  priceBaseUnits: number | null;
  /** Lo que paga el usuario por llamada: precio más comisión (unidades base). */
  pricePerCall: number | null;
  priceUsd: number | null;
  feeBps: number;
  calls: number;
  createdAt: number;
}

interface Row {
  slug: string;
  user_id: number;
  name: string;
  description: string;
  url: string;
  method: string;
  params: string;
  protocol: string;
  price_lamports: number | null;
  calls: number;
  created_at: number;
}

/** Comisión de Kiba sobre un precio, redondeada hacia arriba. */
export function externalFee(priceBaseUnits: number, feeBps = EXTERNAL_FEE_BPS): number {
  return Math.ceil((priceBaseUnits * feeBps) / 10_000);
}

function view(r: Row): ExternalService {
  const price = r.price_lamports == null ? null : Number(r.price_lamports);
  const total = price == null ? null : price + externalFee(price);
  return {
    service: `${EXTERNAL_PREFIX}${r.slug}`,
    slug: r.slug,
    kind: 'external',
    name: r.name,
    description: r.description,
    url: r.url,
    method: r.method as Method,
    params: JSON.parse(r.params || '[]') as ExternalParam[],
    protocol: r.protocol === 'mpp' ? 'mpp' : 'x402',
    payable: r.protocol !== 'mpp',
    priceBaseUnits: price,
    pricePerCall: total,
    priceUsd: total == null ? null : lamportsToUsd(total),
    feeBps: EXTERNAL_FEE_BPS,
    calls: Number(r.calls),
    createdAt: Number(r.created_at),
  };
}

function cleanParams(raw: unknown): ExternalParam[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('params debe ser una lista');
  if (raw.length > 20) throw new Error('máximo 20 parámetros');
  const seen = new Set<string>();
  return raw.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name)) throw new Error(`nombre de parámetro inválido: '${name}'`);
    if (seen.has(name)) throw new Error(`parámetro repetido: '${name}'`);
    seen.add(name);
    const where = o.in === 'body' ? 'body' : 'query';
    const example = o.example == null || o.example === '' ? undefined : String(o.example).slice(0, 200);
    return {
      name,
      in: where,
      description: String(o.description ?? '').trim().slice(0, 300),
      required: Boolean(o.required),
      ...(example !== undefined ? { example } : {}),
    };
  });
}

/** Arma la URL y el cuerpo de una llamada a partir de los parámetros declarados. */
function buildRequest(
  svc: { url: string; method: Method; params: ExternalParam[] },
  payload: Record<string, unknown>,
): { url: string; body?: Record<string, unknown> } {
  for (const p of svc.params) {
    if (p.required && (payload[p.name] === undefined || payload[p.name] === null || payload[p.name] === '')) {
      throw new Error(`falta el parámetro '${p.name}'${p.description ? `: ${p.description}` : ''}`);
    }
  }
  const u = new URL(svc.url);
  const body: Record<string, unknown> = {};
  const declared = new Map(svc.params.map((p) => [p.name, p]));
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    // Lo no declarado sigue al método: en la URL para GET y DELETE, en el cuerpo para el resto.
    const where = declared.get(key)?.in ?? (svc.method === 'GET' || svc.method === 'DELETE' ? 'query' : 'body');
    if (where === 'query') u.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    else body[key] = value;
  }
  const hasBody = Object.keys(body).length > 0;
  if (hasBody && (svc.method === 'GET' || svc.method === 'DELETE')) {
    throw new Error(`el servicio se llama con ${svc.method}: sus parámetros van en la URL, no en el cuerpo`);
  }
  return { url: u.href, ...(hasBody ? { body } : {}) };
}

function examplePayload(params: ExternalParam[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) if (p.example !== undefined) out[p.name] = p.example;
  return out;
}

/**
 * Lista un servicio externo. Antes de guardarlo se le pide una cotización a la URL (sin pagar):
 * solo se acepta si responde pidiendo pago con x402 en Stellar o con MPP.
 */
export async function registerExternal(userId: number, input: ExternalInput): Promise<ExternalService> {
  const slug = String(input.slug ?? '').trim().toLowerCase();
  if (!SLUG.test(slug)) throw new Error('identificador inválido: 3 a 40 caracteres, minúsculas, números y guiones');
  const name = String(input.name ?? '').trim();
  if (name.length < 3 || name.length > 80) throw new Error('el nombre debe tener entre 3 y 80 caracteres');
  const description = String(input.description ?? '').trim();
  if (description.length < 10 || description.length > 500) throw new Error('la descripción debe tener entre 10 y 500 caracteres');
  const url = String(input.url ?? '').trim();
  if (!url || url.length > 500) throw new Error('URL inválida');
  const method = String(input.method ?? 'GET').toUpperCase() as Method;
  if (!METHODS.includes(method)) throw new Error(`método no soportado: ${method}`);
  const params = cleanParams(input.params);
  await assertAllowedUrl(url);

  const mine = (await db.prepare('SELECT COUNT(*)::int AS n FROM external_services WHERE user_id = ?').get(userId)) as { n: number };
  if (Number(mine.n) >= MAX_PER_USER) throw new Error(`llegaste al máximo de ${MAX_PER_USER} servicios externos`);
  if (await db.prepare('SELECT 1 FROM external_services WHERE slug = ?').get(slug)) {
    throw new Error(`ya existe un servicio externo con el identificador '${slug}'`);
  }

  const req = buildRequest({ url, method, params: params.map((p) => ({ ...p, required: false })) }, examplePayload(params));
  const quote = await probePaidUrl(req.url, method, req.body);
  if (quote.kind === 'free') {
    throw new Error(
      `la URL respondió ${quote.status} sin pedir pago: solo se listan APIs que cobran con x402 o MPP. Si necesita parámetros para cotizar, ponles un valor de ejemplo`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO external_services (slug, user_id, name, description, url, method, params, protocol, price_lamports, calls, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(slug, userId, name, description, url, method, JSON.stringify(params), quote.kind, quote.kind === 'x402' ? quote.lamports : null, now, now);
  return (await getExternal(slug))!;
}

export async function getExternal(slug: string): Promise<ExternalService | null> {
  const row = (await db.prepare('SELECT * FROM external_services WHERE slug = ?').get(slug)) as Row | undefined;
  return row ? view(row) : null;
}

/** Catálogo de servicios externos. Con `query`, los que la mencionan en su nombre o descripción. */
export async function listExternal(query?: string): Promise<ExternalService[]> {
  const rows = (await db.prepare('SELECT * FROM external_services ORDER BY calls DESC, created_at DESC LIMIT 500').all()) as Row[];
  const all = rows.map(view);
  const words = (query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
  if (words.length === 0) return all;
  const score = (s: ExternalService) => {
    const text = `${s.slug} ${s.name} ${s.description}`.toLowerCase();
    return words.filter((w) => text.includes(w)).length;
  };
  return all
    .map((s) => ({ s, n: score(s) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.s);
}

export async function listMyExternal(userId: number): Promise<ExternalService[]> {
  const rows = (await db.prepare('SELECT * FROM external_services WHERE user_id = ? ORDER BY created_at DESC').all(userId)) as Row[];
  return rows.map(view);
}

/** Quita del catálogo un servicio externo propio. */
export async function removeExternal(userId: number, slug: string): Promise<void> {
  const r = await db.prepare('DELETE FROM external_services WHERE slug = ? AND user_id = ?').run(slug, userId);
  if (r.changes === 0) throw new Error('ese servicio externo no existe o no es tuyo');
}

/** ¿Es el identificador de un servicio externo (`ext:<slug>`)? */
export function isExternalService(service: unknown): service is string {
  return typeof service === 'string' && service.startsWith(EXTERNAL_PREFIX);
}

/**
 * Llama un servicio externo del catálogo en nombre de un usuario: Kiba le paga a la API su precio
 * y le cobra al usuario ese precio más la comisión.
 */
export async function callExternal(args: {
  userId: number;
  /** `ext:<slug>` o solo el slug. */
  service: string;
  payload?: unknown;
  maxUsd?: number;
  parentId?: string | null;
}): Promise<X402CallResult> {
  const slug = args.service.startsWith(EXTERNAL_PREFIX) ? args.service.slice(EXTERNAL_PREFIX.length) : args.service;
  const svc = await getExternal(slug);
  if (!svc) throw new Error(`servicio externo no encontrado: ${args.service}`);
  if (!svc.payable) {
    throw new Error(`'${svc.name}' cobra con MPP y Kiba todavía no paga con ese protocolo; por ahora solo está listado`);
  }
  if (args.payload != null && (typeof args.payload !== 'object' || Array.isArray(args.payload))) {
    throw new Error('payload debe ser un objeto con los parámetros del servicio');
  }
  const req = buildRequest(svc, (args.payload ?? {}) as Record<string, unknown>);
  const out = await callX402Url({
    userId: args.userId,
    url: req.url,
    method: svc.method,
    body: req.body,
    maxUsd: args.maxUsd,
    parentId: args.parentId,
    feeBps: EXTERNAL_FEE_BPS,
    service: svc.service,
  });
  if (out.paid) {
    const price = out.cost.lamports - (out.cost.feeLamports ?? 0);
    await db
      .prepare('UPDATE external_services SET calls = calls + 1, price_lamports = ?, updated_at = ? WHERE slug = ?')
      .run(price, Math.floor(Date.now() / 1000), slug)
      .catch(() => undefined);
  }
  return out;
}
