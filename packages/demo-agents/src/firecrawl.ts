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
 * La key (FIRECRAWL_API_KEY) es OPCIONAL: sin ella el agente corre en el free tier
 * sin auth de Firecrawl (límites bajos) — basta para la demo. Con key se obtienen
 * límites altos, extracción estructurada y proxy 'stealth'.
 * (key gratis en https://www.firecrawl.dev/app/api-keys).
 *
 * Este archivo es solo el "pegamento": toda la lógica del wrapper (request, llamada
 * HTTP, mapeo de respuesta, pricing) vive en ./firecrawl-core, testeada y auditable.
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';
import {
  scrape,
  priceFor,
  PRICE_SCRAPE_USDC,
  PRICE_EXTRACT_USDC,
  type FirecrawlRequest,
  type FirecrawlResponse,
  type ScrapeConfig,
} from './firecrawl-core';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/firecrawl.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

const config: ScrapeConfig = {
  apiKey: process.env.FIRECRAWL_API_KEY || '',
  baseUrl: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
  timeoutMs: Number(process.env.FIRECRAWL_TIMEOUT_MS) || 60_000,
};

const agent = new AgentProvider({
  wallet,
  // El nombre on-chain 'firecrawl' quedó bloqueado: existe un registro huérfano de un
  // run local viejo (endpoint http://demo-agents:5006) cuyo keypair dueño se perdió, y
  // el contrato registry solo deja al dueño actualizar/desregistrar (sin admin). Así que
  // este agente se publica bajo un nombre libre. Es el nombre con el que se invoca:
  // call_agent('web-scraper', { url, prompt }).
  service: 'web-scraper',
  pricePerCall: PRICE_SCRAPE_USDC,
  pricingNote: `Scrape de página ${PRICE_SCRAPE_USDC} USDC · extracción estructurada (precio/datos con prompt) ${PRICE_EXTRACT_USDC} USDC`,
  priceFn: (req: unknown) => priceFor(req),
  description:
    'Web scraper en vivo (Firecrawl). Carga contenido dinámico que requiere render de JavaScript y lo devuelve como markdown limpio, o extrae datos estructurados (precios, stock, especificaciones) de una URL con un prompt. Ideal para precios de productos en Amazon, MercadoLibre y tiendas online, artículos detrás de paywalls de render, y páginas que los asistentes no pueden leer solos. Web scraping, price scraping, product data extraction.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5006',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

agent.serve<FirecrawlRequest, FirecrawlResponse>((req) => scrape(config, req));

(async () => {
  if (!config.apiKey) {
    console.warn(
      '[firecrawl] FIRECRAWL_API_KEY sin setear — corriendo en el free tier sin auth de ' +
        'Firecrawl (límites bajos). Para límites altos, extracción estructurada y proxy ' +
        "'stealth', crea una key en https://www.firecrawl.dev/app/api-keys.",
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
