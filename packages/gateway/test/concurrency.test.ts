// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDb, pool } from '../src/db';
import { creditStatus, debit, expireCredits, getBalance, topup, usdToLamports } from '../src/billing';
import { recordEarning } from '../src/settlement';
import { closePeriods, createClaim, fundHolds, releaseDue, resolveClaim, setHoldBackend, type HoldBackend } from '../src/retention';

/**
 * Lo que estas pruebas buscan: que al llegar muchas operaciones a la vez sobre el mismo dinero,
 * ninguna se cuente dos veces ni se pierda.
 */

const USD = (n: number) => usdToLamports(n);
const DAY = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);

before(async () => {
  await initDb();
});
after(async () => {
  setHoldBackend(null);
  await pool.end();
});
beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
});

async function user(email: string): Promise<number> {
  const r = await db
    .prepare(`INSERT INTO users (email, password_hash, balance_lamports, created_at) VALUES (?, 'x', 0, ?) RETURNING id`)
    .run(email, nowS());
  return Number(r.lastInsertRowid);
}
const lotsTotal = async (userId: number) =>
  Number(((await db.prepare('SELECT COALESCE(SUM(remaining), 0)::bigint AS t FROM credit_lots WHERE user_id = ?').get(userId)) as { t: number }).t);

test('40 gastos a la vez sobre un saldo que alcanza para 10: pasan 10 exactos', async () => {
  const u = await user('gasto@test');
  await topup(u, 1);
  const results = await Promise.all(Array.from({ length: 40 }, () => debit({ userId: u, lamports: USD(0.1), service: 'x' })));
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.equal(await getBalance(u), 0);
  assert.equal(await lotsTotal(u), 0);
  const calls = (await db.prepare(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_lamports), 0)::bigint AS t FROM transactions WHERE user_id = ? AND type = 'call'`).get(u)) as {
    n: number;
    t: number;
  };
  assert.deepEqual([calls.n, Number(calls.t)], [10, -USD(1)]);
});

test('gastos, recargas, consultas y caducidad mezclados: el saldo y los lotes siempre cuadran', async () => {
  const u = await user('mezcla@test');
  await topup(u, 5);
  const ops: Array<Promise<unknown>> = [];
  for (let i = 0; i < 25; i++) {
    ops.push(debit({ userId: u, lamports: USD(0.1), service: 'x' }));
    if (i % 5 === 0) ops.push(topup(u, 1));
    if (i % 3 === 0) ops.push(creditStatus(u));
    if (i % 7 === 0) ops.push(expireCredits());
  }
  const done = await Promise.all(ops);
  const spent = done.filter((r) => r && typeof r === 'object' && 'ok' in (r as object) && (r as { ok: boolean }).ok).length;
  // 5 de inicio + 5 recargas de 1 − lo gastado.
  const expected = USD(5) + 5 * USD(1) - spent * USD(0.1);
  await creditStatus(u); // pone los lotes al día
  assert.equal(await getBalance(u), expected);
  assert.equal(await lotsTotal(u), expected);
  assert.ok(expected >= 0);
});

test('caducidad a la vez desde varios procesos: lo vencido se descuenta una sola vez', async () => {
  const u = await user('vence@test');
  await topup(u, 3);
  await creditStatus(u);
  await db.prepare('UPDATE credit_lots SET expires_at = ? WHERE user_id = ?').run(nowS() - DAY, u);
  await Promise.all([expireCredits(), expireCredits(), expireCredits(), creditStatus(u), debit({ userId: u, lamports: USD(1), service: 'x' })]);
  assert.equal(await getBalance(u), 0);
  const exp = (await db.prepare(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_lamports), 0)::bigint AS t FROM transactions WHERE user_id = ? AND type = 'expire'`).get(u)) as {
    n: number;
    t: number;
  };
  assert.deepEqual([exp.n, Number(exp.t)], [1, -USD(3)]);
});

