// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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
import { db, initDb, pool } from '../src/db';
import { BASE_UNITS_PER_TOKEN, ASSET_USD_RATE } from '../src/chain';

before(async () => {
  await initDb();
});

after(async () => {
  await pool.end();
});

async function createTestUser(email: string, balanceLamports = 0): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', '[]', `pk-${email}`, balanceLamports, now);
  return Number(result.lastInsertRowid);
}

beforeEach(async () => {
  // Cada test arranca con tablas vacías
  await db.exec(TRUNCATE_SQL);
});

// ─── usdToLamports / lamportsToUsd (chain-agnostic, vía constantes) ──

test('usdToLamports: $0 → 0 unidades base', () => {
  assert.equal(usdToLamports(0), 0);
});

test('usdToLamports($X) = floor(X/rate * base)', () => {
  for (const usd of [0.01, 5, 100]) {
    assert.equal(usdToLamports(usd), Math.floor((usd / ASSET_USD_RATE) * BASE_UNITS_PER_TOKEN));
  }
});

test('usdToLamports(rate) = 1 token (base units exactos)', () => {
  assert.equal(usdToLamports(ASSET_USD_RATE), BASE_UNITS_PER_TOKEN);
});

test('lamportsToUsd: 1 token base → rate', () => {
  assert.equal(lamportsToUsd(BASE_UNITS_PER_TOKEN), ASSET_USD_RATE);
});

test('lamportsToUsd: 0 → 0', () => {
  assert.equal(lamportsToUsd(0), 0);
});

test('lamportsToSol: base → 1', () => {
  assert.equal(lamportsToSol(BASE_UNITS_PER_TOKEN), 1);
});

test('lamportsToSol: base/2 → 0.5', () => {
  assert.equal(lamportsToSol(BASE_UNITS_PER_TOKEN / 2), 0.5);
});

test('round-trip USD ↔ base preserva montos en dólares enteros', () => {
  for (const usd of [1, 5, 10, 100]) {
    const round = lamportsToUsd(usdToLamports(usd));
    // Tolerancia por floor en usdToLamports
    assert.ok(Math.abs(round - usd) < 1e-3, `${usd} round-trip: ${round}`);
  }
});

// ─── getBalance ────────────────────────────────────────────────

test('getBalance: usuario inexistente → 0', async () => {
  assert.equal(await getBalance(99999), 0);
});

test('getBalance: usuario con saldo seteado lo retorna', async () => {
  const userId = await createTestUser('a@test', 1_000_000);
  assert.equal(await getBalance(userId), 1_000_000);
});

// ─── topup ─────────────────────────────────────────────────────

test('topup suma al balance e inserta una transacción', async () => {
  const userId = await createTestUser('topup@test', 0);
  const result = await topup(userId, 5);
  assert.equal(result.newBalance, usdToLamports(5));
  const txs = await getTransactions(userId);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].type, 'topup');
  assert.equal(txs[0].amount_lamports, usdToLamports(5));
  assert.equal(txs[0].service, 'fake-stripe');
});

test('topup acumula saldo existente', async () => {
  const userId = await createTestUser('topup2@test', 100_000);
  await topup(userId, 1);
  assert.equal(await getBalance(userId), 100_000 + usdToLamports(1));
});

// ─── debit ─────────────────────────────────────────────────────

test('debit con saldo suficiente: ok + nueva transacción "call" (negativa)', async () => {
  const userId = await createTestUser('debit@test', 1_000_000);
  const result = await debit({ userId, lamports: 200_000, service: 'translator' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.newBalance, 800_000);
  }
  const txs = await getTransactions(userId);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].type, 'call');
  assert.equal(txs[0].amount_lamports, -200_000);
  assert.equal(txs[0].service, 'translator');
});

test('debit con saldo insuficiente: error y no toca balance', async () => {
  const userId = await createTestUser('poor@test', 100);
  const result = await debit({ userId, lamports: 200_000, service: 'translator' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /insufficient/i);
  }
  // Saldo no cambia
  assert.equal(await getBalance(userId), 100);
  // No se registra tx
  assert.equal((await getTransactions(userId)).length, 0);
});

test('debit a usuario inexistente: error "user not found"', async () => {
  const result = await debit({ userId: 99999, lamports: 100, service: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /not found/i);
  }
});

test('debit acepta y persiste signature + metadata', async () => {
  const userId = await createTestUser('sig@test', 1_000_000);
  await debit({
    userId,
    lamports: 100,
    service: 'translator',
    signature: 'sig-abc',
    metadata: { mode: 'virtual' },
  });
  const txs = await getTransactions(userId);
  assert.equal(txs[0].signature, 'sig-abc');
  assert.ok(txs[0].metadata);
  const meta = JSON.parse(txs[0].metadata!);
  assert.equal(meta.mode, 'virtual');
});

