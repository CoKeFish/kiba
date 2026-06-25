/**
 * Price Oracle — agente DEMO mockeado.
 *
 * Precios crypto en tiempo real (mock). Datos hardcoded con jitter para
 * que cada call devuelva un valor ligeramente distinto y se vea "live".
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/price-oracle.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por cada símbolo consultado.
// Floor 0.0005 XLM (cubre 1 símbolo), + 0.0005 XLM por símbolo extra.
// Consulta 1 precio ≈ 0.0005 XLM, 8 precios ≈ 0.004 XLM.
const PRICE_FLOOR_XLM = 0.0005;
const PRICE_PER_SYMBOL_XLM = 0.0005;

function countSymbols(req: unknown): number {
  const r = req as { symbol?: string; symbols?: string[] };
  if (Array.isArray(r?.symbols)) return Math.max(1, r.symbols.length);
  if (r?.symbol) return 1;
  return 1;
}

const agent = new AgentProvider({
  wallet,
  service: 'price-oracle',
  pricePerCall: PRICE_FLOOR_XLM,
  pricingNote: `${PRICE_PER_SYMBOL_XLM} XLM por símbolo cotizado (floor ${PRICE_FLOOR_XLM} XLM)`,
  priceFn: (req: unknown) => countSymbols(req) * PRICE_PER_SYMBOL_XLM,
  description:
    'Real-time cryptocurrency prices aggregated from major exchanges. Acepta símbolos individuales o batch. Cobra por símbolo cotizado.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5004',
});

interface PriceRequest {
  symbol?: string;
  symbols?: string[];
  vs?: string;
}

interface PricePoint {
  symbol: string;
  vs: string;
  price: number;
  change24h: number;
  sources: { name: string; price: number }[];
}

interface PriceResponse {
  prices: PricePoint[];
  count: number;
  timestamp: number;
}

const BASE_PRICES: Record<string, number> = {
  XLM: 0.12,
  BTC: 102_300,
  ETH: 3_840,
  USDC: 1.0,
  AQUA: 0.0021,
  YXLM: 0.13,
  SHX: 0.0009,
  EURC: 1.08,
};

function jitter(base: number): number {
  return base * (1 + (Math.random() - 0.5) * 0.005);
}

function quoteOne(symbol: string, vs: string): PricePoint {
  const sym = symbol.toUpperCase();
  const base = BASE_PRICES[sym] ?? 1.0;
  return {
    symbol: sym,
    vs: vs.toUpperCase(),
    price: jitter(base),
    change24h: (Math.random() - 0.4) * 8,
    sources: [
      { name: 'Binance', price: jitter(base) },
      { name: 'Coinbase', price: jitter(base) },
      { name: 'Kraken', price: jitter(base) },
    ],
  };
}

agent.serve<PriceRequest, PriceResponse>(async (req) => {
  const vs = req.vs ?? 'USD';
  const list = Array.isArray(req.symbols) && req.symbols.length > 0
    ? req.symbols
    : [req.symbol ?? 'XLM'];
  const prices = list.map((s) => quoteOne(s, vs));
  return {
    prices,
    count: prices.length,
    timestamp: Math.floor(Date.now() / 1000),
  };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[price-oracle] bootstrap failed:', (err as Error).message);
    console.error('[price-oracle] Continuing without on-chain registration. Make sure PROGRAM_ID is set in .env after deploying the contract.');
  }
  await agent.listen(Number(process.env.PORT) || 5004);
})().catch((err) => {
  console.error('[price-oracle] failed to start:', err);
  process.exit(1);
});
