/**
 * SQLite con FTS5. Source-of-truth off-chain del registry.
 * Reglas:
 *  - Cada cambio on-chain (Register/Update/Deregister) llega vía indexer y hace upsert aquí.
 *  - Embedding va aparte porque puede fallar/no estar disponible.
 *  - Soft-delete (no DELETE real) para auditoría y para que el indexer pueda re-encontrar la fila.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentRecord {
  pda: string;
  service: string;
  owner_wallet: string;
  price_per_call: number; // lamports
  endpoint: string;
  description: string;
  total_calls: number;
  total_earned: number;
  created_at: number;
  updated_at: number;
  source: 'chain' | 'fallback';
  deleted: number;
}

export interface AgentWithEmbedding {
  service: string;
  embedding: Float32Array;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  pda TEXT PRIMARY KEY,
  service TEXT UNIQUE NOT NULL,
  owner_wallet TEXT NOT NULL,
  price_per_call INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  description TEXT NOT NULL,
  total_calls INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'chain',
  deleted INTEGER NOT NULL DEFAULT 0,
  embedding BLOB
);

CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_agents_deleted ON agents(deleted);

CREATE VIRTUAL TABLE IF NOT EXISTS agents_fts USING fts5(
  service,
  description,
  content='agents',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS agents_ai AFTER INSERT ON agents BEGIN
  INSERT INTO agents_fts(rowid, service, description)
    VALUES (new.rowid, new.service, new.description);
END;

CREATE TRIGGER IF NOT EXISTS agents_ad AFTER DELETE ON agents BEGIN
  INSERT INTO agents_fts(agents_fts, rowid, service, description)
    VALUES('delete', old.rowid, old.service, old.description);
END;

CREATE TRIGGER IF NOT EXISTS agents_au AFTER UPDATE ON agents BEGIN
  INSERT INTO agents_fts(agents_fts, rowid, service, description)
    VALUES('delete', old.rowid, old.service, old.description);
  INSERT INTO agents_fts(rowid, service, description)
    VALUES (new.rowid, new.service, new.description);
END;
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dataDir = process.env.BACKEND_DATA_DIR || './data';
  mkdirSync(dataDir, { recursive: true });
  const file = process.env.BACKEND_DB_FILE || join(dataDir, 'backend.db');
  _db = new Database(file);
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA);
  return _db;
}

/** Para tests — DB en memoria, no persiste */
export function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(SCHEMA);
  return db;
}

export function upsertAgent(db: Database.Database, agent: AgentRecord): void {
  db.prepare(
    `INSERT INTO agents (
       pda, service, owner_wallet, price_per_call, endpoint, description,
       total_calls, total_earned, created_at, updated_at, source, deleted
     ) VALUES (
       @pda, @service, @owner_wallet, @price_per_call, @endpoint, @description,
       @total_calls, @total_earned, @created_at, @updated_at, @source, 0
     )
     ON CONFLICT(service) DO UPDATE SET
       pda = excluded.pda,
       owner_wallet = excluded.owner_wallet,
       price_per_call = excluded.price_per_call,
       endpoint = excluded.endpoint,
       description = excluded.description,
       total_calls = excluded.total_calls,
       total_earned = excluded.total_earned,
       updated_at = excluded.updated_at,
       source = excluded.source,
       deleted = 0`,
  ).run(agent);
}

export function setAgentEmbedding(
  db: Database.Database,
  service: string,
  embedding: Float32Array,
): void {
  const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  db.prepare('UPDATE agents SET embedding = ? WHERE service = ?').run(buf, service);
}

export function markDeleted(db: Database.Database, service: string): void {
  db.prepare('UPDATE agents SET deleted = 1, updated_at = ? WHERE service = ?').run(
    Math.floor(Date.now() / 1000),
    service,
  );
}

export function getAgentByService(
  db: Database.Database,
  service: string,
): AgentRecord | null {
  const row = db
    .prepare('SELECT * FROM agents WHERE service = ? AND deleted = 0')
    .get(service) as AgentRecord | undefined;
  return row ?? null;
}

export function listAgents(
  db: Database.Database,
  opts: { limit?: number; offset?: number } = {},
): AgentRecord[] {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  return db
    .prepare(
      `SELECT * FROM agents WHERE deleted = 0
       ORDER BY total_calls DESC, created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as AgentRecord[];
}

export function countAgents(db: Database.Database): number {
  const row = db
    .prepare('SELECT COUNT(*) as n FROM agents WHERE deleted = 0')
    .get() as { n: number };
  return row.n;
}

export function listAgentsWithEmbeddings(db: Database.Database): AgentWithEmbedding[] {
  const rows = db
    .prepare('SELECT service, embedding FROM agents WHERE deleted = 0 AND embedding IS NOT NULL')
    .all() as { service: string; embedding: Buffer }[];
  return rows.map((r) => ({
    service: r.service,
    embedding: new Float32Array(
      r.embedding.buffer,
      r.embedding.byteOffset,
      r.embedding.byteLength / 4,
    ),
  }));
}

export interface KeywordHit {
  service: string;
  score: number;
}

/**
 * Búsqueda FTS5 con BM25. Ojo: rank de FTS5 es negativo (más cercano a 0 = mejor),
 * lo invertimos a positivo para combinar con cosine fácilmente.
 */
export function searchKeywordRaw(
  db: Database.Database,
  query: string,
  limit: number,
): KeywordHit[] {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];
  const rows = db
    .prepare(
      `SELECT a.service AS service, bm25(agents_fts) AS rank
       FROM agents_fts
       JOIN agents a ON a.rowid = agents_fts.rowid
       WHERE agents_fts MATCH ? AND a.deleted = 0
       ORDER BY rank
       LIMIT ?`,
    )
    .all(sanitized, limit) as { service: string; rank: number }[];
  // bm25 devuelve negativos donde menor es mejor; convertir a [0, +) donde mayor es mejor
  return rows.map((r) => ({ service: r.service, score: -r.rank }));
}

/**
 * Limpia el query del usuario para FTS5: tokens alfanuméricos OR'd con prefix.
 * Ej: "yield farming!" → '"yield"* OR "farming"*'
 *
 * Token mínimo de 3 chars: descarta stopwords cortos como "en", "el", "de", "in", "on"
 * que con prefix wildcard generan falsos positivos absurdos
 * (p.ej. "en" matchea "English", inflando el ranking de un agente sin relación).
 */
const MIN_TOKEN_LEN = 3;

function sanitizeFtsQuery(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' OR ');
}
