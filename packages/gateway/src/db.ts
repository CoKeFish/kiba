/**
 * Postgres DB setup (pg). Reemplaza a better-sqlite3 (que era síncrono).
 *
 * El wrapper `db` mantiene la MISMA forma que el código existente usaba con better-sqlite3
 * (`db.prepare(sql).get/all/run(...)`, `db.exec(sql)`) pero **async**, sobre un Pool de `pg`.
 * Las transacciones van por `withTransaction(async (tx) => ...)`, que liga las queries a un
 * único client (BEGIN/COMMIT/ROLLBACK) — necesario para la atomicidad de débitos/créditos.
 *
 * Los `?` (estilo SQLite) se convierten a `$1..$n` (estilo pg) automáticamente en el wrapper.
 */
import pg from 'pg';

const { Pool, types } = pg;

// pg devuelve BIGINT (oid 20) como *string* por defecto. Los `*_lamports` (stroops) van en
// BIGINT y necesitan aritmética numérica, así que los parseamos a Number (los montos realistas
// caben de sobra en 2^53). Aplica también a ids IDENTITY y a los timestamps unix (BIGINT).
types.setTypeParser(20, (v) => (v == null ? null : Number(v)));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL no está seteado — el gateway ahora requiere Postgres.');
}

export const pool = new Pool({ connectionString: DATABASE_URL });

/** `?` (sqlite) → `$1..$n` (pg). */
function convert(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type Params = unknown[];
type Row = Record<string, unknown>;
interface Runner {
  query: (text: string, params?: Params) => Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface Stmt {
  get<T = Row>(...params: Params): Promise<T | undefined>;
  all<T = Row>(...params: Params): Promise<T[]>;
  /** `lastInsertRowid` solo se puebla si el SQL trae `RETURNING id`. */
  run(...params: Params): Promise<{ changes: number; lastInsertRowid: number | undefined }>;
}

function makePrepare(runner: Runner): (sql: string) => Stmt {
  return (sql: string): Stmt => {
    const text = convert(sql);
    return {
      async get<T = Row>(...params: Params) {
        const r = await runner.query(text, params);
        return r.rows[0] as T | undefined;
      },
      async all<T = Row>(...params: Params) {
        const r = await runner.query(text, params);
        return r.rows as T[];
      },
      async run(...params: Params) {
        const r = await runner.query(text, params);
        return {
          changes: r.rowCount ?? 0,
          lastInsertRowid: (r.rows[0] as { id?: number } | undefined)?.id,
        };
      },
    };
  };
}

export const db = {
  prepare: makePrepare(pool),
  async exec(sql: string): Promise<void> {
    await pool.query(sql);
  },
};

/** API de statements dentro de una transacción (ligada a un único client). */
export interface Tx {
  prepare: (sql: string) => Stmt;
}

/** Corre `fn` dentro de una transacción; commit al éxito, rollback ante error. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ prepare: makePrepare(client) });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* noop */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Crea el schema (idempotente) + columnas evolutivas. Se llama con `await` al arrancar el
 * gateway, ANTES de `app.listen`. Como el Postgres de prod arranca limpio, `CREATE TABLE IF NOT
 * EXISTS` basta; los `ADD COLUMN IF NOT EXISTS` protegen ante evoluciones futuras del schema.
 */
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      custodial_wallet_secret TEXT NOT NULL,
      custodial_wallet_pubkey TEXT NOT NULL,
      balance_lamports BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      is_publisher INTEGER NOT NULL DEFAULT 0,
      publisher_name TEXT,
      privy_wallet_id TEXT,
      stellar_address TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_sessions (
      session_id TEXT PRIMARY KEY,
      user_id BIGINT,
      code_challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      client_name TEXT NOT NULL,
      code TEXT,
      expires_at BIGINT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      state TEXT,
      client_id TEXT,
      resource TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      client_name TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      resource TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL,
      type TEXT NOT NULL,
      amount_lamports BIGINT NOT NULL,
      service TEXT,
      signature TEXT,
      metadata TEXT,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      prefix TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      last_used_at BIGINT,
      expires_at BIGINT,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      grant_types TEXT,
      response_types TEXT,
      scope TEXT,
      token_endpoint_auth_method TEXT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      refresh_token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      client_name TEXT NOT NULL,
      resource TEXT,
      access_token TEXT,
      family_id TEXT NOT NULL,
      replaced_by TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_agents (
      service TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS agent_earnings (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      service TEXT NOT NULL,
      pay_to TEXT NOT NULL,
      amount_lamports BIGINT NOT NULL,
      settlement_id BIGINT,
      settled_at BIGINT,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      service TEXT NOT NULL,
      pay_to TEXT NOT NULL,
      amount_lamports BIGINT NOT NULL,
      escrow_id TEXT,
      signature TEXT,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      settled_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS payment_charges (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      provider TEXT NOT NULL,
      method TEXT NOT NULL,
      reference TEXT NOT NULL,
      amount_cop BIGINT NOT NULL,
      amount_usd DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT,
      created_at BIGINT NOT NULL,
      paid_at BIGINT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_user ON oauth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_family ON oauth_refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_access ON oauth_refresh_tokens(access_token);
    CREATE INDEX IF NOT EXISTS idx_clients_name ON oauth_clients(client_name);
    CREATE INDEX IF NOT EXISTS idx_user_agents_user ON user_agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_earnings_settlement ON agent_earnings(settlement_id);
    CREATE INDEX IF NOT EXISTS idx_earnings_service ON agent_earnings(service);
    CREATE INDEX IF NOT EXISTS idx_charges_user ON payment_charges(user_id);
  `);

  // Columnas evolutivas (idempotentes). En Postgres `ADD COLUMN IF NOT EXISTS` es nativo, así
  // que no hace falta el PRAGMA table_info / try-catch que usaba SQLite.
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at BIGINT`);
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS resource TEXT`);
  await pool.query(`ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS resource TEXT`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_publisher INTEGER NOT NULL DEFAULT 0`,
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS publisher_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_wallet_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stellar_address TEXT`);

  // Backfills idempotentes (no-op en DB fresca; protegen DBs existentes).
  await pool.query(
    `UPDATE api_keys SET expires_at = created_at + 31536000 WHERE expires_at IS NULL`,
  );
  await pool.query(
    `UPDATE users SET is_publisher = 1 WHERE is_publisher = 0 AND id IN (SELECT DISTINCT user_id FROM user_agents)`,
  );
}

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
