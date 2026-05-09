/**
 * Price Oracle — agente DEMO mockeado.
 *
 * Precios crypto en tiempo real (mock). Datos hardcoded con jitter para
 * que cada call devuelva un valor ligeramente distinto y se vea "live".
 */
import { AgentProvider, loadOrCreateKeypair } from '@agent-bazaar/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/price-oracle.json';
const wallet = loadOrCreateKeypair(KEYPAIR_PATH);

const agent = new AgentProvider({
  wallet,
  service: 'price-oracle',
  pricePerCall: 0.001,
  description:
    'Real-time cryptocurrency prices aggregated from major exchanges (Binance, Coinbase, Kraken)',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5004',
});

interface PriceRequest {
  symbol: string;
  vs?: string;
}

interface PriceResponse {
  symbol: string;
  vs: string;
  price: number;
  change24h: number;
  sources: { name: string; price: number }[];
  timestamp: number;
}

const BASE_PRICES: Record<string, number> = {
  SOL: 152.4,
  BTC: 102_300,
  ETH: 3_840,
  USDC: 1.0,
  BONK: 0.0000245,
  JUP: 0.92,
  WIF: 1.41,
  PYTH: 0.34,
};

function jitter(base: number): number {
  return base * (1 + (Math.random() - 0.5) * 0.005);
}

agent.serve<PriceRequest, PriceResponse>(async (req) => {
  const symbol = (req.symbol || 'SOL').toUpperCase();
  const base = BASE_PRICES[symbol] ?? 1.0;
  const price = jitter(base);
  return {
    symbol,
    vs: (req.vs ?? 'USD').toUpperCase(),
    price,
    change24h: (Math.random() - 0.4) * 8,
    sources: [
      { name: 'Binance', price: jitter(base) },
      { name: 'Coinbase', price: jitter(base) },
      { name: 'Kraken', price: jitter(base) },
    ],
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
  await agent.listen(5004);
})().catch((err) => {
  console.error('[price-oracle] failed to start:', err);
  process.exit(1);
});
