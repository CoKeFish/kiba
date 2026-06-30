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
import { AgentProvider, loadKeypairFromEnvOrFile } from 'kiba-sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/yield-hunter.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico por nivel de análisis solicitado:
//   low    → solo top 1, snapshot ligero
//   medium → top 3 con comparación
//   high   → análisis completo + alternatives + reasoning extra
const PRICE_BY_RISK: Record<string, number> = {
  low: 0.005,
  medium: 0.01,
  high: 0.015,
};
const PRICE_FLOOR_USDC = Math.min(...Object.values(PRICE_BY_RISK));

const agent = new AgentProvider({
  wallet,
  service: 'yield-hunter',
  pricePerCall: PRICE_FLOOR_USDC,
  pricingNote: 'low risk = 0.005 USDC · medium = 0.01 USDC · high = 0.015 USDC (más análisis cuesta más)',
  priceFn: (req: unknown) => {
    const risk = (req as { riskTolerance?: string })?.riskTolerance ?? 'low';
    return PRICE_BY_RISK[risk] ?? PRICE_BY_RISK.low;
  },
  description:
    'Encuentra el mejor APY entre protocolos DeFi en Stellar. Pricing escalado por profundidad de análisis.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5001',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

const MOCK_YIELDS = [
  { protocol: 'Blend', token: 'USDC', apy: 9.2, tvl: 145_000_000 },
  { protocol: 'YieldBlox', token: 'USDC', apy: 8.5, tvl: 89_000_000 },
  { protocol: 'Aquarius', token: 'USDC', apy: 7.1, tvl: 320_000_000 },
  { protocol: 'Soroswap', token: 'USDC', apy: 6.8, tvl: 210_000_000 },
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
    console.error('[yield-hunter] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5001);
})().catch((err) => {
  console.error('[yield-hunter] failed to start:', err);
  process.exit(1);
});
