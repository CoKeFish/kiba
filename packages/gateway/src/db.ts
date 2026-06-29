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

  -- Refresh tokens (OAuth 2.1) para connectors remotos. El access token dura 30d
  -- y se renueva con el refresh_token (rotación + detección de reuso por familia).
  -- Tabla separada de oauth_tokens a propósito: una "familia" abarca una secuencia
  -- de access tokens a lo largo de ~1 año, y los refresh consumidos se conservan
  -- (marcados con replaced_by) para detectar replay, sin contaminar la tabla de
  -- access tokens que lee el verifier.
  CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    refresh_token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    resource TEXT,            -- audiencia RFC 8707; espeja oauth_tokens.resource; NULL = stdio/legacy
    access_token TEXT,        -- access token emparejado actual (cascada de revocación)
    family_id TEXT NOT NULL,  -- linaje de rotación (constante en toda la cadena)
    replaced_by TEXT,         -- el refresh_token que lo sucedió; NULL = cabeza/activo
    revoked INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_user ON oauth_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
  CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_refresh_family ON oauth_refresh_tokens(family_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_access ON oauth_refresh_tokens(access_token);
  CREATE INDEX IF NOT EXISTS idx_clients_name ON oauth_clients(client_name);

  CREATE TABLE IF NOT EXISTS user_agents (
    service TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);

  -- Ledger off-chain de ganancias de agentes: en modo crédito cada call_agent acredita aquí
  -- el precio COMPLETO de la llamada (sin tocar la cadena). settlement_id IS NULL = acumulado
  -- (pendiente de liquidar). Se liquida por lotes vía Trustless Work (ver settlement.ts).
  CREATE TABLE IF NOT EXISTS agent_earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    pay_to TEXT NOT NULL,
    amount_lamports INTEGER NOT NULL,
    settlement_id INTEGER,
    settled_at INTEGER,
    created_at INTEGER NOT NULL
  );

  -- Liquidaciones on-chain: un escrow TW por payout (en lotes). status: pending|settled|failed.
  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    pay_to TEXT NOT NULL,
    amount_lamports INTEGER NOT NULL,
    escrow_id TEXT,
    signature TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_earnings_settlement ON agent_earnings(settlement_id);
  CREATE INDEX IF NOT EXISTS idx_earnings_service ON agent_earnings(service);
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

// Publisher mode: un mismo user/cuenta puede ser consumidor Y publisher (mismo login,
// misma custodial wallet que recibe el 95% de cada call). `is_publisher` se activa al
// publicar el primer agente o vía POST /v1/publisher/activate. `publisher_name` es el
// nombre/marca visible del publisher (opcional).
ensureColumn('users', 'is_publisher', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'publisher_name', 'TEXT');
// Backfill: quien ya tiene agentes registrados es publisher de facto.
db.exec(
  'UPDATE users SET is_publisher = 1 WHERE is_publisher = 0 AND id IN (SELECT DISTINCT user_id FROM user_agents)',
);
// El access token queda ligado al `resource` (audiencia) del flujo estándar
// (RFC 8707): connectors remotos como ChatGPT mandan `resource` y el token no
// debe ser válido contra otro recurso. NULL para tokens stdio/legacy.
ensureColumn('oauth_tokens', 'resource', 'TEXT');

// Privy server wallets: la clave ed25519 vive en el TEE de Privy, no en la DB de Kiba.
// `privy_wallet_id` + `stellar_address` reemplazan a custodial_wallet_secret (que queda
// vacío '' al migrar un usuario). Nullable: los usuarios legacy siguen con su secret local.
ensureColumn('users', 'privy_wallet_id', 'TEXT');
ensureColumn('users', 'stellar_address', 'TEXT');

// Cargos de pago fiat (Bre-B / PSP). Un "charge" es una intención de recarga:
// se crea pending, el usuario paga por el PSP (en sandbox lo simulamos), y al
// confirmarse se acreditan créditos. Idempotente por `status` (pending→paid).
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_charges (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    method TEXT NOT NULL,
    reference TEXT NOT NULL,
    amount_cop INTEGER NOT NULL,
    amount_usd REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    metadata TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_charges_user ON payment_charges(user_id);
`);

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  custodial_wallet_secret: string;
  custodial_wallet_pubkey: string;
  balance_lamports: number;
  created_at: number;
  is_publisher: number;
  publisher_name: string | null;
  /** Privy: id de la server wallet (clave en el TEE de Privy). null = legacy/no migrado. */
  privy_wallet_id: string | null;
  /** Privy: dirección Stellar (G...) de la wallet. null = legacy/no migrado. */
  stellar_address: string | null;
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
  // Audiencia RFC 8707 a la que se ligó el token (flujo OAuth estándar). NULL
  // en tokens del flujo stdio/legacy.
  resource: string | null;
  expires_at: number;
  revoked: number;
  created_at: number;
}

export interface OAuthRefreshTokenRow {
  refresh_token: string;
  user_id: number;
  client_name: string;
  resource: string | null;
  access_token: string | null;
  family_id: string;
  replaced_by: string | null;
  revoked: number;
  expires_at: number;
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

export interface AgentEarningRow {
  id: number;
  service: string;
  /** dirección Stellar (G...) del agente que recibe el pago en la liquidación. */
  pay_to: string;
  /** precio COMPLETO de la llamada en unidades base (el 95/5 se aplica al liquidar vía TW). */
  amount_lamports: number;
  /** id de la liquidación que reclamó esta fila; NULL = acumulado (pendiente). */
  settlement_id: number | null;
  /** timestamp de confirmación on-chain de la liquidación; NULL hasta que liquida. */
  settled_at: number | null;
  created_at: number;
}

export interface SettlementRow {
  id: number;
  service: string;
  pay_to: string;
  amount_lamports: number;
  escrow_id: string | null;
  signature: string | null;
  status: 'pending' | 'settled' | 'failed';
  created_at: number;
  settled_at: number | null;
}
