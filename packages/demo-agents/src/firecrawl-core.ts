/**
 * firecrawl-core — lógica del wrapper de Firecrawl, SIN dependencias del SDK ni de
 * express y SIN efectos de arranque (no abre puertos, no lee env al importar).
 *
 * Se separa de firecrawl.ts a propósito: el agente debe ser, en el fondo, un wrapper
 * fino sobre la API de Firecrawl. Aislar aquí la construcción del request, la llamada
 * HTTP, el control de calidad y el mapeo de la respuesta permite:
 *   - testearlo de forma determinista (ver test/firecrawl.test.ts), y
 *   - auditarlo de un vistazo (toda la superficie "real" del agente vive aquí).
 *
 * Control de calidad (lo que Firecrawl no hace por sí solo):
 *   - Sitios que pintan el contenido con JavaScript tras la carga reciben una espera por
 *     defecto; una página que aun así llega vacía (solo menú y pie, consentimiento, captcha)
 *     se reintenta una vez con espera y, si sigue vacía, es un error claro: no se extrae nada
 *     de ella ni se pasa a la IA.
 *   - La extracción con prompt va en dos pasos (contenido → extracción) y lo extraído se
 *     contrasta con la página: toda URL o título que no aparezca en ella se descarta.
 *   - Los errores de Firecrawl se traducen a su causa (sitio bloqueado, no soportado...).
 *
 * firecrawl.ts arma un {@link ScrapeConfig} desde el entorno y delega en {@link scrape}.
 */

export interface FirecrawlRequest {
  /** URL a cargar (sinónimos aceptados: link, page, website, target). */
  url?: string;
  /** Prompt de extracción en lenguaje natural (ej. "extrae el precio y el título"). */
  prompt?: string;
  /** JSON Schema opcional para forzar la forma de la extracción. */
  schema?: Record<string, unknown>;
  /** Formatos a devolver. Default: ['markdown']. Acepta 'json', 'product', 'links', etc. */
  formats?: string[] | string;
  /** Solo el contenido principal (quita nav/footer/ads). Default true. */
  onlyMainContent?: boolean;
  /** Modo de proxy de Firecrawl: 'basic' | 'stealth' | 'auto'. 'stealth' atraviesa anti-bots. */
  proxy?: 'basic' | 'stealth' | 'auto';
  /** ms a esperar tras la carga para que el JS renderice (ej. 3000). */
  waitFor?: number;
  /** País del proxy: { country: 'CO' } o el atajo string 'CO'. Mejora geolocalización. */
  location?: { country?: string; languages?: string[] };
  /** Atajo de país (alias de location.country). */
  country?: string;
}

/** Resultado de contrastar lo extraído con el contenido descargado de la página. */
export interface Verification {
  /** URLs y títulos revisados contra la página. */
  checked: number;
  /** Datos descartados por no aparecer en la página (ruta dentro del JSON y valor). */
  dropped: Array<{ path: string; value: string }>;
}

export interface FirecrawlResponse {
  url: string;
  /** Contenido de la página en markdown (si se pidió). */
  markdown?: string;
  /** Datos estructurados extraídos por el LLM (si se pidió prompt/schema/json), ya contrastados. */
  extracted?: unknown;
  /** Solo en extracción: cuántos datos se contrastaron con la página y cuáles se descartaron. */
  verification?: Verification;
  /** Aviso legible cuando se descartó algo de lo extraído. */
  note?: string;
  /** Datos de producto (si se pidió el formato 'product'). */
  product?: unknown;
  /** Links encontrados en la página (si se pidió 'links'). */
  links?: string[];
  metadata: Record<string, unknown>;
  scrapedAt: number;
}

/** Config de runtime del wrapper (la arma firecrawl.ts desde el entorno). */
export interface ScrapeConfig {
  /**
   * API key de Firecrawl. Vacía / ausente → modo SIN auth: Firecrawl atiende el free
   * tier sin Authorization (límites bajos), suficiente para la demo. Con key se manda
   * `Authorization: Bearer <key>` para límites altos, extracción y proxy stealth.
   */
  apiKey?: string;
  /** Base URL de la API de Firecrawl (default https://api.firecrawl.dev). */
  baseUrl: string;
  /** Timeout por request en ms (también se pasa a Firecrawl como `timeout`). */
  timeoutMs: number;
}

