/**
 * Firecrawl — agente REAL (no mockeado).
 *
 * Carga contenido dinámico de la web que los asistentes generales NO resuelven
 * solos: páginas que requieren render JS, scraping de productos, precios en vivo,
 * etc. Por debajo usa la API de Firecrawl (https://firecrawl.dev, endpoint v2).
 *
 * Casos típicos:
 *   - "¿cuál es el precio más barato de este producto en Amazon/MercadoLibre?"
 *     → se le pasa la URL del producto + un prompt de extracción y devuelve el precio.
 *   - "resume esta página" / "tráeme el contenido de este artículo" → markdown limpio.
 *
 * Igual que el resto de agentes:
 *   - registra el servicio on-chain en bootstrap()
 *   - cobra vía x402 (verificación de escrow en Soroban antes de servir)
 * La diferencia es que el handler hace trabajo REAL contra la API de Firecrawl.
 *
 * Requiere FIRECRAWL_API_KEY en el entorno (https://www.firecrawl.dev/app/api-keys).
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/firecrawl.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev';
const REQUEST_TIMEOUT_MS = Number(process.env.FIRECRAWL_TIMEOUT_MS) || 60_000;

// Pricing dinámico: un scrape simple (markdown) es barato; la extracción
// estructurada (json/product) usa un LLM en el lado de Firecrawl y cuesta más.
//   - scrape plano           → floor 0.002 USDC
//   - extracción estructurada → 0.005 USDC (prompt/schema o formato product/json)
const PRICE_SCRAPE_USDC = 0.002;
const PRICE_EXTRACT_USDC = 0.005;

/** ¿la request pide extracción estructurada (LLM) y no solo markdown? */
function wantsExtraction(req: unknown): boolean {
  const r = (req ?? {}) as Record<string, unknown>;
  const hasPrompt = Boolean(r.prompt ?? r.query ?? r.question ?? r.extract ?? r.instructions);
  const hasSchema = Boolean(r.schema);
  const fmts = normalizeFormats(r.formats ?? r.format);
  const hasStructuredFormat = fmts.some((f) => f === 'json' || f === 'product');
  return hasPrompt || hasSchema || hasStructuredFormat;
}

const agent = new AgentProvider({
  wallet,
  service: 'firecrawl',
  pricePerCall: PRICE_SCRAPE_USDC,
  pricingNote: `Scrape de página ${PRICE_SCRAPE_USDC} USDC · extracción estructurada (precio/datos con prompt) ${PRICE_EXTRACT_USDC} USDC`,
  priceFn: (req: unknown) => (wantsExtraction(req) ? PRICE_EXTRACT_USDC : PRICE_SCRAPE_USDC),
  description:
    'Web scraper en vivo (Firecrawl). Carga contenido dinámico que requiere render de JavaScript y lo devuelve como markdown limpio, o extrae datos estructurados (precios, stock, especificaciones) de una URL con un prompt. Ideal para precios de productos en Amazon, MercadoLibre y tiendas online, artículos detrás de paywalls de render, y páginas que los asistentes no pueden leer solos. Web scraping, price scraping, product data extraction.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5006',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

interface FirecrawlRequest {
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

interface FirecrawlResponse {
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

/** Normaliza formats a un array de strings en minúscula. */
function normalizeFormats(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((f) => String(f).toLowerCase().trim());
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((f) => f.toLowerCase().trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Construye el body para POST /v2/scrape. Los LLMs adivinan nombres de campo,
 * así que aceptamos varios sinónimos para url y prompt.
 */
function buildScrapeBody(req: FirecrawlRequest): { url: string; body: Record<string, unknown> } {
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
      timeout: REQUEST_TIMEOUT_MS,
      ...(proxy ? { proxy } : {}),
      ...(waitFor ? { waitFor } : {}),
      ...(location ? { location } : {}),
    },
  };
}

async function callFirecrawl(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error(
      'FIRECRAWL_API_KEY no configurada — el agente no puede scrapear. ' +
        'Crea una key gratis en https://www.firecrawl.dev/app/api-keys y exporta FIRECRAWL_API_KEY.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS + 5_000);
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_BASE_URL}/v2/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Firecrawl timeout tras ${REQUEST_TIMEOUT_MS}ms cargando la página`);
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

agent.serve<FirecrawlRequest, FirecrawlResponse>(async (req) => {
  const { url, body } = buildScrapeBody(req);
  const data = await callFirecrawl(body);

  return {
    url,
    markdown: data.markdown as string | undefined,
    extracted: data.json,
    product: data.product,
    links: data.links as string[] | undefined,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    scrapedAt: Math.floor(Date.now() / 1000),
  };
});

(async () => {
  if (!FIRECRAWL_API_KEY) {
    console.warn(
      '[firecrawl] FIRECRAWL_API_KEY no está seteada — el agente arrancará y se registrará ' +
        'on-chain, pero cada scrape fallará hasta que configures la key.',
    );
  }
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[firecrawl] bootstrap failed:', (err as Error).message);
    console.error('[firecrawl] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5006);
})().catch((err) => {
  console.error('[firecrawl] failed to start:', err);
  process.exit(1);
});
