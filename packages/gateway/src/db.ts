/**
 * SQLite DB setup. Usamos better-sqlite3 (sync API).
 * Schema: users, oauth_sessions, oauth_tokens, transactions.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || '/app/data/gateway.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db: Database.Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    custodial_wallet_secret TEXT NOT NULL,
    custodial_wallet_pubkey TEXT NOT NULL,
    balance_lamports INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER,
    code_challenge TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    client_name TEXT NOT NULL,
    code TEXT,
    expires_at INTEGER NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount_lamports INTEGER NOT NULL,
    service TEXT,
    signature TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    prefix TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- OAuth clients registrados vía Dynamic Client Registration (RFC 7591).
  -- Usado por connectors remotos (Claude.ai, ChatGPT Apps) que se auto-registran.
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret TEXT,
    client_name TEXT,
    redirect_uris TEXT NOT NULL,            -- JSON array
    grant_types TEXT,                       -- JSON array
    response_types TEXT,                    -- JSON array
    scope TEXT,
    token_endpoint_auth_method TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_user ON oauth_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
  CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);

  CREATE TABLE IF NOT EXISTS user_agents (
    service TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);
`);

// Migración idempotente: añade expires_at a api_keys en DBs creadas antes de esta columna.
try {
  db.exec('ALTER TABLE api_keys ADD COLUMN expires_at INTEGER');
} catch {
  /* la columna ya existe */
}
// Backfill: keys preexistentes sin expiración → 1 año desde su creación (evita que las
// keys con expires_at NULL se traten como inmortales tras añadir la columna).
db.exec('UPDATE api_keys SET expires_at = created_at + 31536000 WHERE expires_at IS NULL');

// Migración idempotente: el connector remoto (OAuth estándar) guarda state /
// client_id / resource en las sesiones OAuth. Aditivo; el flujo stdio existente
// sigue usando solo code_challenge / redirect_uri / client_name.
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn('oauth_sessions', 'state', 'TEXT');
ensureColumn('oauth_sessions', 'client_id', 'TEXT');
ensureColumn('oauth_sessions', 'resource', 'TEXT');

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  custodial_wallet_secret: string;
  custodial_wallet_pubkey: string;
  balance_lamports: number;
  created_at: number;
}

export interface OAuthSessionRow {
  session_id: string;
  user_id: number | null;
  code_challenge: string;
  redirect_uri: string;
  client_name: string;
  code: string | null;
  expires_at: number;
  consumed: number;
  // Columnas del flujo OAuth estándar (connectors remotos). Nullable: el flujo
  // stdio existente no las setea.
  state: string | null;
  client_id: string | null;
  resource: string | null;
}

export interface OAuthClientRow {
  client_id: string;
  client_secret: string | null;
  client_name: string | null;
  redirect_uris: string; // JSON array
  grant_types: string | null; // JSON array
  response_types: string | null; // JSON array
  scope: string | null;
  token_endpoint_auth_method: string | null;
  created_at: number;
}

export interface OAuthTokenRow {
  token: string;
  user_id: number;
  client_name: string;
  expires_at: number;
  revoked: number;
  created_at: number;
}

export interface TransactionRow {
  id: number;
  user_id: number;
  type: 'topup' | 'call' | 'fee' | 'refund';
  amount_lamports: number;
  service: string | null;
  signature: string | null;
  metadata: string | null;
  created_at: number;
}
