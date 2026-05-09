/**
 * Backend Discovery API — Phase 3 (indexer + búsqueda híbrida)
 *
 *  - Indexer mantiene SQLite sincronizado con el registry on-chain
 *  - GET /agents soporta ?q (búsqueda) + ?mode=keyword|semantic|hybrid + ?limit
 *  - WebSocket /ws stream de eventos del programa + actualizaciones del indexer
 */
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { Connection, PublicKey } from '@solana/web3.js';
import { AgentBazaarProgram } from '@agent-bazaar/sdk';

import { getDb, listAgents, type AgentRecord } from './db';
import { Indexer } from './indexer';
import { search, searchStatus, type SearchMode } from './search';
import { warmup as warmupEmbeddings, status as embeddingsStatus } from './embeddings';

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
  console.warn('[backend] PROGRAM_ID no configurado — modo demo con FALLBACK_AGENTS');
}

// ─── DB + Indexer ────────────────────────────────────────────────
getDb(); // toca el singleton para que cree el archivo y aplique el schema
const indexer = new Indexer(program, program ? connection : null);

// ─── Serializador ────────────────────────────────────────────────
function toManifest(a: AgentRecord) {
  return {
    service: a.service,
    pricePerCall: a.price_per_call / 1e9,
    description: a.description,
    endpoint: a.endpoint,
    ownerWallet: a.owner_wallet,
    acceptedToken: 'SOL' as const,
    totalCalls: a.total_calls,
    totalEarned: a.total_earned / 1e9,
    createdAt: a.created_at,
    source: a.source,
  };
}

// ─── Express ─────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const db = getDb();
  res.json({
    ok: true,
    service: 'agent-bazaar-backend',
    network: SOLANA_RPC,
    programId: PROGRAM_ID ?? '(not deployed)',
    indexedAgents: listAgents(db, { limit: 1000 }).length,
    embeddings: embeddingsStatus(),
    search: searchStatus(),
    uptime: process.uptime(),
  });
});

app.get('/agents', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const mode = (typeof req.query.mode === 'string' ? req.query.mode : 'hybrid') as SearchMode;
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  if (q && mode && !['keyword', 'semantic', 'hybrid'].includes(mode)) {
    res.status(400).json({ error: 'mode must be keyword|semantic|hybrid' });
    return;
  }

  try {
    const hits = await search(getDb(), { q, mode, limit });
    if (q) {
      res.json({
        query: q,
        mode,
        count: hits.length,
        results: hits.map((h) => ({
          ...toManifest(h.agent),
          score: Number(h.score.toFixed(4)),
          matchType: h.matchType,
        })),
      });
      return;
    }
    // Sin query: shape compatible con el endpoint anterior (array plano)
    res.json(hits.map((h) => toManifest(h.agent)));
  } catch (err) {
    console.error('[backend] search error:', (err as Error).message);
    res.status(500).json({ error: 'search failed' });
  }
});

app.get('/agents/:service', async (req, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM agents WHERE service = ? AND deleted = 0')
    .get(req.params.service) as AgentRecord | undefined;
  if (!row) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }
  res.json(toManifest(row));
});

// ─── WebSocket ───────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set<import('ws').WebSocket>();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  // Snapshot inicial
  const list = listAgents(getDb(), { limit: 100 }).map(toManifest);
  ws.send(JSON.stringify({ type: 'snapshot', agents: list }));
});

function broadcast(event: unknown): void {
  const msg = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

indexer.on((e) => {
  if (e.type === 'snapshot') {
    const list = listAgents(getDb(), { limit: 100 }).map(toManifest);
    broadcast({ type: 'snapshot', agents: list });
    return;
  }
  broadcast(e);
});

// ─── Start ───────────────────────────────────────────────────────
async function main(): Promise<void> {
  warmupEmbeddings(); // carga el modelo en background
  await indexer.bootstrap();
  indexer.subscribeToChain();
  indexer.startHeartbeat();

  server.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  Agent Bazaar — Backend (Phase 3)        ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`  http://localhost:${PORT}/health`);
    console.log(`  http://localhost:${PORT}/agents`);
    console.log(`  http://localhost:${PORT}/agents?q=yield&mode=hybrid`);
    console.log(`  ws://localhost:${PORT}/ws`);
    console.log(`  network: ${SOLANA_RPC}`);
    console.log(`  programId: ${PROGRAM_ID ?? '(not deployed)'}`);
  });
}

void main();
