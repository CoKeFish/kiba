// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import { setSpendChain, type SpendChain } from '../src/spend';
import {
  getTreasuryPayment,
  onTreasuryPaid,
  payFromTreasury,
  queueTreasuryPayment,
  runTreasuryPayments,
  sendTreasuryPayment,
} from '../src/treasury-pay';

const USDC = new Asset('USDC', Keypair.random().publicKey());
const TO = Keypair.random().publicKey();

/**
 * Red simulada. `mode` dice qué pasa al enviar:
 *   ok            entra y responde.
 *   lost-landed   entra, pero la respuesta se pierde.
 *   lost-dropped  no entra, y tampoco hay respuesta.
 *   down          ni siquiera se puede armar la transacción.
 */
let mode: 'ok' | 'lost-landed' | 'lost-dropped' | 'down' = 'ok';
/** Transacciones que entraron, por el hash de la de dentro. */
const landed = new Map<string, { to: string; amount: string }>();
let sends = 0;
let ttl = 600;
const fake = {
  passphrase: () => Networks.TESTNET,
  buildPayment: async (from: string, to: string, amount: bigint) => {
    if (mode === 'down') throw new Error('la red no responde');
    const units = amount.toString().padStart(8, '0');
    return new TransactionBuilder(new Account(from, String(sends + 1)), { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: to, asset: USDC, amount: `${units.slice(0, -7)}.${units.slice(-7)}` }))
      .setTimeout(ttl)
      .build()
      .toXDR();
  },
  submitSponsored: async (signedXdr: string) => {
    sends++;
    const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET) as Transaction;
    const op = tx.operations[0] as { destination: string; amount: string };
    const inner = tx.hash().toString('hex');
    if (mode === 'ok' || mode === 'lost-landed') landed.set(inner, { to: op.destination, amount: op.amount });
    if (mode !== 'ok') throw new Error('se cortó la conexión');
    return `fuera-${inner.slice(0, 8)}`;
  },
  txStatus: async (hash: string) => (landed.has(hash) ? { status: 'success' as const, hash: `fuera-${hash.slice(0, 8)}` } : { status: 'not_found' as const }),
} as unknown as SpendChain;

const paid: Array<[string, string, number, string | null]> = [];

before(async () => {
  await initDb();
  onTreasuryPaid('prueba', async (p) => {
    paid.push([p.kind, p.ref, p.amount, p.txHash]);
  });
});
after(async () => {
  setSpendChain(null);
  await pool.end();
});
beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  setSpendChain(fake);
  mode = 'ok';
  ttl = 600;
  sends = 0;
  landed.clear();
  paid.length = 0;
});

const pay = (ref: string, amount = 5_000_000) => payFromTreasury({ kind: 'prueba', ref, to: TO, amount });
const expire = () => db.prepare('UPDATE treasury_payments SET expires_at = ? ').run(Math.floor(Date.now() / 1000) - 3600);

test('un pago entra una vez, y pedirlo de nuevo con la misma referencia no lo repite', async () => {
  const p = await pay('a');
  assert.deepEqual([p.status, p.attempts, p.txHash?.startsWith('fuera-')], ['done', 1, true]);
  assert.match(p.hash ?? '', /^[0-9a-f]{64}$/);
  const again = await pay('a');
  assert.deepEqual([again.status, again.id], ['done', p.id]);
  assert.equal(sends, 1);
  assert.deepEqual([...landed.values()], [{ to: TO, amount: '0.5000000' }]);
  assert.deepEqual(paid, [['prueba', 'a', 5_000_000, p.txHash]]);
  await assert.rejects(() => queueTreasuryPayment({ kind: 'prueba', ref: 'x', to: TO, amount: 0 }), /inválido/);
});

test('el pago entró pero la respuesta se perdió: no se reenvía, se confirma por su hash', async () => {
  mode = 'lost-landed';
  const p = await pay('a');
  // Al perderse la respuesta se le pregunta a la red de inmediato: ya está.
  assert.equal(p.status, 'done');
  assert.equal(sends, 1);
  mode = 'ok';
  await runTreasuryPayments();
  await pay('a');
  assert.equal(sends, 1); // nunca un segundo envío
  assert.equal(paid.length, 1);
});

test('el pago no entró y la respuesta se perdió: se espera a que venza y recién entonces se arma otro', async () => {
  mode = 'lost-dropped';
  const p = await pay('a');
  assert.deepEqual([p.status, sends], ['sent', 1]);
  // Todavía podría entrar: mientras no venza, no se toca.
  mode = 'ok';
  await runTreasuryPayments();
  assert.equal((await getTreasuryPayment('prueba', 'a'))!.status, 'sent');
  assert.equal(sends, 1);
  assert.equal(paid.length, 0);
  // Vencida y sin aparecer en la red: ya no puede entrar. Se arma otra.
  await expire();
  await runTreasuryPayments(); // la da por no entrada y la vuelve a hacer
  const done = (await getTreasuryPayment('prueba', 'a'))!;
  assert.deepEqual([done.status, done.attempts, sends], ['done', 2, 2]);
  assert.equal(landed.size, 1); // en la red hay un solo pago
  assert.notEqual(done.hash, p.hash);
  assert.equal(paid.length, 1);
});

test('la primera transacción entra tarde, después de perderse la respuesta: se reconoce y no se duplica', async () => {
  mode = 'lost-dropped';
  const p = await pay('a');
  assert.equal(p.status, 'sent');
  // La red la incluye más tarde (dentro de su vigencia).
  landed.set(p.hash!, { to: TO, amount: '0.5000000' });
  mode = 'ok';
  await runTreasuryPayments();
  assert.deepEqual([(await getTreasuryPayment('prueba', 'a'))!.status, sends, landed.size], ['done', 1, 1]);
});

test('si no se puede ni armar, no hay nada en la red: se reintenta y, tras varios fallos, se deja para revisar', async () => {
  mode = 'down';
  const p = await pay('a');
  assert.deepEqual([p.status, p.hash, sends], ['failed', null, 0]);
  for (let i = 0; i < 6; i++) await runTreasuryPayments();
  const stuck = (await getTreasuryPayment('prueba', 'a'))!;
  assert.deepEqual([stuck.status, stuck.attempts, sends], ['stuck', 5, 0]);
  mode = 'ok';
  await runTreasuryPayments();
  assert.equal((await getTreasuryPayment('prueba', 'a'))!.status, 'stuck'); // no se toca solo
});

test('un pago a medio armar de un proceso que cayó se suelta y se hace', async () => {
  const id = await queueTreasuryPayment({ kind: 'prueba', ref: 'a', to: TO, amount: 5_000_000 });
  await db.prepare(`UPDATE treasury_payments SET status = 'sending', updated_at = updated_at - 1000 WHERE id = ?`).run(id);
  assert.equal((await sendTreasuryPayment(id)).status, 'sending'); // otro proceso lo tiene: no se toca
  assert.equal(sends, 0);
  await runTreasuryPayments(); // lo suelta
  await runTreasuryPayments(); // y lo hace
  assert.deepEqual([(await getTreasuryPayment('prueba', 'a'))!.status, sends], ['done', 1]);
});

test('dos pedidos a la vez del mismo pago arman una sola transacción', async () => {
  const id = await queueTreasuryPayment({ kind: 'prueba', ref: 'a', to: TO, amount: 5_000_000 });
  await Promise.all([sendTreasuryPayment(id), sendTreasuryPayment(id), sendTreasuryPayment(id)]);
  assert.deepEqual([sends, landed.size, paid.length], [1, 1, 1]);
});
