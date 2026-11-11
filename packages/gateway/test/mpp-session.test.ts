// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { Challenge, Credential, MppxServer, Store, stellarServerCharge } from '@kiba/mpp';
import { db, initDb, pool } from '../src/db';
import { MPP_NETWORK, mppCurrency, mppTreasury } from '../src/mpp';
import { handleMppSell, setMppSellDeps } from '../src/mpp-sell';
import {
  getSession,
  prepareSessionOpen,
  registerSession,
  runMppSessionJob,
  setMppSessionChain,
  setMppSessionChargerFactory,
  type SessionChain,
} from '../src/mpp-session';

const FUNDER = Keypair.random().publicKey();
const COMMITMENT = Keypair.random().publicKey();
const CHANNEL = 'C' + 'A'.repeat(55);
const OTHER = 'C' + 'B'.repeat(55);
const SIG = 'ab'.repeat(64);

type Described = Awaited<ReturnType<SessionChain['describe']>>;
let onChain: Described;
let settles: Array<[string, bigint, string]> = [];
let failSettle = false;
const fakeChain: SessionChain = {
  describe: async () => onChain,
  buildOpen: async (a) => `xdr:${a.owner}:${a.amount}:${a.commitmentKey.length}:${a.salt.length}`,
  openedChannel: async () => CHANNEL,
  settle: async (channel, amount, sig) => {
    if (failSettle) throw new Error('la red no responde');
    settles.push([channel, amount, sig.toString('hex')]);
    return `tx-cobro-${settles.length}`;
  },
};
const good = (): Described => ({
  genuine: true,
  from: FUNDER,
  to: mppTreasury().publicKey(),
  token: mppCurrency(),
  commitmentKey: COMMITMENT,
  waitLedgers: 720,
  closeEffective: null,
  balance: 50_000_000n,
});

let kiba: Server;
let base: string;
let failService = false;
const refunds: Array<[string, number]> = [];
const refund = async (to: string, lamports: number) => {
  refunds.push([to, lamports]);
  return `tx-devolucion-${refunds.length}`;
};

before(async () => {
  await initDb();
  const app = express();
  app.use(express.json());
  app.all('/mpp/:service', (req, res) => void handleMppSell(req, res));
  kiba = createServer(app);
  await new Promise<void>((r) => kiba.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(kiba.address() as AddressInfo).port}`;
});

after(async () => {
  setMppSessionChain(null);
  setMppSessionChargerFactory(null);
  setMppSellDeps(null);
  await new Promise<void>((r) => kiba.close(() => r()));
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  onChain = good();
  settles = [];
  failSettle = false;
  failService = false;
  refunds.length = 0;
  setMppSessionChain(fakeChain);
  // Comprobación de firmas simulada: 402 sin firma; con ella, aceptada.
  setMppSessionChargerFactory(() => ({
    charge: () => async (request) =>
      request.headers.get('authorization')
        ? { status: 200, withReceipt: (r: Response) => r }
        : {
            status: 402,
            challenge: new Response('{}', {
              status: 402,
              headers: { 'www-authenticate': 'Payment id="x", realm="kiba", method="stellar", intent="channel", request="e30"' },
            }),
          },
  }));
  setMppSellDeps({
    quote: async () => ({ lamports: 300_000, payTo: 'GPUBLICADOR' }), // 0,03 USDC
    serve: async () => {
      if (failService) throw new Error('el servicio no responde');
      return { ok: true };
    },
  });
});

/** Una firma de sesión con el formato real: «de este canal ya debo `cumulative` en total». */
async function voucher(cumulative: number): Promise<string> {
  const mppx = MppxServer.create({
    secretKey: 'k'.repeat(40),
    realm: 'kiba.test',
    methods: [stellarServerCharge({ recipient: FUNDER, currency: mppCurrency(), network: MPP_NETWORK, store: Store.memory() })],
  }) as any;
  const r = await mppx.charge({ amount: '0.03' })(new Request('http://kiba.test/mpp/traductor'));
  return Credential.serialize(
    Credential.from({ challenge: Challenge.fromResponse(r.challenge), payload: { action: 'voucher', amount: String(cumulative), signature: SIG } } as never),
  );
}
const call = (authorization?: string, channel = CHANNEL) =>
  fetch(`${base}/mpp/traductor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mpp-channel': channel, ...(authorization ? { authorization } : {}) },
    body: '{"text":"hello"}',
  });