/** Escrow en memoria que cuenta cuántas veces se le pide cada cosa. */
class CountingEscrows implements HoldBackend {
  opened = 0;
  released: string[] = [];
  resolved: Array<[string, number, number]> = [];
  async ready() {}
  async open(a: { engagementId: string }) {
    this.opened++;
    await new Promise((r) => setTimeout(r, 30));
    return { escrowId: `esc-${a.engagementId}` };
  }
  async release(id: string) {
    await new Promise((r) => setTimeout(r, 30));
    this.released.push(id);
  }
  async resolve(id: string, a: { toReceiver: number; toTreasury: number }) {
    await new Promise((r) => setTimeout(r, 30));
    this.resolved.push([id, a.toReceiver, a.toTreasury]);
  }
}

/** Una llamada pagada con créditos hace `daysAgo` días, con su ganancia. */
async function paidCall(userId: number, usdc: number, daysAgo: number) {
  const at = nowS() - daysAgo * DAY;
  const amount = Math.round(usdc * 1e7);
  const tx = await db
    .prepare(`INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at) VALUES (?, 'call', ?, 'traductor', '{}', ?) RETURNING id`)
    .run(userId, -amount, at);
  const transactionId = Number(tx.lastInsertRowid);
  const earningId = await recordEarning({ service: 'traductor', payTo: 'GPUB', lamports: amount, paidBy: { userId, transactionId, paidWith: 'credit' } });
  await db.prepare('UPDATE agent_earnings SET created_at = ? WHERE id = ?').run(at, earningId);
  return transactionId;
}

test('varios administradores resuelven el mismo reclamo a la vez: se devuelve una sola vez', async () => {
  setHoldBackend(new CountingEscrows());
  const buyer = await user('compra@test');
  const admin = await user('admin@test');
  const txId = await paidCall(buyer, 3, 2);
  const claim = await createClaim(buyer, txId, 'El servicio no entregó lo que cobró.');
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => resolveClaim(admin, claim.id, { decision: 'refund' })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await getBalance(buyer), 3e7);
  const refunds = (await db.prepare(`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = ? AND type = 'refund'`).get(buyer)) as { n: number };
  assert.equal(refunds.n, 1);
});

test('el mismo usuario manda el mismo reclamo varias veces a la vez: queda uno', async () => {
  setHoldBackend(new CountingEscrows());
  const buyer = await user('compra@test');
  const txId = await paidCall(buyer, 3, 2);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => createClaim(buyer, txId, 'El servicio no entregó lo que cobró.')));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const n = (await db.prepare('SELECT COUNT(*)::int AS n FROM claims').get()) as { n: number };
  assert.equal(n.n, 1);
});

test('el trabajo de retención corriendo varias veces a la vez no retiene ni libera dos veces', async () => {
  const escrows = new CountingEscrows();
  setHoldBackend(escrows);
  const buyer = await user('compra@test');
  await paidCall(buyer, 3, 2);
  await paidCall(buyer, 2, 2);
  await Promise.all([closePeriods(), closePeriods(), closePeriods()]);
  await Promise.all([fundHolds(), fundHolds(), fundHolds()]);
  const holds = (await db.prepare('SELECT id, status, amount FROM earning_holds').all()) as Array<{ id: number; status: string; amount: number }>;
  const held = holds.filter((h) => h.status === 'held');
  // Lo ganado quedó retenido una sola vez, completo.
  assert.equal(held.reduce((s, h) => s + Number(h.amount), 0), 5e7);
  const linked = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings WHERE hold_id IS NOT NULL').get()) as { n: number };
  assert.equal(linked.n, 2);

  await db.prepare('UPDATE earning_holds SET release_at = ?').run(nowS() - 1);
  await Promise.all([releaseDue(), releaseDue(), releaseDue(), releaseDue()]);
  assert.equal(escrows.released.length, held.length);
  assert.equal(new Set(escrows.released).size, held.length);
  const paid = (await db.prepare(`SELECT COALESCE(SUM(amount_lamports), 0)::bigint AS t FROM settlements WHERE status = 'settled'`).get()) as { t: number };
  assert.equal(Number(paid.t), 5e7);
});

