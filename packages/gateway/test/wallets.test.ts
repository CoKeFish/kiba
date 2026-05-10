import { TEST_TMP_DIR, TEST_MASTER_KEYPAIR } from './_setup-env';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { rmSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { getMasterWallet, masterWalletPubkey, loadUserWallet } from '../src/wallets';
import { db } from '../src/db';

after(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ─── master wallet (env path) ──────────────────────────────────

test('loadMasterWallet usa MASTER_WALLET_SECRET cuando está set', () => {
  // _setup-env seteó MASTER_WALLET_SECRET con TEST_MASTER_KEYPAIR antes del
  // import de wallets.ts → la master en memoria debe coincidir.
  const got = getMasterWallet();
  assert.equal(got.publicKey.toBase58(), TEST_MASTER_KEYPAIR.publicKey.toBase58());
});

test('masterWalletPubkey() devuelve la pubkey base58 de la master', () => {
  assert.equal(masterWalletPubkey(), TEST_MASTER_KEYPAIR.publicKey.toBase58());
});

// ─── master wallet (file fallback) ─────────────────────────────
// Como wallets.ts evalúa loadMasterWallet UNA VEZ al importar, el path "fallback
// a archivo" no se puede ejercitar in-process una vez el env ya está set.
// Lo cubrimos con un subproceso: limpiamos MASTER_WALLET_SECRET, pasamos un path
// temporal, importamos el módulo, y verificamos que se creó el archivo de
// keypair y que la pubkey en memoria coincide con el contenido del archivo.

test('loadMasterWallet cae a archivo cuando MASTER_WALLET_SECRET está vacío', () => {
  const subTmp = mkdtempSync(join(tmpdir(), 'gw-wallets-sub-'));
  const dbPath = join(subTmp, 'sub.db');
  const masterPath = join(subTmp, 'master-wallet.json');
  const scriptPath = join(subTmp, 'probe.ts');

  // Escribimos el script en disco para evitar problemas de quoting en Windows
  // shell. El subproceso limpia el env de master, fija un path temporal,
  // importa wallets.ts, e imprime la pubkey por stdout.
  // Path absoluto al wallets.ts; pathToFileURL para que dynamic import lo
  // acepte como URL.
  const walletsTs = join(__dirname, '..', 'src', 'wallets.ts');
  const walletsUrl = pathToFileURL(walletsTs).href;
  const script = `
    process.env.DB_PATH = ${JSON.stringify(dbPath)};
    delete process.env.MASTER_WALLET_SECRET;
    process.env.MASTER_KEYPAIR_PATH = ${JSON.stringify(masterPath)};
    import(${JSON.stringify(walletsUrl)}).then((m) => {
      process.stdout.write(m.masterWalletPubkey());
    }).catch((e) => {
      process.stderr.write('IMPORT_FAIL: ' + ((e && e.message) || String(e)));
      process.exit(2);
    });
  `;
  writeFileSync(scriptPath, script);

  const tsxBin = join(
    __dirname,
    '..',
    '..',
    '..',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );

  let stdout = '';
  try {
    stdout = execFileSync(tsxBin, [scriptPath], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // .cmd requires shell on Windows
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    throw new Error(`subprocess failed: ${err.stderr ?? (e as Error).message}`);
  }

  const pubkeyFromMemory = stdout.trim();
  assert.ok(pubkeyFromMemory.length > 30, `pubkey looks invalid: '${pubkeyFromMemory}'`);

  assert.ok(existsSync(masterPath), 'master-wallet.json no fue creado');
  const arr = JSON.parse(readFileSync(masterPath, 'utf8')) as number[];
  const reloaded = Keypair.fromSecretKey(Uint8Array.from(arr));
  assert.equal(reloaded.publicKey.toBase58(), pubkeyFromMemory);

  rmSync(subTmp, { recursive: true, force: true });
});

// ─── loadUserWallet ────────────────────────────────────────────

test('loadUserWallet recupera keypair del custodial_wallet_secret en DB', () => {
  const userKp = Keypair.generate();
  const secretJson = JSON.stringify(Array.from(userKp.secretKey));
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('uw@test', 'h', secretJson, userKp.publicKey.toBase58(), 0, now);
  const userId = Number(result.lastInsertRowid);

  const loaded = loadUserWallet(userId);
  assert.equal(loaded.publicKey.toBase58(), userKp.publicKey.toBase58());
});

test('loadUserWallet con userId inexistente lanza error', () => {
  assert.throws(() => loadUserWallet(999999), /not found/);
});
