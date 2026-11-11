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
let initPromise: Promise<void> | null = null;

/**
 * Corre el DDL una sola vez por proceso. Llamadas concurrentes (p.ej. los hooks
 * `before` de varios test files en el mismo proceso) comparten la misma promesa,
 * así el DDL no se ejecuta en paralelo (evita la carrera de CREATE TABLE IF NOT
 * EXISTS → pg_type duplicate).
 */
export function initDb(): Promise<void> {
  if (!initPromise) initPromise = runInit();
  return initPromise;
}

async function runInit(): Promise<void> {
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
      auto_settle INTEGER NOT NULL DEFAULT 0,
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

    -- Almacén de resultados por cuenta (results.ts): cada call_agent queda guardado aunque el
    -- cliente MCP corte por timeout. payload/result = JSON en TEXT.
    CREATE TABLE IF NOT EXISTS call_results (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      service TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      error TEXT,
      cost_lamports BIGINT,
      explorer_url TEXT,
      -- '<service>:<taskId>' en servicios de varios pasos (crear → consultar): agrupa el pedido.
      task_key TEXT,
      created_at BIGINT NOT NULL,
      completed_at BIGINT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Archivos de resultados (files.ts): copia en Kiba de los archivos que enlaza una respuesta
    -- (modelo 3D, texturas, audio, medios comprados). El contenido vive en RESULT_FILES_DIR/<id>;
    -- aquí, su nombre, tipo, tamaño, huella y de dónde salió.
    CREATE TABLE IF NOT EXISTS result_files (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      user_id BIGINT NOT NULL,
      key_path TEXT NOT NULL,
      name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes BIGINT NOT NULL,
      sha256 TEXT NOT NULL,
      source_url TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      FOREIGN KEY (result_id) REFERENCES call_results(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Licencias de medios (licenses.ts): un documento por llamada pagada cuyo resultado trae
    -- license. doc = JSON canónico; doc_sha256 = su huella (los 8 primeros bytes viajan en el
    -- reference del pago por llamada). anchor_ok = la transacción leída lleva esa huella.
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      user_id BIGINT NOT NULL,
      service TEXT NOT NULL,
      pay_to TEXT,
      publisher TEXT,
      asset_id TEXT,
      asset_sha256 TEXT NOT NULL,
      title TEXT,
      terms TEXT NOT NULL,
      amount_lamports BIGINT,
      tx_hash TEXT,
      doc TEXT NOT NULL,
      doc_sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'valid',
      revoked_at BIGINT,
      revoke_reason TEXT,
      anchor_ok BOOLEAN,
      anchor_checked_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_user ON oauth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_licenses_call ON licenses(call_id);
    CREATE INDEX IF NOT EXISTS idx_results_user ON call_results(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_results_task ON call_results(user_id, task_key);
    CREATE INDEX IF NOT EXISTS idx_result_files_result ON result_files(result_id);
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
    CREATE INDEX IF NOT EXISTS idx_settlements_service ON settlements(service);
  `);

  // Los escrows por servicio y ciclo ya no existen: la retención usa uno por publicador.
  await pool.query(`DROP TABLE IF EXISTS service_escrows`);

  // Columnas evolutivas (idempotentes). En Postgres `ADD COLUMN IF NOT EXISTS` es nativo, así
  // que no hace falta el PRAGMA table_info / try-catch que usaba SQLite.
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at BIGINT`);
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS resource TEXT`);
  await pool.query(`ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS resource TEXT`);
  // Servicios que pagan servicios: la llamada que un servicio hace a otro (o a una API x402)
  // mientras sirve una llamada del usuario apunta a esa llamada padre.
  await pool.query(`ALTER TABLE call_results ADD COLUMN IF NOT EXISTS parent_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_results_parent ON call_results(parent_id)`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_publisher INTEGER NOT NULL DEFAULT 0`,
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS publisher_name TEXT`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_settle INTEGER NOT NULL DEFAULT 0`,
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_wallet_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stellar_address TEXT`);
  // Wallet propia del usuario (spend.ts): la dirección con la que firmó, y de qué tipo es.
  // Las columnas spend_debt, spend_blocked y spend_expires_ledger, y las tablas spend_charges y
  // spend_reads, eran del cobro a crédito anterior: ya no se usan ni se crean (las bases de datos
  // que las tengan las conservan sin efecto).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS spend_address TEXT`);
  // 'privy' (wallet de Privy cuyo dueño es el usuario) o 'external' (Freighter, xBull…).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS spend_kind TEXT`);
  // Transacciones que arma el gateway para que el usuario las firme: solo estas se envían.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spend_prepared (
      hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      address TEXT NOT NULL,
      xdr TEXT NOT NULL,
      meta TEXT,
      created_at BIGINT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_spend_prepared_user ON spend_prepared(user_id, kind, used)`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_spend_address ON users(spend_address) WHERE spend_address IS NOT NULL`,
  );
  // Retención de ganancias con reclamos (retention.ts).
  // Confianza en el publicador: decide cuántos días espera su ganancia ('new' | 'verified' | 'trusted').
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS publisher_trust TEXT NOT NULL DEFAULT 'new'`);
  // Quién pagó cada ganancia y cómo, para poder reclamarla y devolverla por donde salió.
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS user_id BIGINT`);
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS tx_id BIGINT`);
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS paid_with TEXT`);
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS channel_id BIGINT`);
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS hold_id BIGINT`);
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS refunded BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_earnings_hold ON agent_earnings(hold_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_earnings_tx ON agent_earnings(tx_id)`);
  // MPP como vendedor (mpp-sell.ts): pruebas de pago ya usadas y registro de cada pago recibido.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mpp_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mpp_payments (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      service TEXT NOT NULL,
      pay_to TEXT NOT NULL,
      payer TEXT,
      amount BIGINT NOT NULL,
      reference TEXT,
      status TEXT NOT NULL,
      earning_id BIGINT,
      refund_tx TEXT,
      error TEXT,
      created_at BIGINT NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS mpp_payments_service ON mpp_payments (service, id)`);
  // Servicios externos: APIs que ya cobran con x402 o MPP, listadas con su URL (external.ts).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_services (
      slug TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      params TEXT NOT NULL DEFAULT '[]',
      protocol TEXT NOT NULL,
      price_lamports BIGINT,
      calls BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS external_services_user ON external_services (user_id)`);
  // El escrow de Trustless Work de cada publicador: uno de larga vida al que se agregan tramos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS publisher_escrows (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      pay_to TEXT NOT NULL,
      engagement_id TEXT NOT NULL,
      escrow_id TEXT,
      tranches INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS publisher_escrows_pay_to ON publisher_escrows (pay_to, id)`);
  // Una retención = lo ganado por un servicio en un período, guardado en un escrow.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS earning_holds (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      service TEXT NOT NULL,
      pay_to TEXT NOT NULL,
      engagement_id TEXT NOT NULL,
      amount BIGINT NOT NULL DEFAULT 0,
      refund_due BIGINT NOT NULL DEFAULT 0,
      trust TEXT,
      retention_days INTEGER,
      status TEXT NOT NULL,
      escrow_id TEXT,
      period_end BIGINT NOT NULL,
      release_at BIGINT,
      created_at BIGINT NOT NULL,
      funded_at BIGINT,
      released_at BIGINT,
      settlement_id BIGINT,
      error TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_earning_holds_status ON earning_holds(status, release_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS claims (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      earning_id BIGINT NOT NULL,
      tx_id BIGINT NOT NULL,
      service TEXT NOT NULL,
      amount BIGINT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      refund_amount BIGINT NOT NULL DEFAULT 0,
      note TEXT,
      created_at BIGINT NOT NULL,
      resolved_at BIGINT,
      resolved_by BIGINT
    )
  `);
  // Un reclamo por llamada.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_earning ON claims(earning_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id, id)`);

  // Depósito retirable (channel.ts): un canal de pago de Stellar por usuario.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_channels (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      address TEXT NOT NULL,
      kind TEXT NOT NULL,
      salt TEXT NOT NULL,
      channel TEXT,
      wait_ledgers INTEGER NOT NULL,
      deposited BIGINT NOT NULL DEFAULT 0,
      spent BIGINT NOT NULL DEFAULT 0,
      settled BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      close_effective_ledger BIGINT,
      refunded BIGINT,
      created_at BIGINT NOT NULL,
      closed_at BIGINT
    )
  `);
  // Un solo canal vivo por usuario y por wallet.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_channels_live_user ON pay_channels(user_id) WHERE status IN ('open','closing','liquidating')`,
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_channels_live_address ON pay_channels(address) WHERE status IN ('open','closing','liquidating')`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_channel_moves (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES pay_channels(id),
      kind TEXT NOT NULL,
      amount BIGINT NOT NULL,
      tx_hash TEXT,
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pay_channel_moves_channel ON pay_channel_moves(channel_id, id)`);
  // Consumo por llamada: `held` es lo apartado por llamadas en curso (una fila en
  // pay_channel_holds por llamada); al terminar pasa a `spent` o se suelta.
  await pool.query(`ALTER TABLE pay_channels ADD COLUMN IF NOT EXISTS held BIGINT NOT NULL DEFAULT 0`);
  // Desde cuándo hay consumo sin cobrar (NULL = todo cobrado): el job cobra lo que lleva mucho.
  await pool.query(`ALTER TABLE pay_channels ADD COLUMN IF NOT EXISTS unsettled_since BIGINT`);
  // Último uso (depósito, recarga o llamada): un depósito sin uso se devuelve a la wallet.
  await pool.query(`ALTER TABLE pay_channels ADD COLUMN IF NOT EXISTS last_active_at BIGINT`);
  // Por qué se cerró, cuando no fue el usuario: 'idle' = devuelto por inactividad.
  await pool.query(`ALTER TABLE pay_channels ADD COLUMN IF NOT EXISTS closed_reason TEXT`);
  // Lo que Kiba le debe a la wallet del usuario por reclamos aceptados sobre consumo ya cobrado.
  await pool.query(`ALTER TABLE pay_channels ADD COLUMN IF NOT EXISTS owed BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE pay_channels ADD COLUMN IF NOT EXISTS over_counted INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_channel_holds (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES pay_channels(id),
      amount BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pay_channel_holds_age ON pay_channel_holds(created_at)`);
  // Fund per-call: earning fondeada on-chain apunta al escrow del ciclo (NULL = legacy/acumulado).
  await pool.query(`ALTER TABLE agent_earnings ADD COLUMN IF NOT EXISTS escrow_id TEXT`);
  // licenses (rama hackmeridian-2026, antes del primer despliegue): de credencial firmada a
  // documento + huella en el pago. Deja las bases locales creadas con el esquema anterior al día.
  for (const col of ['pay_to TEXT', "doc TEXT NOT NULL DEFAULT '{}'", "doc_sha256 TEXT NOT NULL DEFAULT ''", 'anchor_ok BOOLEAN', 'anchor_checked_at BIGINT']) {
    await pool.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS ${col}`);
  }
  for (const col of ['vc', 'seq', 'acta_vc_id', 'acta_tx', 'acta_attempts', 'acta_error', 'acta_next_at']) {
    await pool.query(`ALTER TABLE licenses DROP COLUMN IF EXISTS ${col}`);
  }
  await pool.query('DROP TABLE IF EXISTS acta_vaults');
  await pool.query('DROP TABLE IF EXISTS issuer_identities');
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_earnings_escrow ON agent_earnings(escrow_id)`);

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
  /** Opt-in del publisher a la liquidación automática por lotes (cron). 0 = solo bajo demanda. */
  auto_settle: number;
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
