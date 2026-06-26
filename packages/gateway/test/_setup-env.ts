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
// Los tests de billing fijan la semántica Solana (rate 150, 1e9 unidades base):
// sus aserciones están escritas contra esas constantes. Sin pinear CHAIN, caería
// al default 'stellar' (1e7 stroops, rate 0.12) y romperían. chain.ts lee
// process.env.CHAIN al cargarse, así que debe quedar fijado ANTES de importar src.
process.env.CHAIN = process.env.CHAIN || 'solana';
process.env.SOL_USD_RATE = process.env.SOL_USD_RATE || '150';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use';

// Master wallet por env (para que wallets.ts no toque el filesystem)
const masterKp = Keypair.generate();
process.env.MASTER_WALLET_SECRET = JSON.stringify(Array.from(masterKp.secretKey));

// Path master keypair en el tmpDir, no en /app/data
process.env.MASTER_KEYPAIR_PATH = join(tmpDir, 'master-wallet.json');

export const TEST_TMP_DIR = tmpDir;
export const TEST_MASTER_KEYPAIR = masterKp;
