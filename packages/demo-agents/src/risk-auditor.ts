/**
 * Risk Auditor — agente DEMO mockeado.
 *
 * Phase 2: registro on-chain + verificación x402 real.
 * Phase 3 (TODO): análisis estático real de programas Anchor.
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/risk-auditor.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por cada protocolo auditado.
// Floor 0.005 XLM (cubre 1 protocolo), + 0.005 XLM por protocolo adicional.
// Auditar 1 protocolo ≈ 0.005 XLM, 5 protocolos ≈ 0.025 XLM.
const PRICE_FLOOR_XLM = 0.005;
const PRICE_PER_PROTOCOL_XLM = 0.005;

function countProtocols(req: unknown): number {
  const r = req as { protocol?: string; protocols?: string[] };
  if (Array.isArray(r?.protocols)) return Math.max(1, r.protocols.length);
  if (r?.protocol) return 1;
  return 1; // default
}

const agent = new AgentProvider({
  wallet,
  service: 'risk-auditor',
  pricePerCall: PRICE_FLOOR_XLM,
  pricingNote: `${PRICE_PER_PROTOCOL_XLM} XLM por protocolo auditado (floor ${PRICE_FLOOR_XLM} XLM)`,
  priceFn: (req: unknown) => countProtocols(req) * PRICE_PER_PROTOCOL_XLM,
  description:
    'Analiza el riesgo de smart contracts / protocolos Stellar (Soroban). Acepta protocolos individuales o batch. Cobra por protocolo auditado.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5002',
});

interface RiskRequest {
  programId?: string;
  protocol?: string;
  protocols?: string[];
}

interface RiskReport {
  protocol: string;
  score: number;
  rating: 'low' | 'medium' | 'high';
  factors: { name: string; impact: 'positive' | 'negative'; weight: number }[];
  summary: string;
}

interface RiskResponse {
  audits: RiskReport[];
  count: number;
}

const MOCK_RISK: Record<string, Omit<RiskReport, 'protocol'>> = {
  Blend: {
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
  YieldBlox: {
    score: 7.2,
    rating: 'low',
    factors: [
      { name: 'auditado', impact: 'positive', weight: 0.4 },
      { name: 'TVL moderado', impact: 'positive', weight: 0.3 },
      { name: 'agregador (riesgo de protocolos subyacentes)', impact: 'negative', weight: 0.3 },
    ],
    summary: 'Riesgo BAJO-MEDIO — agregador, hereda riesgo de Blend/Aquarius/Soroswap.',
  },
  default: {
    score: 5.0,
    rating: 'medium',
    factors: [{ name: 'protocolo no en base de datos', impact: 'negative', weight: 1.0 }],
    summary: 'Riesgo MEDIO — no hay datos suficientes, proceder con precaución.',
  },
};

function auditOne(name: string): RiskReport {
  const data = MOCK_RISK[name] ?? MOCK_RISK.default;
  return { protocol: name, ...data };
}

agent.serve<RiskRequest, RiskResponse>(async (req) => {
  // Soporta both: 'protocol' (string, legacy) y 'protocols' (array, batch)
  const list = Array.isArray(req.protocols) && req.protocols.length > 0
    ? req.protocols
    : [req.protocol ?? 'default'];
  const audits = list.map(auditOne);
  return { audits, count: audits.length };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[risk-auditor] bootstrap failed:', (err as Error).message);
    console.error('[risk-auditor] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5002);
})().catch((err) => {
  console.error('[risk-auditor] failed to start:', err);
  process.exit(1);
});