test('debit exacto del saldo deja balance en 0', async () => {
  const userId = await createTestUser('exact@test', 500_000);
  const result = await debit({ userId, lamports: 500_000, service: 's' });
  assert.equal(result.ok, true);
  assert.equal(await getBalance(userId), 0);
});

test('debit es atómico: si falla por saldo, no inserta tx', async () => {
  const userId = await createTestUser('atomic@test', 50);
  await debit({ userId, lamports: 1_000_000, service: 's' });
  const txs = await getTransactions(userId);
  assert.equal(txs.length, 0, 'no debe haber tx tras debit fallido');
});

// ─── cascade-decision proxy (tested via billing primitives) ────
// La cascada en sí vive en proxy.ts (que importa wallets.ts y se conecta a
// la cadena). Aquí cubrimos la decisión "virtual vs insuficiente" a través de
// las primitivas que usa: getBalance + debit. wallet-direct se cubre por
// implicación cuando getBalance < cost.

test('cascade primitives: virtual cubre el costo → debit ok', async () => {
  const userId = await createTestUser('cascade1@test', 1_000_000);
  const cost = 500_000;
  const balanceBefore = await getBalance(userId);
  const usesVirtual = balanceBefore >= cost;
  assert.equal(usesVirtual, true);
  const r = await debit({ userId, lamports: cost, service: 's' });
  assert.equal(r.ok, true);
});

test('cascade primitives: virtual insuficiente → no se debita (path wallet-direct)', async () => {
  const userId = await createTestUser('cascade2@test', 100);
  const cost = 500_000;
  const balanceBefore = await getBalance(userId);
  const usesVirtual = balanceBefore >= cost;
  assert.equal(usesVirtual, false, 'la cascada debe escoger wallet-direct');
  // No debit en wallet-direct → balance virtual queda intacto
  assert.equal(await getBalance(userId), 100);
});

// ─── getTransactions ───────────────────────────────────────────

test('getTransactions: orden DESC por created_at', async () => {
  const userId = await createTestUser('order@test', 10_000_000);
  // Insert manual con timestamps controlados (sin sleep, mucho más rápido)
  await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, created_at)
     VALUES (?, 'topup', 1000, 'fake-stripe', ?)`,
    )
    .run(userId, 1_000_000);
  await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, created_at)
     VALUES (?, 'call', -100, 'x', ?)`,
    )
    .run(userId, 2_000_000);
  const txs = await getTransactions(userId);
  assert.equal(txs.length, 2);
  assert.ok(txs[0].created_at >= txs[1].created_at);
  assert.equal(txs[0].created_at, 2_000_000);
});

test('getTransactions: respeta limit', async () => {
  const userId = await createTestUser('limit@test', 100_000_000);
  for (let i = 0; i < 5; i++) await topup(userId, 1);
  const txs = await getTransactions(userId, 2);
  assert.equal(txs.length, 2);
});

// ─── debit retorna transactionId + attachSignature (Fix #2) ────

