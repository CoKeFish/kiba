/**
 * Web Brief — un servicio que PAGA A OTROS SERVICIOS para atender el pedido.
 *
 * Recibe una URL y un idioma, y entrega un informe breve de la página en ese idioma. No sabe
 * leer páginas ni traducir: contrata a `web-scraper` (lee y resume la página) y a
 * `translator-pro` (traduce el resumen) a través de Kiba, pagándolos con el saldo de su
 * publicador (`ctx.kiba`). Si se configura `WEB_BRIEF_X402_URL`, además consulta una API
 * externa que cobra con x402 estándar. El usuario paga UNA vez; Kiba liga cada pago del
 * servicio a su pedido y se lo muestra con su transacción en Stellar.
 *
 * Ejemplo vía call_agent:
 *   { "url": "https://stellar.org", "lang": "es" }
 *
 * Entorno: KIBA_URL y KIBA_API_KEY (la cuenta con la que este servicio paga a sus proveedores).
 */
import { AgentProvider, loadKeypairFromEnvOrFile, type CallContext } from 'kiba-sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/web-brief.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

/** Precio plano por informe. Cubre el scraper con extracción (0.005), la traducción (~0.003) y el margen. */
const PRICE_USDC = 0.02;
/** API x402 externa opcional (p. ej. un dato de contexto); vacío = no se consulta. */
const EXTRA_X402_URL = process.env.WEB_BRIEF_X402_URL || '';
const SUMMARY_PROMPT =
  'Resume el contenido principal de la página en 5 frases claras, y lista hasta 3 datos clave (nombres, cifras, fechas). Devuelve un objeto {"title": string, "summary": string, "facts": string[]}.';

interface BriefRequest {
  url?: string;
  link?: string;
  lang?: string;
  to?: string;
  language?: string;
}

interface ProviderPayment {
  service: string;
  costUsd: number;
  resultId?: string;
  explorerUrl?: string;
  txHash?: string;
}

interface ScraperResult {
  extracted?: unknown;
  markdown?: string;
  metadata?: Record<string, unknown>;
}

interface TranslatorResult {
  translated?: string;
  to?: string;
}

const LANG_ALIASES: Record<string, string> = {
  español: 'es',
  spanish: 'es',
  castellano: 'es',
  inglés: 'en',
  ingles: 'en',
  english: 'en',
  português: 'pt',
  portugues: 'pt',
  portuguese: 'pt',
  français: 'fr',
  french: 'fr',
};

function normalizeLang(raw: unknown): string {
  const s = String(raw ?? 'es').trim().toLowerCase();
  return (LANG_ALIASES[s] ?? s).slice(0, 2) || 'es';
}

/** Saca texto útil del resultado del scraper: la extracción si la hubo, si no el markdown recortado. */
function summaryFrom(scraped: ScraperResult): { title?: string; summary: string; facts: string[] } {
  const ex = scraped.extracted as { title?: unknown; summary?: unknown; facts?: unknown } | string | undefined;
  if (ex && typeof ex === 'object') {
    const summary = typeof ex.summary === 'string' ? ex.summary : JSON.stringify(ex);
    const facts = Array.isArray(ex.facts) ? ex.facts.map(String).slice(0, 3) : [];
    return { title: typeof ex.title === 'string' ? ex.title : undefined, summary, facts };
  }
  if (typeof ex === 'string' && ex.trim()) return { summary: ex.trim(), facts: [] };
  const md = (scraped.markdown ?? '').replace(/\s+/g, ' ').trim();
  const title = typeof scraped.metadata?.title === 'string' ? scraped.metadata.title : undefined;
  return { title, summary: md.slice(0, 800), facts: [] };
}

const agent = new AgentProvider({
  wallet,
  service: 'web-brief',
  pricePerCall: PRICE_USDC,
  pricingNote: `${PRICE_USDC} USDC por informe; incluye lo que el servicio paga a web-scraper y translator-pro`,
  description:
    'Informe breve de cualquier página web en tu idioma. Este servicio no lee ni traduce por sí mismo: contrata y paga a otros servicios de Kiba (web-scraper y translator-pro) con su propio saldo, y tu pedido muestra cada pago con su transacción en Stellar. Web page brief in your language, built by a service that pays other services.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5014',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
  // Con qué cuenta paga a sus proveedores (KIBA_URL / KIBA_API_KEY si no se pasa aquí).
  gateway: { url: process.env.KIBA_URL, apiKey: process.env.KIBA_API_KEY },
});

agent.serve<BriefRequest, unknown>(async (req, ctx: CallContext) => {
  const url = String(req?.url ?? req?.link ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('url requerida (http o https), por ejemplo { "url": "https://stellar.org", "lang": "es" }');
  const lang = normalizeLang(req?.lang ?? req?.to ?? req?.language);
  const payments: ProviderPayment[] = [];

  // 1. Leer y resumir la página: web-scraper (extracción con prompt).
  const scraped = await ctx.kiba.call<ScraperResult>('web-scraper', { url, prompt: SUMMARY_PROMPT });
  payments.push({
    service: 'web-scraper',
    costUsd: scraped.cost.usd,
    resultId: scraped.resultId,
    explorerUrl: scraped.explorerUrl,
  });
  const source = summaryFrom(scraped.result ?? {});
  if (!source.summary) throw new Error('la página no tiene contenido que resumir');

  // 2. Traducir el resumen al idioma pedido: translator-pro.
  const textToTranslate = [source.title, source.summary, ...source.facts].filter(Boolean).join('\n');
  const translated = await ctx.kiba.call<TranslatorResult>('translator-pro', { text: textToTranslate, to: lang });
  payments.push({
    service: 'translator-pro',
    costUsd: translated.cost.usd,
    resultId: translated.resultId,
    explorerUrl: translated.explorerUrl,
  });

  // 3. Opcional: una API externa que cobra con x402 estándar (contexto adicional).
  let extra: unknown;
  if (EXTRA_X402_URL) {
    const api = await ctx.kiba.callUrl(EXTRA_X402_URL, { maxUsd: 0.05 });
    payments.push({
      service: `x402:${new URL(EXTRA_X402_URL).host}`,
      costUsd: api.cost.usd,
      resultId: api.resultId,
      explorerUrl: api.explorerUrl,
      txHash: api.txHash,
    });
    extra = api.result;
  }

  const paidUsd = payments.reduce((sum, p) => sum + p.costUsd, 0);
  return {
    url,
    lang,
    brief: translated.result?.translated ?? textToTranslate,
    source: { title: source.title, summary: source.summary, facts: source.facts },
    ...(extra !== undefined ? { extra } : {}),
    // Lo que este servicio pagó a sus proveedores para atender el pedido (también lo lista Kiba en subCalls).
    providers: payments,
    paidByService: { usd: Number(paidUsd.toFixed(6)), payments: payments.length },
    ...(ctx.callId ? { callId: ctx.callId } : {}),
  };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[web-brief] bootstrap failed:', (err as Error).message);
    console.error('[web-brief] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  if (!agent.gateway.enabled) {
    console.warn('[web-brief] sin KIBA_API_KEY: el servicio arranca, pero no podrá pagar a web-scraper ni translator-pro');
  }
  await agent.listen(Number(process.env.PORT) || 5014);
})().catch((err) => {
  console.error('[web-brief] failed to start:', err);
  process.exit(1);
});
