/**
 * Side-effect import: configura process.env ANTES de que cualquier otro
 * archivo del gateway lo lea (db.ts y wallets.ts evalúan env al cargar).
 *
 * Cada test file debe `import './_setup-env';` como PRIMERA línea, ANTES
 * de importar nada de '../src/*'. Las imports en ESM se evalúan en orden
 * de aparición, así que esto garantiza que el env esté listo.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

// DB aislada por proceso de test (cada test file corre en su propio subproceso)
const tmpDir = mkdtempSync(join(tmpdir(), 'gw-test-'));
process.env.DB_PATH = join(tmpDir, 'gateway.db');
// Semántica Stellar (1e7 stroops, rate 0.12). chain.ts lee process.env al cargarse,
// así que debe fijarse ANTES de importar src. Forzamos modo degradado (sin
// STELLAR_CONTRACT_ID) para que masterWalletPubkey sea determinista (base58 del
// seed) sin depender del entorno donde corran los tests (p.ej. el contenedor sí
// tiene STELLAR_CONTRACT_ID y devolvería la dirección G...).
process.env.CHAIN = 'stellar';
process.env.XLM_USD_RATE = process.env.XLM_USD_RATE || '0.12';
delete process.env.STELLAR_CONTRACT_ID;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use';

// Master wallet por env (para que wallets.ts no toque el filesystem)
const masterKp = Keypair.generate();
process.env.MASTER_WALLET_SECRET = JSON.stringify(Array.from(masterKp.secretKey));

// Path master keypair en el tmpDir, no en /app/data
process.env.MASTER_KEYPAIR_PATH = join(tmpDir, 'master-wallet.json');

export const TEST_TMP_DIR = tmpDir;
export const TEST_MASTER_KEYPAIR = masterKp;