test('debit retorna transactionId del row recién insertado', async () => {
  const userId = await createTestUser('txid@test', 1_000_000);
  const r = await debit({ userId, lamports: 100, service: 's' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(typeof r.transactionId, 'number');
  assert.ok(r.transactionId > 0);
  // El id debe corresponder al último row insertado
  const tx = (await db.prepare('SELECT id FROM transactions WHERE id = ?').get(r.transactionId)) as
    | { id: number }
    | undefined;
  assert.ok(tx, 'el row debe existir');
});

test('attachSignature backfill la signature en un row existente', async () => {
  const userId = await createTestUser('sig-backfill@test', 1_000_000);
  const r = await debit({ userId, lamports: 100, service: 's' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Antes del attach: signature null
  const before = (await db
    .prepare('SELECT signature FROM transactions WHERE id = ?')
    .get(r.transactionId)) as { signature: string | null } | undefined;
  assert.equal(before?.signature, null);

  await attachSignature(r.transactionId, 'sig_abc_xyz');

  const after = (await db
    .prepare('SELECT signature FROM transactions WHERE id = ?')
    .get(r.transactionId)) as { signature: string | null } | undefined;
  assert.equal(after?.signature, 'sig_abc_xyz');
});

test('attachSignature en id inexistente: no-throw, no efecto', async () => {
  // UPDATE sobre 0 rows no falla
  await attachSignature(999_999, 'sig_no_op');
  // Si no hay row, simplemente no hay efecto
  const row = await db.prepare('SELECT * FROM transactions WHERE id = 999999').get();
  assert.equal(row, undefined);
});


// ─── Créditos como prepago: tope, caducidad, sin retiro ─────────────────────

import {
  CREDIT_EXPIRY_DAYS,
  CREDIT_MAX_BALANCE_USD,
  assertTopupAllowed,
  creditStatus,
  expireCredits,
} from '../src/billing';

const DAY = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
/** Hace que todos los lotes de una cuenta hayan entrado hace `days` días. */
const ageLots = (userId: number, days: number) =>
  db.prepare('UPDATE credit_lots SET expires_at = expires_at - ? WHERE user_id = ?').run(days * DAY, userId);
const lotsOf = async (userId: number) =>
  ((await db.prepare('SELECT remaining FROM credit_lots WHERE user_id = ? AND remaining > 0 ORDER BY expires_at, id').all(userId)) as Array<{ remaining: number }>).map(
    (l) => Number(l.remaining),
  );

test('tope por cuenta: una recarga que lo supera se rechaza, y dice cuánto cabe', async () => {
  const userId = await createTestUser('cap@test', 0);
  await assertTopupAllowed(userId, CREDIT_MAX_BALANCE_USD);
  await topup(userId, CREDIT_MAX_BALANCE_USD - 10);
  await assertTopupAllowed(userId, 10);
  await assert.rejects(() => assertTopupAllowed(userId, 10.01), /puedes recargar hasta 10\.00 USD más/);
  const st = await creditStatus(userId);
  assert.equal(st.capUsd, CREDIT_MAX_BALANCE_USD);
  assert.ok(Math.abs(st.roomUsd - 10) < 1e-6);
});

test('los créditos caducan: se gasta primero lo que vence antes y lo vencido se descuenta', async () => {
  assert.equal(CREDIT_EXPIRY_DAYS, 365);
  const userId = await createTestUser('exp@test', 0);
  await topup(userId, 1); // 1 USD viejo
  await creditStatus(userId); // crea su lote
  await ageLots(userId, 300); // le quedan 65 días
  await topup(userId, 2); // 2 USD nuevos

  let st = await creditStatus(userId);
  assert.equal(st.balanceLamports, usdToLamports(3));
  assert.deepEqual(await lotsOf(userId), [usdToLamports(1), usdToLamports(2)]);
  assert.equal(st.nextExpiry?.lamports, usdToLamports(1));
  assert.ok(Math.abs(st.nextExpiry!.at - (nowS() + 65 * DAY)) < 5);

  // Un gasto de 0,40 sale del lote viejo.
  const d = await debit({ userId, lamports: usdToLamports(0.4), service: 'x' });
  assert.equal(d.ok, true);
  assert.deepEqual(await lotsOf(userId), [usdToLamports(0.6), usdToLamports(2)]);

  // Pasa el tiempo: el lote viejo vence. Lo que le quedaba se descuenta y queda registrado.
  assert.equal(await expireCredits(nowS() + 66 * DAY), 1);
  assert.equal(await getBalance(userId), usdToLamports(2));
  assert.deepEqual(await lotsOf(userId), [usdToLamports(2)]);
  const tx = (await db.prepare(`SELECT amount_lamports, type FROM transactions WHERE user_id = ? AND type = 'expire'`).get(userId)) as {
    amount_lamports: number;
    type: string;
  };
  assert.equal(Number(tx.amount_lamports), -usdToLamports(0.6));
  assert.equal(await expireCredits(nowS() + 66 * DAY), 0); // no dos veces
});

test('lo caducado no se puede gastar aunque el trabajo periódico no haya pasado', async () => {
  const userId = await createTestUser('late@test', 0);
  await topup(userId, 1);
  await creditStatus(userId);
  await ageLots(userId, 366); // ya venció
  const d = await debit({ userId, lamports: usdToLamports(0.5), service: 'x' });
  assert.deepEqual(d, { ok: false, error: 'insufficient balance' });
  assert.equal(await getBalance(userId), 0);
});

test('un reembolso entra como créditos nuevos, con su propio vencimiento', async () => {
  const userId = await createTestUser('refund@test', 0);
  await topup(userId, 1);
  await debit({ userId, lamports: usdToLamports(1), service: 'x' });
  assert.deepEqual(await lotsOf(userId), []);
  // Así devuelven saldo los demás módulos: sumando al total, sin saber de lotes.
  await db.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(usdToLamports(1), userId);
  const st = await creditStatus(userId);
  assert.deepEqual(await lotsOf(userId), [usdToLamports(1)]);
  assert.ok(Math.abs(st.nextExpiry!.at - (nowS() + 365 * DAY)) < 5);
});

test('los créditos no salen de la cuenta: no hay retiro ni transferencia', async () => {
  // El único gasto posible es `debit` (una llamada) y la caducidad. Ninguna ruta del gateway
  // resta créditos de otra forma: se comprueba sobre el código.
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f === 'billing.ts') continue;
    const src = readFileSync(new URL(f, dir), 'utf8');
    if (/balance_lamports\s*=\s*balance_lamports\s*-/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});
