/**
 * Risk Auditor — agente DEMO mockeado.
 *
 * Phase 2: registro on-chain + verificación x402 real.
 * Phase 3 (TODO): análisis estático real de programas Anchor.
 */
import { AgentProvider, loadOrCreateKeypair } from '@agent-bazaar/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/risk-auditor.json';
const wallet = loadOrCreateKeypair(KEYPAIR_PATH);

const agent = new AgentProvider({
  wallet,
  service: 'risk-auditor',
  pricePerCall: 0.02,
  description: 'Analiza el riesgo de un smart contract / protocolo Solana',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5002',
});

interface RiskRequest {
  programId?: string;
  protocol?: string;
}

interface RiskResponse {
  score: number;
  rating: 'low' | 'medium' | 'high';
  factors: { name: string; impact: 'positive' | 'negative'; weight: number }[];
  summary: string;
}

const MOCK_RISK: Record<string, RiskResponse> = {
  Kamino: {
    score: 8.5,
    rating: 'low',
    factors: [
      { name: 'auditado por OtterSec', impact: 'positive', weight: 0.4 },
      { name: 'TVL > $100M', impact: 'positive', weight: 0.3 },
      { name: '12 meses sin incidentes', impact: 'positive', weight: 0.2 },
      { name: 'admin keys con multisig 4/7', impact: 'positive', weight: 0.1 },
    ],
    summary: 'Riesgo BAJO — protocolo maduro con auditorías y track record.',
  },
  Lulo: {
    score: 7.2,
    rating: 'low',
    factors: [
      { name: 'auditado', impact: 'positive', weight: 0.4 },
      { name: 'TVL moderado', impact: 'positive', weight: 0.3 },
      { name: 'agregador (riesgo de protocolos subyacentes)', impact: 'negative', weight: 0.3 },
    ],
    summary: 'Riesgo BAJO-MEDIO — agregador, hereda riesgo de Kamino/Drift/MarginFi.',
  },
  default: {
    score: 5.0,
    rating: 'medium',
    factors: [{ name: 'protocolo no en base de datos', impact: 'negative', weight: 1.0 }],
    summary: 'Riesgo MEDIO — no hay datos suficientes, proceder con precaución.',
  },
};

agent.serve<RiskRequest, RiskResponse>(async (req) => {
  const key = req.protocol ?? 'default';
  return MOCK_RISK[key] ?? MOCK_RISK.default;
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[risk-auditor] bootstrap failed:', (err as Error).message);
    console.error('[risk-auditor] Continuing without on-chain registration. Make sure PROGRAM_ID is set in .env after deploying the contract.');
  }
  await agent.listen(5002);
})().catch((err) => {
  console.error('[risk-auditor] failed to start:', err);
  process.exit(1);
});
