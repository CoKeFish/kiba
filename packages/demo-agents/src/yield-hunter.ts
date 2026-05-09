/**
 * Yield Hunter — agente DEMO mockeado.
 *
 * Phase 2: usa el SDK con on-chain registration + x402 verification real.
 * En `bootstrap()`:
 *   - Carga (o crea) keypair persistente en /app/data
 *   - Pide airdrop si balance bajo
 *   - Registra el servicio on-chain si no existe
 *
 * Phase 3 (TODO): consultar APYs reales vía Helius/Birdeye en lugar de mocks.
 */
import { AgentProvider, loadOrCreateKeypair } from '@agent-bazaar/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/yield-hunter.json';
const wallet = loadOrCreateKeypair(KEYPAIR_PATH);

const agent = new AgentProvider({
  wallet,
  service: 'yield-hunter',
  pricePerCall: 0.01, // SOL
  description: 'Encuentra el mejor APY entre protocolos DeFi en Solana',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5001',
});

const MOCK_YIELDS = [
  { protocol: 'Kamino', token: 'USDC', apy: 9.2, tvl: 145_000_000 },
  { protocol: 'Lulo', token: 'USDC', apy: 8.5, tvl: 89_000_000 },
  { protocol: 'MarginFi', token: 'USDC', apy: 7.1, tvl: 320_000_000 },
  { protocol: 'Drift', token: 'USDC', apy: 6.8, tvl: 210_000_000 },
];

interface YieldRequest {
  token?: string;
  amount?: number;
  riskTolerance?: 'low' | 'medium' | 'high';
}

interface YieldResponse {
  best: typeof MOCK_YIELDS[number];
  alternatives: typeof MOCK_YIELDS;
  reasoning: string;
}

agent.serve<YieldRequest, YieldResponse>(async (req) => {
  const filtered = MOCK_YIELDS.filter((y) => (req.token ? y.token === req.token : true));
  const sorted = [...filtered].sort((a, b) => b.apy - a.apy);
  return {
    best: sorted[0],
    alternatives: sorted.slice(1),
    reasoning: `Top APY: ${sorted[0].protocol} con ${sorted[0].apy}% (TVL $${(sorted[0].tvl / 1e6).toFixed(0)}M)`,
  };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[yield-hunter] bootstrap failed:', (err as Error).message);
    console.error('[yield-hunter] Continuing without on-chain registration. Make sure PROGRAM_ID is set in .env after deploying the contract.');
  }
  await agent.listen(5001);
})().catch((err) => {
  console.error('[yield-hunter] failed to start:', err);
  process.exit(1);
});
