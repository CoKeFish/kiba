/**
 * Side-effect import: configura process.env ANTES de que cualquier otro
 * archivo del gateway lo lea (db.ts, chain.ts y wallets.ts evalúan env al cargar).
 *
 * Cada test file debe `import './_setup-env';` como PRIMERA línea, ANTES
 * de importar nada de '../src/*'. Las imports en ESM se evalúan en orden
 * de aparición, así que esto garantiza que el env esté listo. (No importamos
 * '../src/db' aquí: el hoisting de imports ESM lo evaluaría ANTES de setear el env.)
 */
import { Keypair } from '@solana/web3.js';

// DB de test: Postgres. En CI la provee el servicio `postgres`; en local, el
// contenedor `postgres` de docker-compose. Los test files corren en serie
// (--test-concurrency=1) y truncan las tablas entre casos.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/kiba_test';

// Semántica Stellar (1e7 stroops, rate 0.12). chain.ts lee process.env al cargarse,
// así que debe fijarse ANTES de importar src. Forzamos modo degradado (sin
// STELLAR_CONTRACT_ID) para que masterWalletPubkey sea determinista (base58 del
// seed) sin depender del entorno donde corran los tests.
process.env.CHAIN = 'stellar';
process.env.XLM_USD_RATE = process.env.XLM_USD_RATE || '0.12';
delete process.env.STELLAR_CONTRACT_ID;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use';

// Master wallet por env (para que wallets.ts no toque el filesystem)
const masterKp = Keypair.generate();
process.env.MASTER_WALLET_SECRET = JSON.stringify(Array.from(masterKp.secretKey));

export const TEST_MASTER_KEYPAIR = masterKp;

/** Tablas a truncar entre tests (con CASCADE + reinicio de identidades). */
export const TRUNCATE_SQL =
  'TRUNCATE oauth_refresh_tokens, oauth_tokens, oauth_sessions, oauth_clients, api_keys, transactions, agent_earnings, settlements, payment_charges, user_agents, users RESTART IDENTITY CASCADE';
