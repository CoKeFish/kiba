// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentPendingError, type ChainClient } from 'kiba-sdk';
import { db, initDb, pool } from '../src/db';
import { KIBA_PAY_REF, kibaPayEnabled, payForCall, reconcileKibaPays, setKibaPayClient } from '../src/kiba-pay';
import { settleAgent } from '../src/settlement';

/** Treasury simulada: registra los pagos y permite forzar rechazo o falta de confirmación. */
class FakeTreasury {
  readonly paymentsContractId = 'CTEST';
  pays: Array<{ receiver: string; amount: bigint; hash: string }> = [];
  mode: 'ok' | 'reject' | 'pending' = 'ok';
  statuses = new Map<string, 'success' | 'failed' | 'not_found'>();
  private n = 0;
  async payService(
    args: { receiver: string; amountBaseUnits: bigint },
    onSent?: (hash: string) => Promise<void> | void,
  ): Promise<string> {
    const hash = `h${++this.n}`;
    await onSent?.(hash);
    if (this.mode === 'reject') throw new Error('rechazada');
    if (this.mode === 'pending') throw new PaymentPendingError('sin confirmación', hash);
    this.pays.push({ receiver: args.receiver, amount: args.amountBaseUnits, hash });
    return hash;
  }
  async transactionStatus(hash: string) {
    return this.statuses.get(hash) ?? 'not_found';
  }
}

let chain: FakeTreasury;

before(async () => {
  await initDb();
});
after(async () => {
  setKibaPayClient(undefined);
  await pool.end();
});
beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  chain = new FakeTreasury();
  setKibaPayClient(chain as unknown as ChainClient);
});

async function publisher(service: string, autoSettle = true): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const u = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at, auto_settle)
       VALUES (?, 'x', '[]', ?, 0, ?, ?) RETURNING id`,
    )
    .run(`${service}@x.com`, `pk-${service}`, now, autoSettle ? 1 : 0);
  await db
    .prepare('INSERT INTO user_agents (service, user_id, created_at) VALUES (?, ?, ?)')
    .run(service, Number(u.lastInsertRowid), now);
}

async function earning(service: string, amount: number, escrowId: string | null = null): Promise<number> {
  const info = await db
    .prepare(
      `INSERT INTO agent_earnings (service, pay_to, amount_lamports, escrow_id, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(service, `G-${service}`, amount, escrowId, Math.floor(Date.now() / 1000));
  return Number(info.lastInsertRowid);
}

const pendingEarnings = async (service: string) =>
  Number(
    ((await db
      .prepare('SELECT COUNT(*) AS n FROM agent_earnings WHERE service = ? AND settlement_id IS NULL')
      .get(service)) as { n: number }).n,
  );
const settlementsOf = async (service: string) =>
  (await db
    .prepare('SELECT status, amount_lamports, escrow_id, signature FROM settlements WHERE service = ? ORDER BY id')
    .all(service)) as Array<{ status: string; amount_lamports: number; escrow_id: string; signature: string | null }>;

test('con el contrato de Kiba configurado se activa', () => {
  assert.equal(kibaPayEnabled(), true);
  setKibaPayClient(null);
  assert.equal(kibaPayEnabled(), false);
});

test('pago por llamada: una tx al servicio y la ganancia queda liquidada', async () => {
  await publisher('svc');
  const id = await earning('svc', 5000);
  const r = await payForCall({ service: 'svc', payTo: 'G-svc', lamports: 5000, earningId: id });
  assert.equal(r.txHash, 'h1');
  assert.deepEqual(chain.pays, [{ receiver: 'G-svc', amount: 5000n, hash: 'h1' }]);
  const [s] = await settlementsOf('svc');
  assert.equal(s.status, 'settled');
  assert.equal(s.escrow_id, KIBA_PAY_REF);
  assert.equal(s.signature, 'h1');
  assert.equal(await pendingEarnings('svc'), 0);
});

