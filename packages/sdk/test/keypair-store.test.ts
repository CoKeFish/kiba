import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { loadOrCreateKeypair, loadKeypairFromEnvOrFile } from '../src/keypair-store';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sdk-keypair-'));
});

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ─── loadOrCreateKeypair ───────────────────────────────────────

test('loadOrCreateKeypair: file missing → generates and persists (32-byte seed)', () => {
  const path = join(tmp, 'wallet.json');
  assert.equal(existsSync(path), false);

  const kp = loadOrCreateKeypair(path);
  assert.ok(kp instanceof Keypair);
  assert.equal(existsSync(path), true);

  // The file holds a 32-byte seed array.
  const arr = JSON.parse(readFileSync(path, 'utf8')) as number[];
  assert.equal(arr.length, 32);
  // Reload yields the same address.
  const reloaded = Keypair.fromRawEd25519Seed(Buffer.from(arr));
  assert.equal(reloaded.publicKey(), kp.publicKey());

  cleanup(tmp);
});

test('loadOrCreateKeypair: existing 32-byte seed file → same keypair', () => {
  const path = join(tmp, 'existing.json');
  const original = Keypair.random();
  writeFileSync(path, JSON.stringify(Array.from(original.rawSecretKey())));

  const loaded = loadOrCreateKeypair(path);
  assert.equal(loaded.publicKey(), original.publicKey());

  cleanup(tmp);
});

test('loadOrCreateKeypair: legacy 64-byte secretKey file → same address (first 32 = seed)', () => {
  const path = join(tmp, 'legacy.json');
  const kp = Keypair.random();
  // Simulate a legacy Solana-style 64-byte secretKey: [seed(32) || pubkey(32)].
  const legacy64 = [...Array.from(kp.rawSecretKey()), ...Array.from(kp.rawPublicKey())];
  assert.equal(legacy64.length, 64);
  writeFileSync(path, JSON.stringify(legacy64));

  const loaded = loadOrCreateKeypair(path);
  assert.equal(loaded.publicKey(), kp.publicKey());

  cleanup(tmp);
});

test('loadOrCreateKeypair: two calls on the same path return the same pubkey', () => {
  const path = join(tmp, 'same.json');
  const k1 = loadOrCreateKeypair(path);
  const k2 = loadOrCreateKeypair(path);
  assert.equal(k1.publicKey(), k2.publicKey());
  cleanup(tmp);
});

test('loadOrCreateKeypair: creates parent directories if missing', () => {
  const nested = join(tmp, 'a', 'b', 'c', 'wallet.json');
  const kp = loadOrCreateKeypair(nested);
  assert.ok(kp);
  assert.equal(existsSync(nested), true);
  cleanup(tmp);
});

test('loadOrCreateKeypair: new file written with mode 600 (POSIX only)', { skip: process.platform === 'win32' }, () => {
  const path = join(tmp, 'mode.json');
  loadOrCreateKeypair(path);
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  cleanup(tmp);
});

// ─── loadKeypairFromEnvOrFile ──────────────────────────────────

test('loadKeypairFromEnvOrFile: env set (byte array) → keypair from env, file untouched', () => {
  const filePath = join(tmp, 'should-not-exist.json');
  const fromEnv = Keypair.random();
  process.env.AGENT_TEST_KEYPAIR = JSON.stringify(Array.from(fromEnv.rawSecretKey()));

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR', filePath);
  assert.equal(kp.publicKey(), fromEnv.publicKey());
  assert.equal(existsSync(filePath), false);

  delete process.env.AGENT_TEST_KEYPAIR;
  cleanup(tmp);
});

test('loadKeypairFromEnvOrFile: env set (S... secret) → keypair from env', () => {
  const filePath = join(tmp, 'no.json');
  const fromEnv = Keypair.random();
  process.env.AGENT_TEST_KEYPAIR_S = fromEnv.secret();

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR_S', filePath);
  assert.equal(kp.publicKey(), fromEnv.publicKey());
  assert.equal(existsSync(filePath), false);

  delete process.env.AGENT_TEST_KEYPAIR_S;
  cleanup(tmp);
});

test('loadKeypairFromEnvOrFile: env empty → falls back to file', () => {
  delete process.env.AGENT_TEST_KEYPAIR_2;
  const filePath = join(tmp, 'fallback.json');

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR_2', filePath);
  assert.equal(existsSync(filePath), true);
  const arr = JSON.parse(readFileSync(filePath, 'utf8')) as number[];
  const fromFile = Keypair.fromRawEd25519Seed(Buffer.from(arr));
  assert.equal(kp.publicKey(), fromFile.publicKey());

  cleanup(tmp);
});

test('loadKeypairFromEnvOrFile: env empty and file exists → uses the file', () => {
  delete process.env.AGENT_TEST_KEYPAIR_3;
  const filePath = join(tmp, 'preexist.json');
  const seeded = Keypair.random();
  mkdirSync(tmp, { recursive: true });
  writeFileSync(filePath, JSON.stringify(Array.from(seeded.rawSecretKey())));

  const kp = loadKeypairFromEnvOrFile('AGENT_TEST_KEYPAIR_3', filePath);
  assert.equal(kp.publicKey(), seeded.publicKey());

  cleanup(tmp);
});