test('un reclamo que llega justo cuando se libera la retención: o entra antes, o ya no entra', async () => {
  const escrows = new CountingEscrows();
  setHoldBackend(escrows);
  const buyer = await user('compra@test');
  const txId = await paidCall(buyer, 3, 2);
  await closePeriods();
  await fundHolds();
  await db.prepare('UPDATE earning_holds SET release_at = ?').run(nowS() - 1);
  const [released, claimed] = await Promise.allSettled([releaseDue(), createClaim(buyer, txId, 'El servicio no entregó lo que cobró.')]);
  const hold = (await db.prepare('SELECT status FROM earning_holds').get()) as { status: string };
  const claims = (await db.prepare('SELECT COUNT(*)::int AS n FROM claims').get()) as { n: number };
  if (claimed.status === 'fulfilled') {
    // El reclamo entró: la retención no puede haberse liberado por encima de él.
    assert.equal(claims.n, 1);
    assert.equal(hold.status, 'held');
    assert.equal(escrows.released.length, 0);
  } else {
    // La liberación ganó: no queda ningún reclamo colgado sobre dinero ya pagado.
    assert.equal(claims.n, 0);
    assert.equal(hold.status, 'released');
    assert.equal(released.status, 'fulfilled');
  }
});

/** Escrow cuyo `open` y `release` esperan una señal, para meter otra operación justo en medio. */
class GatedEscrows extends CountingEscrows {
  gate: Promise<void> = Promise.resolve();
  entered: Promise<void> = Promise.resolve();
  private enter: () => void = () => {};
  /** Devuelve la función que deja seguir a la operación que quedó esperando. */
  hold(): () => void {
    let open!: () => void;
    this.gate = new Promise((r) => (open = r));
    this.entered = new Promise((r) => (this.enter = r));
    return open;
  }
  async open(a: { engagementId: string }) {
    this.enter();
    await this.gate;
    return super.open(a);
  }
  async release(id: string) {
    this.enter();
    await this.gate;
    return super.release(id);
  }
}

test('una devolución resuelta mientras se fondea el escrow se recupera al liberar', async () => {
  const escrows = new GatedEscrows();
  setHoldBackend(escrows);
  const buyer = await user('compra@test');
  const admin = await user('admin@test');
  const txId = await paidCall(buyer, 3, 2);
  await paidCall(buyer, 2, 2);
  const claim = await createClaim(buyer, txId, 'El servicio no entregó lo que cobró.');
  await closePeriods();
  const go = escrows.hold();
  const funding = fundHolds();
  await escrows.entered; // el escrow ya se está abriendo por 5
  await resolveClaim(admin, claim.id, { decision: 'refund' });
  go();
  await funding;
  const h = (await db.prepare('SELECT status, amount, refund_due FROM earning_holds').get()) as { status: string; amount: number; refund_due: number };
  assert.deepEqual([h.status, Number(h.amount), Number(h.refund_due)], ['held', 5e7, 3e7]);
  await db.prepare('UPDATE earning_holds SET release_at = ?').run(nowS() - 1);
  await releaseDue();
  // El publicador cobra 2 y los 3 devueltos vuelven a la tesorería.
  assert.deepEqual(escrows.resolved.map(([, r, t]) => [r, t]), [[2e7, 3e7]]);
  assert.equal(escrows.released.length, 0);
});

test('un reclamo que llega con la liberación ya en curso no entra', async () => {
  const escrows = new GatedEscrows();
  setHoldBackend(escrows);
  const buyer = await user('compra@test');
  const txId = await paidCall(buyer, 3, 2);
  await closePeriods();
  await fundHolds();
  await db.prepare('UPDATE earning_holds SET release_at = ?').run(nowS() - 1);
  const go = escrows.hold();
  const releasing = releaseDue();
  await escrows.entered;
  await assert.rejects(createClaim(buyer, txId, 'El servicio no entregó lo que cobró.'), /plazo/);
  go();
  assert.equal(await releasing, 1);
  const claims = (await db.prepare('SELECT COUNT(*)::int AS n FROM claims').get()) as { n: number };
  assert.equal(claims.n, 0);
});

