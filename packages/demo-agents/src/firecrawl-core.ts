/**
 * firecrawl-core — lógica del wrapper de Firecrawl, SIN dependencias del SDK ni de
 * express y SIN efectos de arranque (no abre puertos, no lee env al importar).
 *
 * Se separa de firecrawl.ts a propósito: el agente debe ser, en el fondo, un wrapper
 * fino sobre la API de Firecrawl. Aislar aquí la construcción del request, la llamada
 * HTTP y el mapeo de la respuesta permite:
 *   - testearlo de forma determinista (ver test/firecrawl.test.ts), y
 *   - auditarlo de un vistazo (toda la superficie "real" del agente vive aquí).
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

export interface FirecrawlResponse {
  url: string;
  /** Contenido de la página en markdown (si se pidió). */
  markdown?: string;
  /** Datos estructurados extraídos por el LLM (si se pidió prompt/schema/json). */
  extracted?: unknown;
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

/**
 * Construye el body para POST /v2/scrape. Los LLMs adivinan nombres de campo,
 * así que aceptamos varios sinónimos para url y prompt.
 */
export function buildScrapeBody(
  req: FirecrawlRequest,
  timeoutMs: number,
): { url: string; body: Record<string, unknown> } {
  const r = req as Record<string, unknown>;
  const url = String(r.url ?? r.link ?? r.page ?? r.website ?? r.target ?? '').trim();
  if (!url) {
    throw new Error("missing 'url' — pasa la URL de la página a cargar (ej. { url: 'https://...' })");
  }

  const prompt = (r.prompt ?? r.query ?? r.question ?? r.extract ?? r.instructions) as
    | string
    | undefined;
  const schema = r.schema as Record<string, unknown> | undefined;
  const requested = normalizeFormats(r.formats ?? r.format);

  // Construye la lista de formats que entiende Firecrawl v2.
  // Siempre incluimos markdown salvo que el usuario pida formats explícitos sin él,
  // para que el resultado sea legible además de estructurado.
  const formats: Array<string | Record<string, unknown>> = [];
  const simple = new Set(['markdown', 'html', 'rawhtml', 'links', 'images', 'summary', 'product']);
  for (const f of requested) {
    if (f === 'json') {
      formats.push({ type: 'json', ...(prompt ? { prompt } : {}), ...(schema ? { schema } : {}) });
    } else if (simple.has(f)) {
      formats.push(f === 'rawhtml' ? 'rawHtml' : f);
    }
  }

  // Si hay prompt/schema pero no se pidió json explícito → agregar extracción json.
  const hasJson = formats.some((f) => typeof f === 'object' && (f as { type?: string }).type === 'json');
  if ((prompt || schema) && !hasJson) {
    formats.push({ type: 'json', ...(prompt ? { prompt } : {}), ...(schema ? { schema } : {}) });
  }

  // Garantiza al menos markdown.
  const hasMarkdown = formats.some((f) => f === 'markdown');
  if (!hasMarkdown) formats.unshift('markdown');

  const onlyMainContent = typeof r.onlyMainContent === 'boolean' ? r.onlyMainContent : true;

  // Opciones anti-bot / geolocalización (passthrough a Firecrawl v2).
  const proxy = ['basic', 'stealth', 'auto'].includes(String(r.proxy)) ? String(r.proxy) : undefined;
  const waitFor = Number.isFinite(Number(r.waitFor)) && Number(r.waitFor) > 0 ? Number(r.waitFor) : undefined;
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
  };
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
    const detail = (json.error as string) || (json.details ? JSON.stringify(json.details) : '') || res.statusText;
    throw new Error(`Firecrawl ${res.status}: ${detail}`);
  }
  const data = json.data as Record<string, unknown> | undefined;
  if (!data) throw new Error('Firecrawl devolvió una respuesta sin data');
  return data;
}

/** Wrapper completo: arma el request, llama a Firecrawl y mapea la respuesta. */
export async function scrape(config: ScrapeConfig, req: FirecrawlRequest): Promise<FirecrawlResponse> {
  const { url, body } = buildScrapeBody(req, config.timeoutMs);
  const data = await callFirecrawl(config, body);

  return {
    url,
    markdown: data.markdown as string | undefined,
    extracted: data.json,
    product: data.product,
    links: data.links as string[] | undefined,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    scrapedAt: Math.floor(Date.now() / 1000),
  };
}
