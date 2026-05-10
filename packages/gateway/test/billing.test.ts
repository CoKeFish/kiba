// _setup-env.ts establece DB_PATH/SOL_USD_RATE/etc antes de que se carguen
// los módulos del gateway. ES2020 garantiza orden de ejecución left-to-right
// para imports.
import { TEST_TMP_DIR } from './_setup-env';

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import {
  usdToLamports,
  lamportsToUsd,
  lamportsToSol,
  getBalance,
  topup,
  debit,
  attachSignature,
  getTransactions,
} from '../src/billing';
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

function createTestUser(email: string, balanceLamports = 0): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(email, 'fake-hash', '[]', `pk-${email}`, balanceLamports, now);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  // Cada test arranca con tablas vacías
  db.exec('DELETE FROM transactions; DELETE FROM users;');
});

// ─── usdToLamports / lamportsToUsd ─────────────────────────────

test('usdToLamports: $0 → 0 lamports', () => {
  assert.equal(usdToLamports(0), 0);
});

test('usdToLamports: $5 → 33_333_333 lamports (rate 150)', () => {
  // 5/150 * 1e9 = 33_333_333.333... → floor → 33_333_333
  assert.equal(usdToLamports(5), 33_333_333);
});

test('usdToLamports: $0.01 → 66_666 lamports', () => {
  // 0.01/150 * 1e9 = 66_666.66... → floor
  assert.equal(usdToLamports(0.01), 66_666);
});

test('usdToLamports: $150 → 1 SOL exact', () => {
  assert.equal(usdToLamports(150), 1_000_000_000);
});

test('lamportsToUsd: 1 SOL → $150', () => {
  assert.equal(lamportsToUsd(1_000_000_000), 150);
});

test('lamportsToUsd: 0 → 0', () => {
  assert.equal(lamportsToUsd(0), 0);
});

test('lamportsToSol: 1e9 → 1', () => {
  assert.equal(lamportsToSol(1_000_000_000), 1);
});

test('lamportsToSol: 0.5 SOL', () => {
  assert.equal(lamportsToSol(500_000_000), 0.5);
});

test('round-trip USD ↔ lamports preserves whole-dollar amounts', () => {
  for (const usd of [1, 5, 10, 100, 150, 1000]) {
    const round = lamportsToUsd(usdToLamports(usd));
    // Tolerancia por floor en usdToLamports
    assert.ok(Math.abs(round - usd) < 1e-3, `${usd} round-trip: ${round}`);
  }
});

// ─── getBalance ────────────────────────────────────────────────

test('getBalance: usuario inexistente → 0', () => {
  assert.equal(getBalance(99999), 0);
});

test('getBalance: usuario con saldo seteado lo retorna', () => {
  const userId = createTestUser('a@test', 1_000_000);
  assert.equal(getBalance(userId), 1_000_000);
});

// ─── topup ─────────────────────────────────────────────────────

test('topup suma al balance e inserta una transacción', () => {
  const userId = createTestUser('topup@test', 0);
  const result = topup(userId, 5);
  assert.equal(result.newBalance, usdToLamports(5));
  const txs = getTransactions(userId);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].type, 'topup');
  assert.equal(txs[0].amount_lamports, usdToLamports(5));
  assert.equal(txs[0].service, 'fake-stripe');
});

test('topup acumula saldo existente', () => {
  const userId = createTestUser('topup2@test', 100_000);
  topup(userId, 1);
  assert.equal(getBalance(userId), 100_000 + usdToLamports(1));
});

// ─── debit ─────────────────────────────────────────────────────

test('debit con saldo suficiente: ok + nueva transacción "call" (negativa)', () => {
  const userId = createTestUser('debit@test', 1_000_000);
  const result = debit({ userId, lamports: 200_000, service: 'translator' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.newBalance, 800_000);
  }
  const txs = getTransactions(userId);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].type, 'call');
  assert.equal(txs[0].amount_lamports, -200_000);
  assert.equal(txs[0].service, 'translator');
});

test('debit con saldo insuficiente: error y no toca balance', () => {
  const userId = createTestUser('poor@test', 100);
  const result = debit({ userId, lamports: 200_000, service: 'translator' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /insufficient/i);
  }
  // Saldo no cambia
  assert.equal(getBalance(userId), 100);
  // No se registra tx
  assert.equal(getTransactions(userId).length, 0);
});

test('debit a usuario inexistente: error "user not found"', () => {
  const result = debit({ userId: 99999, lamports: 100, service: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /not found/i);
  }
});