// Pricing dinámico: un scrape simple (markdown) es barato; la extracción estructurada
// (json/product) usa un LLM en el lado de Firecrawl y cuesta más.
//   - scrape plano           → floor 0.002 USDC
//   - extracción estructurada → 0.005 USDC (prompt/schema o formato product/json)
export const PRICE_SCRAPE_USDC = 0.002;
export const PRICE_EXTRACT_USDC = 0.005;

// Tope del markdown devuelto. Una página completa puede traer cientos de KB y reventar al
// cliente MCP (Claude/ChatGPT trunca la respuesta y el modelo solo ve un fragmento roto,
// p.ej. "[L7] {"). En scrapes de markdown lo truncamos a este tamaño con una nota.
export const MAX_MARKDOWN_CHARS = 25_000;

/**
 * Sitios que pintan el contenido con JavaScript después de la carga: sin esperar, Firecrawl
 * devuelve solo el menú y el pie (medido en YouTube: 1 KB sin espera, 25 KB con 8 s).
 * Clave = sufijo del host; valor = ms de espera cuando el caller no fija `waitFor`.
 */
export const DEFAULT_WAIT_FOR_MS: Record<string, number> = { 'youtube.com': 8000 };
/** Espera del único reintento cuando una página llega vacía y el caller no fijó `waitFor`. */
export const RETRY_WAIT_FOR_MS = 8000;
/** Texto plano (sin enlaces ni imágenes) por debajo del cual una página cuenta como vacía. */
export const MIN_CONTENT_CHARS = 80;
/** Con esta cantidad de enlaces o más, una página sin texto es un índice, no una página vacía. */
export const MIN_LINKS_AS_INDEX = 30;

/** Instrucción que acompaña a todo prompt de extracción: el formato de salida admite "sin resultados". */
export const NO_INVENT_GUARD =
  'Extract only data that appears literally on the page. If the page has no such data (for example it ' +
  'shows only navigation, a consent screen, an error or no results), return empty values or an empty list. ' +
  'Never invent URLs, titles, names or example data.';

/** Normaliza formats a un array de strings en minúscula. */
export function normalizeFormats(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((f) => String(f).toLowerCase().trim());
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((f) => f.toLowerCase().trim())
      .filter(Boolean);
  }
  return [];
}

/** ¿la request pide extracción estructurada (LLM) y no solo markdown? */
export function wantsExtraction(req: unknown): boolean {
  const r = (req ?? {}) as Record<string, unknown>;
  const hasPrompt = Boolean(r.prompt ?? r.query ?? r.question ?? r.extract ?? r.instructions);
  const hasSchema = Boolean(r.schema);
  const fmts = normalizeFormats(r.formats ?? r.format);
  const hasStructuredFormat = fmts.some((f) => f === 'json' || f === 'product');
  return hasPrompt || hasSchema || hasStructuredFormat;
}

/** Precio (USDC) para esta request: extracción cuesta más que un scrape plano. */
export function priceFor(req: unknown): number {
  return wantsExtraction(req) ? PRICE_EXTRACT_USDC : PRICE_SCRAPE_USDC;
}

/** Espera por defecto según el host (ver DEFAULT_WAIT_FOR_MS); undefined si no aplica. */
export function defaultWaitFor(url: string): number | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  for (const [suffix, ms] of Object.entries(DEFAULT_WAIT_FOR_MS)) {
    if (host === suffix || host.endsWith('.' + suffix)) return ms;
  }
  return undefined;
}

/**
 * Construye el body para POST /v2/scrape. Los LLMs adivinan nombres de campo,
 * así que aceptamos varios sinónimos para url y prompt.
 */
