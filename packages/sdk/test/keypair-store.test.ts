import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { loadOrCreateKeypair, loadKeypairFromEnvOrFile } from '../src/keypair-store';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sdk-keypair-'));
});

after(() => {
  // Cleanup any tmp dirs left by individual tests is per-test; nothing global.
});

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ─── loadOrCreateKeypair ───────────────────────────────────────

test('loadOrCreateKeypair: archivo no existe → genera y persiste', () => {
  const path = join(tmp, 'wallet.json');
  assert.equal(existsSync(path), false);

  const kp = loadOrCreateKeypair(path);
  assert.ok(kp instanceof Keypair);
  assert.equal(existsSync(path), true);

  // El archivo contiene un array JSON de 64 bytes
  const arr = JSON.parse(readFileSync(path, 'utf8')) as number[];
  assert.equal(arr.length, 64);
  // Y reload da la misma keypair
  const reloaded = Keypair.fromSecretKey(Uint8Array.from(arr));
  assert.equal(reloaded.publicKey.toBase58(), kp.publicKey.toBase58());

  cleanup(tmp);
});

test('loadOrCreateKeypair: archivo existente → carga la misma keypair', () => {
  const path = join(tmp, 'existing.json');
  const original = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(original.secretKey)));

  const loaded = loadOrCreateKeypair(path);
  assert.equal(loaded.publicKey.toBase58(), original.publicKey.toBase58());

  cleanup(tmp);
});

test('loadOrCreateKeypair: dos calls al mismo path devuelven la misma pubkey', () => {
  const path = join(tmp, 'same.json');
  const k1 = loadOrCreateKeypair(path);
  const k2 = loadOrCreateKeypair(path);
  assert.equal(k1.publicKey.toBase58(), k2.publicKey.toBase58());
  cleanup(tmp);
});

test('loadOrCreateKeypair: crea directorios padre si no existen', () => {
  const nested = join(tmp, 'a', 'b', 'c', 'wallet.json');
  // Ningún antecesor existe
  const kp = loadOrCreateKeypair(nested);
  assert.ok(kp);
  assert.equal(existsSync(nested), true);
  cleanup(tmp);
});

// El modo de archivo (0o600) es parte del contrato pero en Windows el bit
// permission no se aplica de manera estricta. Solo verificamos en POSIX.
test('loadOrCreateKeypair: archivo nuevo escrito con mode 600 (solo POSIX)', { skip: process.platform === 'win32' }, () => {
  const path = join(tmp, 'mode.json');
  loadOrCreateKeypair(path);
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  cleanup(tmp);
});

// ─── loadKeypairFromEnvOrFile ──────────────────────────────────

test('loadKeypairFromEnvOrFile: env set → keypair derivada del env (file no se toca)', () => {
  const filePath = join(tmp, 'should-not-exist.json');
  const fromEnv = Keypair.generate();
  process.env.AGENT_TEST_KEYPAIR = JSON.stringify(Array.from(fromEnv.secretKey));

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR', filePath);
  assert.equal(kp.publicKey.toBase58(), fromEnv.publicKey.toBase58());
  // No debe haber escrito el archivo
  assert.equal(existsSync(filePath), false);

  delete process.env.AGENT_TEST_KEYPAIR;
  cleanup(tmp);
});

test('loadKeypairFromEnvOrFile: env vacío → cae a archivo (loadOrCreateKeypair)', () => {
  delete process.env.AGENT_TEST_KEYPAIR_2;
  const filePath = join(tmp, 'fallback.json');

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR_2', filePath);
  // Como el env no estaba set, debe haber creado el archivo
  assert.equal(existsSync(filePath), true);
  // Y la pubkey del archivo debe coincidir con la keypair retornada
  const arr = JSON.parse(readFileSync(filePath, 'utf8')) as number[];
  const fromFile = Keypair.fromSecretKey(Uint8Array.from(arr));
  assert.equal(kp.publicKey.toBase58(), fromFile.publicKey.toBase58());

  cleanup(tmp);
});

test('loadKeypairFromEnvOrFile: env vacío y archivo existe → usa el archivo', () => {
  delete process.env.AGENT_TEST_KEYPAIR_3;
  const filePath = join(tmp, 'preexist.json');
  const seeded = Keypair.generate();
  // mkdir parent del path
  mkdirSync(tmp, { recursive: true });
  writeFileSync(filePath, JSON.stringify(Array.from(seeded.secretKey)));

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR_3', filePath);
  assert.equal(kp.publicKey.toBase58(), seeded.publicKey.toBase58());

  cleanup(tmp);
});