test('debit acepta y persiste signature + metadata', () => {
  const userId = createTestUser('sig@test', 1_000_000);
  debit({
    userId,
    lamports: 100,
    service: 'translator',
    signature: 'sig-abc',
    metadata: { mode: 'virtual' },
  });
  const txs = getTransactions(userId);
  assert.equal(txs[0].signature, 'sig-abc');
  assert.ok(txs[0].metadata);
  const meta = JSON.parse(txs[0].metadata!);
  assert.equal(meta.mode, 'virtual');
});

test('debit exacto del saldo deja balance en 0', () => {
  const userId = createTestUser('exact@test', 500_000);
  const result = debit({ userId, lamports: 500_000, service: 's' });
  assert.equal(result.ok, true);
  assert.equal(getBalance(userId), 0);
});

test('debit es atómico: si falla por saldo, no inserta tx', () => {
  const userId = createTestUser('atomic@test', 50);
  debit({ userId, lamports: 1_000_000, service: 's' });
  const txs = getTransactions(userId);
  assert.equal(txs.length, 0, 'no debe haber tx tras debit fallido');
});

// ─── cascade-decision proxy (tested via billing primitives) ────
// La cascada en sí vive en proxy.ts (que importa wallets.ts y se conecta a
// Solana). Aquí cubrimos la decisión "virtual vs insuficiente" a través de
// las primitivas que usa: getBalance + debit. wallet-direct se cubre por
// implicación cuando getBalance < cost.

test('cascade primitives: virtual cubre el costo → debit ok', () => {
  const userId = createTestUser('cascade1@test', 1_000_000);
  const cost = 500_000;
  const balanceBefore = getBalance(userId);
  const usesVirtual = balanceBefore >= cost;
  assert.equal(usesVirtual, true);
  const r = debit({ userId, lamports: cost, service: 's' });
  assert.equal(r.ok, true);
});

test('cascade primitives: virtual insuficiente → no se debita (path wallet-direct)', () => {
  const userId = createTestUser('cascade2@test', 100);
  const cost = 500_000;
  const balanceBefore = getBalance(userId);
  const usesVirtual = balanceBefore >= cost;
  assert.equal(usesVirtual, false, 'la cascada debe escoger wallet-direct');
  // No debit en wallet-direct → balance virtual queda intacto
  assert.equal(getBalance(userId), 100);
});

// ─── getTransactions ───────────────────────────────────────────

test('getTransactions: orden DESC por created_at', () => {
  const userId = createTestUser('order@test', 10_000_000);
  // Insert manual con timestamps controlados (sin sleep, mucho más rápido)
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount_lamports, service, created_at)
     VALUES (?, 'topup', 1000, 'fake-stripe', ?)`,
  ).run(userId, 1_000_000);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount_lamports, service, created_at)
     VALUES (?, 'call', -100, 'x', ?)`,
  ).run(userId, 2_000_000);
  const txs = getTransactions(userId);
  assert.equal(txs.length, 2);
  assert.ok(txs[0].created_at >= txs[1].created_at);
  assert.equal(txs[0].created_at, 2_000_000);
});

test('getTransactions: respeta limit', () => {
  const userId = createTestUser('limit@test', 100_000_000);
  for (let i = 0; i < 5; i++) topup(userId, 1);
  const txs = getTransactions(userId, 2);
  assert.equal(txs.length, 2);
});

// ─── debit retorna transactionId + attachSignature (Fix #2) ────

test('debit retorna transactionId del row recién insertado', () => {
  const userId = createTestUser('txid@test', 1_000_000);
  const r = debit({ userId, lamports: 100, service: 's' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(typeof r.transactionId, 'number');
  assert.ok(r.transactionId > 0);
  // El id debe corresponder al último row insertado
  const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(r.transactionId) as
    | { id: number }
    | undefined;
  assert.ok(tx, 'el row debe existir');
});

test('attachSignature backfill la signature en un row existente', () => {
  const userId = createTestUser('sig-backfill@test', 1_000_000);
  const r = debit({ userId, lamports: 100, service: 's' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Antes del attach: signature null
  const before = db.prepare('SELECT signature FROM transactions WHERE id = ?').get(r.transactionId) as
    | { signature: string | null }
    | undefined;
  assert.equal(before?.signature, null);

  attachSignature(r.transactionId, 'sig_abc_xyz');

  const after = db.prepare('SELECT signature FROM transactions WHERE id = ?').get(r.transactionId) as
    | { signature: string | null }
    | undefined;
  assert.equal(after?.signature, 'sig_abc_xyz');
});

test('attachSignature en id inexistente: no-throw, no efecto', () => {
  // SQLite UPDATE sobre 0 rows no falla
  attachSignature(999_999, 'sig_no_op');
  // Si no hay row, simplemente no hay efecto
  const row = db.prepare('SELECT * FROM transactions WHERE id = 999999').get();
  assert.equal(row, undefined);
});