export function buildScrapeBody(
  req: FirecrawlRequest,
  timeoutMs: number,
): { url: string; body: Record<string, unknown>; extraction: boolean; waitForExplicit: boolean } {
  const r = req as Record<string, unknown>;
  const url = String(r.url ?? r.link ?? r.page ?? r.website ?? r.target ?? '').trim();
  if (!url) {
    throw new Error("missing 'url' — pasa la URL de la página a cargar (ej. { url: 'https://...' })");
  }

  const promptRaw = (r.prompt ?? r.query ?? r.question ?? r.extract ?? r.instructions) as
    | string
    | undefined;
  const schema = r.schema as Record<string, unknown> | undefined;
  const requested = normalizeFormats(r.formats ?? r.format);
  // Todo prompt de extracción lleva la guarda: el LLM de Firecrawl rellena cualquier formato que
  // exija una lista aunque la página esté vacía; con permiso explícito para devolver vacío, no.
  const prompt = promptRaw ? `${String(promptRaw).trim()}\n\n${NO_INVENT_GUARD}` : NO_INVENT_GUARD;
  const jsonBlock = { type: 'json', prompt, ...(schema ? { schema } : {}) };

  // Construye la lista de formats que entiende Firecrawl v2.
  // Siempre incluimos markdown salvo que el usuario pida formats explícitos sin él,
  // para que el resultado sea legible además de estructurado.
  const formats: Array<string | Record<string, unknown>> = [];
  const simple = new Set(['markdown', 'html', 'rawhtml', 'links', 'images', 'summary', 'product']);
  for (const f of requested) {
    if (f === 'json') {
      formats.push(jsonBlock);
    } else if (simple.has(f)) {
      formats.push(f === 'rawhtml' ? 'rawHtml' : f);
    }
  }

  // Si hay prompt/schema pero no se pidió json explícito → agregar extracción json.
  const hasJson = formats.some((f) => typeof f === 'object' && (f as { type?: string }).type === 'json');
  if ((promptRaw || schema) && !hasJson) {
    formats.push(jsonBlock);
  }

  // Extracción manda: si se pide JSON (prompt/schema/json), devolvemos SOLO datos y quitamos
  // markdown AUNQUE el caller lo haya pedido — el markdown completo de la página revienta a los
  // clientes MCP (truncan la respuesta y el modelo no ve los datos). Sin extracción, garantiza
  // markdown.
  const hasJsonFmt = formats.some((f) => typeof f === 'object' && (f as { type?: string }).type === 'json');
  if (hasJsonFmt) {
    for (let i = formats.length - 1; i >= 0; i--) if (formats[i] === 'markdown') formats.splice(i, 1);
  } else if (!formats.some((f) => f === 'markdown')) {
    formats.unshift('markdown');
  }

  const onlyMainContent = typeof r.onlyMainContent === 'boolean' ? r.onlyMainContent : true;

  // Opciones anti-bot / geolocalización (passthrough a Firecrawl v2).
  // Default a 'stealth': este agente sirve páginas con anti-bot (Amazon, MercadoLibre…),
  // así que si el caller no especifica proxy, usamos stealth para que "simplemente funcione"
  // sin que el modelo (Claude/ChatGPT) tenga que saber pasarlo. Override: 'basic' | 'auto'.
  const proxy = ['basic', 'stealth', 'auto'].includes(String(r.proxy)) ? String(r.proxy) : 'stealth';
  const explicitWait = Number.isFinite(Number(r.waitFor)) && Number(r.waitFor) > 0 ? Number(r.waitFor) : undefined;
  const waitFor = explicitWait ?? defaultWaitFor(url);
  const loc = (r.location ?? undefined) as { country?: string; languages?: string[] } | undefined;
  const country = (loc?.country ?? (r.country as string | undefined))?.toUpperCase();
  const location = country ? { country, ...(loc?.languages ? { languages: loc.languages } : {}) } : undefined;

  return {
    url,
    body: {
      url,
      formats,
      onlyMainContent,
      timeout: timeoutMs,
      ...(proxy ? { proxy } : {}),
      ...(waitFor ? { waitFor } : {}),
      ...(location ? { location } : {}),
    },
    extraction: hasJsonFmt,
    waitForExplicit: explicitWait !== undefined,
  };
}

