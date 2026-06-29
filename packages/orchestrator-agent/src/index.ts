/**
 * Orchestrator Agent — consumer de ejemplo del Kiba.
 *
 * Phase 2:
 *  - Wallet persistente en disco
 *  - Bootstrap: airdrop si balance bajo
 *  - Llamadas reales vía SDK con escrow x402 on-chain
 *  - Planner con LLM (Anthropic) si hay API key, fallback a keywords
 */
import express from 'express';
import cors from 'cors';
import { AgentClient, loadOrCreateKeypair } from '@kiba/sdk';
import { plan } from './planner';
import { execute } from './executor';

const PORT = Number(process.env.PORT) || 6001;
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/orchestrator.json';

const wallet = loadOrCreateKeypair(KEYPAIR_PATH);

const client = new AgentClient({ wallet });

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'orchestrator-agent',
    wallet: wallet.publicKey(),
    backend: process.env.BACKEND_URL,
    contractId: process.env.STELLAR_CONTRACT_ID,
  });
});

/**
 * POST /intent — recibe `{ intent: "string en NL" }`
 *
 * Flujo:
 *   1. Plan: decidir qué specialists invocar
 *   2. Execute: en paralelo, cada uno con su pago x402 on-chain
 *   3. Devolver el plan + resultados + traza
 */
app.post('/intent', async (req, res) => {
  const { intent } = req.body ?? {};
  if (typeof intent !== 'string' || intent.length === 0) {
    res.status(400).json({ error: 'intent (string) required' });
    return;
  }

  try {
    const startedAt = Date.now();
    const tasks = await plan(intent);
    const results = await execute(client, tasks);
    res.json({
      intent,
      plan: tasks,
      results,
      walletUsed: wallet.publicKey(),
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: msg, intent });
  }
});

(async () => {
  try {
    await client.bootstrap();
  } catch (err) {
    console.error('[orchestrator] bootstrap failed:', (err as Error).message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  Kiba — Orchestrator Agent       ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`  http://localhost:${PORT}/health`);
    console.log(`  POST http://localhost:${PORT}/intent`);
    console.log(`  wallet: ${wallet.publicKey()}`);
    console.log(`  backend: ${process.env.BACKEND_URL ?? '(not set)'}`);
    console.log(`  contractId: ${process.env.STELLAR_CONTRACT_ID ?? '(not set)'}`);
  });
})();
