/**
 * Backend Discovery API — Phase 2
 *
 *  - Lee agentes registrados directamente del registry on-chain
 *  - Cachea resultados por 30s
 *  - Suscribe a logs del programa para broadcast en vivo vía WebSocket
 *  - Endpoints REST: GET /agents, GET /agents/:service, GET /health
 *  - WebSocket: ws://host:4000/ws → emite eventos `{type, ...}`
 */
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { Connection, PublicKey } from '@solana/web3.js';
import { AgentBazaarProgram, type AgentAccount } from '@agent-bazaar/sdk';

const PORT = Number(process.env.PORT) || 4000;
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID;

const connection = new Connection(SOLANA_RPC, 'confirmed');
let program: AgentBazaarProgram | null = null;
if (PROGRAM_ID) {
  try {
    program = new AgentBazaarProgram(new PublicKey(PROGRAM_ID), connection);
  } catch (err) {
    console.error('[backend] PROGRAM_ID inválido:', (err as Error).message);
  }
} else {
  console.warn('[backend] PROGRAM_ID no configurado — devolviendo lista vacía hasta deploy');
}

// ─── Cache ───────────────────────────────────────────────────────
let agentsCache: { pda: PublicKey; data: AgentAccount }[] = [];
let cacheAt = 0;
const CACHE_TTL_MS = 30_000;

// Fallback hardcoded — se usa cuando PROGRAM_ID no está configurado (demo mode)
const FALLBACK_AGENTS = [
  {
    service: 'yield-hunter',
    pricePerCall: 0.01,
    description: 'Encuentra el mejor APY entre protocolos DeFi en Solana',
    endpoint: 'http://demo-agents:5001',
    ownerWallet: 'PHASE_1_PLACEHOLDER',
    acceptedToken: 'SOL' as const,
    totalCalls: 0,
    totalEarned: 0,
    createdAt: Math.floor(Date.now() / 1000),
  },
  {
    service: 'risk-auditor',
    pricePerCall: 0.02,
    description: 'Analiza el riesgo de un smart contract / protocolo Solana',
    endpoint: 'http://demo-agents:5002',
    ownerWallet: 'PHASE_1_PLACEHOLDER',
    acceptedToken: 'SOL' as const,
    totalCalls: 0,
    totalEarned: 0,
    createdAt: Math.floor(Date.now() / 1000),
  },
];

async function getAgents(): Promise<typeof agentsCache> {
  const now = Date.now();
  if (program && now - cacheAt < CACHE_TTL_MS && agentsCache.length > 0) return agentsCache;
  if (!program) return [];

  try {
    agentsCache = await program.fetchAllAgents();
    cacheAt = now;
  } catch (err) {
    console.error('[backend] error fetching agents:', (err as Error).message);
  }
  return agentsCache;
}

function toManifest(a: AgentAccount, _pda: PublicKey) {
  return {
    service: a.service,
    pricePerCall: Number(a.pricePerCall) / 1e9,
    description: a.description,
    endpoint: a.endpoint,
    ownerWallet: a.owner.toBase58(),
    acceptedToken: 'SOL' as const,
    totalCalls: Number(a.totalCalls),
    totalEarned: Number(a.totalEarned) / 1e9,
    createdAt: Number(a.createdAt),
  };
}

// ─── Express ─────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'agent-bazaar-backend',
    network: SOLANA_RPC,
    programId: PROGRAM_ID ?? '(not deployed)',
    cachedAgents: agentsCache.length,
    uptime: process.uptime(),
  });
});

app.get('/agents', async (_req, res) => {
  const agents = await getAgents();
  if (agents.length > 0) {
    res.json(agents.map(({ pda, data }) => toManifest(data, pda)));
    return;
  }
  // Fallback demo si el contract no está deployado
  res.json(FALLBACK_AGENTS);
});

app.get('/agents/:service', async (req, res) => {
  if (program) {
    const onChain = await program.fetchAgent(req.params.service);
    if (onChain) {
      res.json(toManifest(onChain, PublicKey.default));
      return;
    }
  }
  // Fallback
  const found = FALLBACK_AGENTS.find((a) => a.service === req.params.service);
  if (!found) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }
  res.json(found);
});

// ─── WebSocket ───────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set<import('ws').WebSocket>();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  // Mensaje inicial — usa la misma lógica que GET /agents (con fallback si no hay onchain)
  getAgents().then((agents) => {
    const list =
      agents.length > 0 ? agents.map(({ pda, data }) => toManifest(data, pda)) : FALLBACK_AGENTS;
    ws.send(JSON.stringify({ type: 'snapshot', agents: list }));
  });
});

function broadcast(event: unknown) {
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

// ─── Subscripción a logs del programa ─────────────────────────────
if (program) {
  try {
    connection.onLogs(
      program.programId,
      (logs) => {
        const isInteresting = logs.logs.some((l) =>
          /Program log: Instruction: (RegisterAgent|OpenEscrow|ClaimPayment|RefundEscrow)/i.test(l),
        );
        if (!isInteresting) return;

        broadcast({
          type: 'program_event',
          signature: logs.signature,
          slot: logs.err === null ? 'success' : 'error',
          logs: logs.logs.slice(0, 10), // primer slice — más es ruido
        });

        // Invalida cache para que la próxima request recargue
        cacheAt = 0;
      },
      'confirmed',
    );
    console.log(`[backend] suscrito a logs del programa ${program.programId.toBase58()}`);
  } catch (err) {
    console.error('[backend] no se pudo suscribir a logs:', (err as Error).message);
  }
}

// ─── Start ───────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Agent Bazaar — Backend (Phase 2)        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  http://localhost:${PORT}/health`);
  console.log(`  http://localhost:${PORT}/agents`);
  console.log(`  ws://localhost:${PORT}/ws`);
  console.log(`  network: ${SOLANA_RPC}`);
  console.log(`  programId: ${PROGRAM_ID ?? '(not deployed)'}`);
});