/** Traduce el error de Firecrawl a su causa; lo desconocido conserva el detalle crudo. */
export function describeFirecrawlError(status: number, json: Record<string, unknown>, url: string): string {
  const code = String(json.code ?? '');
  const detail =
    (typeof json.error === 'string' && json.error) || (json.details ? JSON.stringify(json.details) : '') || `HTTP ${status}`;
  if (code === 'SCRAPE_ALL_ENGINES_FAILED') {
    return `sitio bloqueado o inaccesible: ${url} no se pudo cargar (bloquea el acceso automatizado, no existe o está caído)`;
  }
  if (code === 'UNSUPPORTED_SITE' || /do not support this site/i.test(detail)) {
    return `sitio no soportado: el scraper no puede leer ${url}`;
  }
  if (code === 'SCRAPE_TIMEOUT' || /timed? ?out/i.test(detail)) {
    return `tiempo de espera agotado cargando ${url}`;
  }
  if (status === 429) return 'límite de peticiones del scraper alcanzado; reintenta en unos segundos';
  if (status === 402) return 'créditos del scraper agotados';
  return `Firecrawl ${status}: ${detail}`;
}

/** POST {baseUrl}/v2/scrape y devuelve el objeto `data` (lanza con mensaje claro si falla). */
export async function callFirecrawl(
  config: ScrapeConfig,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs + 5_000);
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v2/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Sin key → modo free tier (sin Authorization). Con key → límites altos.
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Firecrawl timeout tras ${config.timeoutMs}ms cargando la página`);
    }
    throw new Error(`Firecrawl request falló: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.success === false) {
    throw new Error(describeFirecrawlError(res.status, json, String(body.url ?? '')));
  }
  const data = json.data as Record<string, unknown> | undefined;
  if (!data) throw new Error('Firecrawl devolvió una respuesta sin data');
  return data;
}

// ─── Control de calidad ────────────────────────────────────────────────────────

export interface ContentStats {
  /** Caracteres de texto plano: sin enlaces, imágenes ni URLs. */
  plainChars: number;
  /** Enlaces en el markdown. */
  links: number;
  /** Pantalla de consentimiento, captcha o bloqueo (y poco texto más). */
  blocked: boolean;
}

const BLOCKED_RE =
  /before you continue|accept all cookies|verify you are human|are you a robot|captcha|checking your browser|access denied|enable javascript|just a moment/i;