const row = async () => (await db.prepare('SELECT * FROM mpp_sessions WHERE channel = ?').get(CHANNEL)) as Record<string, unknown>;

test('solo se registra un canal auténtico, que le paga a Kiba, con USDC, abierto y con saldo', async () => {
  const cases: Array<[Partial<Described>, RegExp]> = [
    [{ genuine: false }, /no es un canal de pago/],
    [{ to: Keypair.random().publicKey() }, /no le paga a Kiba/],
    [{ token: 'C' + 'X'.repeat(55) }, /no guarda USDC/],
    [{ closeEffective: 123 }, /cierre pedido/],
    [{ balance: 0n }, /no tiene saldo/],
  ];
  for (const [patch, error] of cases) {
    onChain = { ...good(), ...patch };
    await assert.rejects(() => registerSession({ channel: CHANNEL }), error);
  }
  assert.equal(await getSession(CHANNEL), null);
  await assert.rejects(() => registerSession({ channel: 'no-es-un-canal' }), /indica el canal/);

  onChain = good();
  const s = await registerSession({ openTx: 'hash-de-la-apertura' });
  assert.deepEqual([s.channel, s.funder, s.status, s.cumulativeBaseUnits], [CHANNEL, FUNDER, 'open', 0]);
  assert.equal((await row()).commitment_key, COMMITMENT);
  // Registrarlo otra vez devuelve el mismo, sin volver a mirar la red.
  onChain = { ...good(), genuine: false };
  assert.equal((await registerSession({ channel: CHANNEL })).channel, CHANNEL);
});

test('armar la apertura del canal: valida la cuenta, la clave de firmas y el depósito mínimo', async () => {
  await assert.rejects(() => prepareSessionOpen({ owner: 'x', commitmentKey: COMMITMENT, amount: 20_000_000 }), /owner/);
  await assert.rejects(() => prepareSessionOpen({ owner: FUNDER, commitmentKey: 'zz', amount: 20_000_000 }), /commitmentKey/);
  await assert.rejects(() => prepareSessionOpen({ owner: FUNDER, commitmentKey: COMMITMENT, amount: 1 }), /depósito mínimo/);
  const p = await prepareSessionOpen({ owner: FUNDER, commitmentKey: COMMITMENT, amount: 20_000_000 });
  assert.equal(p.xdr, `xdr:${FUNDER}:20000000:32:32`);
  const hex = await prepareSessionOpen({ owner: FUNDER, commitmentKey: 'ab'.repeat(32), amount: 20_000_000 });
  assert.match(hex.xdr, /:32:32$/);
});

test('llamadas por sesión: cada una es una firma, se anota el total y la ganancia del publicador', async () => {
  assert.equal((await call(undefined, OTHER)).status, 404); // canal sin registrar
  await registerSession({ channel: CHANNEL });
  const first = await call();
  assert.equal(first.status, 402);
  assert.match(first.headers.get('www-authenticate') ?? '', /intent="channel"/);

  const one = await call(await voucher(300_000));
  assert.equal(one.status, 200);
  const body = (await one.json()) as { payment: { channel: string; cumulativeBaseUnits: number; reference: string } };
  assert.deepEqual([body.payment.channel, body.payment.cumulativeBaseUnits], [CHANNEL, 300_000]);
  assert.equal((await call(await voucher(600_000))).status, 200);
  assert.equal((await call(await voucher(900_000))).status, 200);

  const s = await row();
  assert.deepEqual([Number(s.cumulative), s.signature, Number(s.settled)], [900_000, SIG, 0]);
  const earnings = (await db.prepare('SELECT COUNT(*)::int AS n, SUM(amount_lamports)::bigint AS total FROM agent_earnings').get()) as { n: number; total: number };
  assert.deepEqual([earnings.n, Number(earnings.total)], [3, 900_000]);
  const pays = (await db.prepare('SELECT payer, channel, voucher, status FROM mpp_payments ORDER BY id').all()) as Array<Record<string, unknown>>;
  assert.deepEqual(pays.map((p) => [p.payer, p.channel, Number(p.voucher), p.status]), [
    [FUNDER, CHANNEL, 300_000, 'served'],
    [FUNDER, CHANNEL, 600_000, 'served'],
    [FUNDER, CHANNEL, 900_000, 'served'],
  ]);
  assert.equal(settles.length, 0); // nada en la red todavía
});