test('pago por llamada también sin liquidación automática (como el fondeo por llamada de TW)', async () => {
  await publisher('manual', false);
  const id = await earning('manual', 5000);
  assert.equal((await payForCall({ service: 'manual', payTo: 'G-manual', lamports: 5000, earningId: id })).txHash, 'h1');
  assert.equal(await pendingEarnings('manual'), 0);
});

test('pago rechazado: la ganancia vuelve a quedar pendiente', async () => {
  await publisher('svc');
  const id = await earning('svc', 5000);
  chain.mode = 'reject';
  assert.deepEqual(await payForCall({ service: 'svc', payTo: 'G-svc', lamports: 5000, earningId: id }), {});
  assert.equal((await settlementsOf('svc'))[0].status, 'failed');
  assert.equal(await pendingEarnings('svc'), 1);
});

test('sin confirmación: no se repite; el lote no la vuelve a pagar y la reconciliación decide', async () => {
  await publisher('svc');
  const id = await earning('svc', 5000);
  chain.mode = 'pending';
  assert.deepEqual(await payForCall({ service: 'svc', payTo: 'G-svc', lamports: 5000, earningId: id }), {});
  assert.equal((await settlementsOf('svc'))[0].status, 'pending');
  assert.equal(await pendingEarnings('svc'), 0, 'la ganancia sigue reservada');

  // Un lote mientras tanto no la toca (sigue reservada por el pago pendiente).
  chain.mode = 'ok';
  await earning('svc', 2e7);
  await settleAgent('svc');
  assert.deepEqual(chain.pays.map((p) => p.amount), [20_000_000n], 'el lote paga solo lo nuevo');

  // La tx sí entró: reconciliar la marca liquidada sin reenviar.
  chain.statuses.set('h1', 'success');
  await db.prepare('UPDATE settlements SET created_at = created_at - 600').run();
  assert.equal(await reconcileKibaPays(), 1);
  assert.equal((await settlementsOf('svc'))[0].status, 'settled');
  assert.equal(chain.pays.length, 1);
});

test('sin confirmación y la tx no entró: la reconciliación la devuelve a pendiente', async () => {
  await publisher('svc');
  const id = await earning('svc', 5000);
  chain.mode = 'pending';
  await payForCall({ service: 'svc', payTo: 'G-svc', lamports: 5000, earningId: id });
  await db.prepare('UPDATE settlements SET created_at = created_at - 600').run();
  await reconcileKibaPays();
  assert.equal((await settlementsOf('svc'))[0].status, 'failed');
  assert.equal(await pendingEarnings('svc'), 1);
});

test('la reconciliación no toca pagos recientes (su tx aún puede entrar)', async () => {
  await publisher('svc');
  const id = await earning('svc', 5000);
  chain.mode = 'pending';
  await payForCall({ service: 'svc', payTo: 'G-svc', lamports: 5000, earningId: id });
  assert.equal(await reconcileKibaPays(), 0);
  assert.equal((await settlementsOf('svc'))[0].status, 'pending');
});

test('lote: paga lo acumulado en una sola tx', async () => {
  await publisher('svc');
  for (let i = 0; i < 4; i++) await earning('svc', 5_000_000);
  const r = await settleAgent('svc');
  assert.equal(r.status, 'settled');
  assert.deepEqual(chain.pays.map((p) => p.amount), [20_000_000n]);
  assert.equal(await pendingEarnings('svc'), 0);
});

test('lote: por debajo del mínimo no paga', async () => {
  await publisher('svc');
  await earning('svc', 5000);
  assert.equal((await settleAgent('svc')).status, 'skipped');
  assert.equal(chain.pays.length, 0);
});

test('una ganancia ya tomada por un lote no se paga otra vez por llamada', async () => {
  await publisher('svc');
  const id = await earning('svc', 2e7);
  await settleAgent('svc');
  assert.deepEqual(await payForCall({ service: 'svc', payTo: 'G-svc', lamports: 2e7, earningId: id }), {});
  assert.equal(chain.pays.length, 1);
});