/** Mide cuánto contenido real trae un markdown (el menú y el pie son enlaces, no texto). */
export function contentStats(markdown: unknown): ContentStats {
  const md = typeof markdown === 'string' ? markdown : '';
  const links = (md.match(/\]\((?:https?:\/\/|\/)/g) ?? []).length;
  const plain = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_`|\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { plainChars: plain.length, links, blocked: BLOCKED_RE.test(md) && plain.length < 2000 };
}

/** ¿la página llegó sin contenido útil (solo menú y pie) o es una pantalla de consentimiento/captcha? */
export function isEmptyContent(stats: ContentStats): boolean {
  return stats.blocked || (stats.plainChars < MIN_CONTENT_CHARS && stats.links < MIN_LINKS_AS_INDEX);
}

/** Mensaje de error para una página de la que no hay nada que leer. */
export function describeEmptyPage(url: string, metadata: Record<string, unknown> | undefined, stats: ContentStats): string {
  const status = Number(metadata?.statusCode);
  if (stats.blocked) {
    return `página de consentimiento o captcha: ${url} pide aceptar cookies o verificar que no eres un robot; no hay contenido que leer`;
  }
  if (status === 404) return `página no encontrada: ${url} respondió 404`;
  if (status === 401 || status === 403) {
    return `sitio bloqueado: ${url} respondió ${status} (bloquea el acceso automatizado o requiere sesión)`;
  }
  if (status >= 500) return `el sitio falló: ${url} respondió ${status}`;
  return `página sin contenido: ${url} solo trae menú y pie de página (el contenido se pinta con JavaScript tras la carga o requiere sesión); nada que leer ni extraer`;
}

const URL_RE = /^https?:\/\/\S+$/i;
const TITLE_KEY_RE = /^(title|name|headline|heading|t[ií]tulo|nombre|label)$/i;

/** Deshace los escapes JSON (&, \/) y entidades HTML con que el contenido crudo esconde las URLs. */
function decodeEscapes(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Solo letras y números, en minúscula: para comparar títulos sin que la puntuación estorbe. */
const alnum = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

type Failure = { path: string; value: string; kind: 'url' | 'title' };

/**
 * Contrasta lo extraído por el LLM con el contenido descargado (markdown + HTML crudo).
 *   - Una URL aparece si está literal, o su ruta+query, o un valor largo de su query (p.ej. el
 *     id de vídeo), o su ruta sin query.
 *   - Un título aparece si su texto (solo letras y números) está en la página.
 * Un registro de una lista se descarta si trae una URL ajena a la página o, sin URL, un título
 * ajeno. Fuera de listas, una URL ajena se vuelve null. El resto se devuelve intacto.
 */
export function verifyExtracted(extracted: unknown, content: string): { value: unknown; verification: Verification } {
  const raw = decodeEscapes(content);
  const flat = alnum(raw);

  const isUrl = (v: unknown): v is string => typeof v === 'string' && URL_RE.test(v.trim());
  const urlPresent = (u: string): boolean => {
    const url = decodeEscapes(u.trim());
    if (raw.includes(url)) return true;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const key = (parsed.pathname + parsed.search).replace(/\/$/, '');
    if (key.length > 1 && raw.includes(key)) return true;
    for (const v of parsed.searchParams.values()) if (v.length >= 6 && raw.includes(v)) return true;
    const path = parsed.pathname.replace(/\/$/, '');
    return !parsed.search && path.length > 3 && raw.includes(path);
  };
  const titlePresent = (t: string): boolean => {
    const k = alnum(t);
    return k.length < 4 || flat.includes(k);
  };

  /** Busca, en profundidad, los valores de un registro que no aparecen en la página. */
  const scan = (node: unknown, path: string, out: { urls: number; fails: Failure[] }): void => {
    if (Array.isArray(node)) {
      node.forEach((x, i) => scan(x, `${path}[${i}]`, out));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (isUrl(v)) {
          out.urls++;
          if (!urlPresent(v)) out.fails.push({ path: `${path}.${k}`, value: v, kind: 'url' });
        } else if (typeof v === 'string' && TITLE_KEY_RE.test(k)) {
          if (!titlePresent(v)) out.fails.push({ path: `${path}.${k}`, value: v, kind: 'title' });
        } else if (v && typeof v === 'object') {
          scan(v, `${path}.${k}`, out);
        }
      }
      return;
    }
    if (isUrl(node)) {
      out.urls++;
      if (!urlPresent(node)) out.fails.push({ path, value: node, kind: 'url' });
    }
  };

  /** Cuántas URLs y títulos hay para revisar. */
  const count = (node: unknown): number => {
    if (Array.isArray(node)) return node.reduce((n: number, x) => n + count(x), 0);
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).reduce(
        (n, [k, v]) => n + (isUrl(v) || (typeof v === 'string' && TITLE_KEY_RE.test(k)) ? 1 : count(v)),
        0,
      );
    }
    return isUrl(node) ? 1 : 0;
  };

  const dropped: Verification['dropped'] = [];
  const keepRecord = (rec: unknown, path: string): boolean => {
    const out = { urls: 0, fails: [] as Failure[] };
    scan(rec, path, out);
    const bad =
      out.fails.find((f) => f.kind === 'url') ?? (out.urls === 0 ? out.fails.find((f) => f.kind === 'title') : undefined);
    if (bad) dropped.push({ path: bad.path, value: bad.value });
    return !bad;
  };

  const clean = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      node.forEach((x, i) => {
        const p = `${path}[${i}]`;
        if (Array.isArray(x)) out.push(clean(x, p));
        else if ((x && typeof x === 'object') || isUrl(x)) {
          if (keepRecord(x, p)) out.push(x);
        } else out.push(x);
      });
      return out;
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const p = `${path}.${k}`;
        if (isUrl(v)) {
          if (urlPresent(v)) out[k] = v;
          else {
            out[k] = null;
            dropped.push({ path: p, value: v });
          }
        } else if (v && typeof v === 'object') out[k] = clean(v, p);
        else out[k] = v;
      }
      return out;
    }
    return node;
  };

  return { value: clean(extracted, '$'), verification: { checked: count(extracted), dropped } };
}

/**
 * Trae el contenido y garantiza que no esté vacío: si llega solo menú y pie y el caller no fijó
 * espera, reintenta una vez con una carga fresca (sin caché: Firecrawl guarda la última carga de
 * la URL, que puede ser una sin espera) dando tiempo al JavaScript; si sigue vacío, error claro.
 */
async function fetchContent(
  config: ScrapeConfig,
  body: Record<string, unknown>,
  url: string,
  waitForExplicit: boolean,
): Promise<{ data: Record<string, unknown>; waitFor?: number }> {
  let data = await callFirecrawl(config, body);
  let stats = contentStats(data.markdown);
  if (!isEmptyContent(stats)) return { data, waitFor: body.waitFor as number | undefined };
  if (!waitForExplicit) {
    const waitFor = (body.waitFor as number | undefined) ?? RETRY_WAIT_FOR_MS;
    data = await callFirecrawl(config, { ...body, waitFor, maxAge: 0 });
    stats = contentStats(data.markdown);
    if (!isEmptyContent(stats)) return { data, waitFor };
  }
  throw new Error(describeEmptyPage(url, data.metadata as Record<string, unknown> | undefined, stats));
}

/** Wrapper completo: arma el request, llama a Firecrawl, controla la calidad y mapea la respuesta. */
export async function scrape(config: ScrapeConfig, req: FirecrawlRequest): Promise<FirecrawlResponse> {
  const { url, body, extraction, waitForExplicit } = buildScrapeBody(req, config.timeoutMs);
  const r = req as Record<string, unknown>;
  // El control de vacío aplica cuando lo pedido es el contenido: markdown (default) o extracción.
  // Quien pide links/html/etc. recibe lo que haya.
  const checksContent = extraction || normalizeFormats(r.formats ?? r.format).every((f) => f === 'markdown');

  let data: Record<string, unknown>;
  let verification: Verification | undefined;
  if (extraction) {
    // Paso 1: el contenido. Si la página llega vacía, no se pasa a la IA (ni se paga su extracción).
    const page = await fetchContent(config, { ...body, formats: ['markdown', 'rawHtml'] }, url, waitForExplicit);
    // Paso 2: la extracción, con la misma espera que trajo el contenido (Firecrawl reutiliza la carga).
    data = await callFirecrawl(config, { ...body, ...(page.waitFor ? { waitFor: page.waitFor } : {}) });
    // La URL pedida cuenta como contenido: el LLM suele devolverla como fuente.
    const content = `${url}\n${typeof page.data.markdown === 'string' ? page.data.markdown : ''}\n${
      typeof page.data.rawHtml === 'string' ? page.data.rawHtml : ''
    }`;
    const checked = verifyExtracted(data.json, content);
    data = { ...data, json: checked.value };
    verification = checked.verification;
  } else if (checksContent) {
    ({ data } = await fetchContent(config, body, url, waitForExplicit));
  } else {
    data = await callFirecrawl(config, body);
  }

  // En extracción NO devolvemos markdown (aunque Firecrawl lo traiga o el caller lo pida): el
  // markdown completo revienta a los clientes MCP. En scrape plano lo topamos a MAX_MARKDOWN_CHARS.
  const rawMd = wantsExtraction(req) ? undefined : (data.markdown as string | undefined);
  const markdown =
    typeof rawMd === 'string' && rawMd.length > MAX_MARKDOWN_CHARS
      ? rawMd.slice(0, MAX_MARKDOWN_CHARS) + `\n\n…[truncado: ${rawMd.length - MAX_MARKDOWN_CHARS} caracteres más]`
      : rawMd;

  // metadata curado: solo lo útil/presentable. La cruda trae tokens cifrados y meta-tags que
  // inflan la respuesta del cliente MCP sin aportar nada.
  const rawMeta = (data.metadata as Record<string, unknown>) ?? {};
  const metadata: Record<string, unknown> = {};
  for (const k of ['title', 'statusCode', 'sourceURL', 'contentType', 'proxyUsed', 'cacheState', 'creditsUsed']) {
    if (rawMeta[k] !== undefined) metadata[k] = rawMeta[k];
  }

  const note =
    verification && verification.dropped.length > 0
      ? `${verification.dropped.length} dato(s) descartado(s) por no aparecer en la página: ${verification.dropped
          .slice(0, 5)
          .map((d) => d.value)
          .join(', ')}`
      : undefined;

  return {
    url,
    markdown,
    extracted: data.json,
    ...(verification ? { verification } : {}),
    ...(note ? { note } : {}),
    product: data.product,
    links: data.links as string[] | undefined,
    metadata,
    scrapedAt: Math.floor(Date.now() / 1000),
  };
}