test('una llamada que no cabe en lo que queda del canal no se sirve', async () => {
  onChain = { ...good(), balance: 500_000n };
  await registerSession({ channel: CHANNEL });
  assert.equal((await getSession(CHANNEL))!.availableBaseUnits, 500_000);
  assert.equal((await call(await voucher(300_000))).status, 200);
  assert.equal((await getSession(CHANNEL))!.availableBaseUnits, 200_000);
  // Quedan 0,02 y la llamada cuesta 0,03.
  const r = await call(await voucher(600_000));
  assert.equal(r.status, 409);
  assert.match(((await r.json()) as { error: string }).error, /le quedan 0\.0200 USD/);
  assert.equal(Number((await row()).cumulative), 300_000);
  const n = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
  assert.equal(n.n, 1);
});

test('Kiba cobra al canal por tandas, con la última firma, y no cobra dos veces', async () => {
  await registerSession({ channel: CHANNEL });
  await call(await voucher(300_000));
  // Poco y reciente: todavía no se cobra.
  assert.equal(await runMppSessionJob(refund), 0);
  assert.equal(settles.length, 0);
  // Pasado el tiempo de espera, sí.
  await db.prepare('UPDATE mpp_sessions SET last_voucher_at = last_voucher_at - 100000').run();
  assert.equal(await runMppSessionJob(refund), 1);
  assert.deepEqual(settles, [[CHANNEL, 300_000n, SIG]]);
  assert.equal(Number((await row()).settled), 300_000);
  assert.equal(await runMppSessionJob(refund), 0);

  // Al pasar el umbral se cobra sin esperar.
  await call(await voucher(2_000_000));
  assert.equal(await runMppSessionJob(refund), 1);
  assert.deepEqual(settles[1], [CHANNEL, 2_000_000n, SIG]);

  // Si la red falla, lo pendiente sigue pendiente y se reintenta.
  await call(await voucher(4_000_000));
  failSettle = true;
  assert.equal(await runMppSessionJob(refund), 0);
  assert.equal(Number((await row()).settled), 2_000_000);
  failSettle = false;
  assert.equal(await runMppSessionJob(refund), 1);
  assert.equal(Number((await row()).settled), 4_000_000);
});

test('si el servicio falla en una llamada por sesión, se devuelve después de cobrarle al canal', async () => {
  await registerSession({ channel: CHANNEL });
  failService = true;
  const r = await call(await voucher(300_000));
  assert.equal(r.status, 502);
  assert.deepEqual(((await r.json()) as { refund: unknown }).refund, { status: 'pending' });
  const n = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
  assert.equal(n.n, 0);
  assert.equal(refunds.length, 0); // Kiba todavía no ha cobrado esa firma

  await runMppSessionJob(refund, { force: true });
  assert.deepEqual(settles, [[CHANNEL, 300_000n, SIG]]);
  assert.deepEqual(refunds, [[FUNDER, 300_000]]);
  const pay = (await db.prepare('SELECT status, refund_tx FROM mpp_payments').get()) as Record<string, unknown>;
  assert.deepEqual([pay.status, pay.refund_tx], ['refunded', 'tx-devolucion-1']);
  await runMppSessionJob(refund, { force: true });
  assert.equal(refunds.length, 1); // una sola vez
});

test('si el agente pide cerrar el canal, Kiba cobra de inmediato y el canal deja de aceptar llamadas', async () => {
  await registerSession({ channel: CHANNEL });
  await call(await voucher(300_000));
  onChain = { ...good(), closeEffective: 999_999 };
  assert.equal(await runMppSessionJob(refund), 1);
  assert.deepEqual(settles, [[CHANNEL, 300_000n, SIG]]);
  assert.equal((await row()).status, 'closed');
  const again = await call(await voucher(600_000));
  assert.equal(again.status, 409);
  assert.equal(Number((await row()).cumulative), 300_000);
});
