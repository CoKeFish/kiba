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

import { getDb, listAgents, type AgentRecord } from './db';
import { Indexer } from './indexer';
import { createRegistryReader } from './registry';
import { search, searchStatus, type SearchMode } from './search';
import { warmup as warmupEmbeddings, status as embeddingsStatus } from './embeddings';

const PORT = Number(process.env.PORT) || 4000;
const CHAIN = (process.env.CHAIN || 'solana').toLowerCase();

// ─── DB + Indexer (fuente de registro elegida por CHAIN) ─────────
getDb(); // toca el singleton para que cree el archivo y aplique el schema
const reader = createRegistryReader();
if (!reader) {
  console.warn('[backend] sin cadena configurada — modo demo con FALLBACK_AGENTS');
}
const indexer = new Indexer(reader);

// Unidades/activo del registro activo (para serializar precios correctamente).
const BASE_UNITS_PER_TOKEN = reader?.baseUnitsPerToken ?? 1e9;
const ASSET = (reader?.asset ?? 'SOL') as 'SOL' | 'USDC' | 'XLM';

// ─── Serializador ────────────────────────────────────────────────
function toManifest(a: AgentRecord) {
  return {
    service: a.service,
    pricePerCall: a.price_per_call / BASE_UNITS_PER_TOKEN,
    description: a.description,
    endpoint: a.endpoint,
    ownerWallet: a.owner_wallet,
    acceptedToken: ASSET,
    totalCalls: a.total_calls,
    totalEarned: a.total_earned / BASE_UNITS_PER_TOKEN,
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
    service: 'kiba-backend',
    chain: CHAIN,
    asset: ASSET,
    registry: reader?.label ?? '(demo/fallback)',
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
    console.log('║  Kiba — Backend (Phase 3)                ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`  http://localhost:${PORT}/health`);
    console.log(`  http://localhost:${PORT}/agents`);
    console.log(`  http://localhost:${PORT}/agents?q=yield&mode=hybrid`);
    console.log(`  ws://localhost:${PORT}/ws`);
    console.log(`  chain: ${CHAIN} (${reader?.label ?? 'demo'}, ${ASSET})`);
  });
}

void main();
