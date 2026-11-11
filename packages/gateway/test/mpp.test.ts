// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

// Los servidores de prueba escuchan en 127.0.0.1 por http: hay que abrir el guardián de URLs.
process.env.X402_ALLOW_HTTP = '1';
process.env.X402_ALLOW_PRIVATE = '1';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { Challenge, Credential, Receipt } from 'mppx';
import { Mppx as MppxServer, Store } from 'mppx/server';
import { charge as stellarServerCharge } from '@stellar/mpp/charge/server';
import { db, initDb, pool } from '../src/db';
import { getBalance } from '../src/billing';
import { callX402Url, probePaidUrl } from '../src/x402';
import { MPP_NETWORK, mppCurrency, setMppPayer } from '../src/mpp';
import { handleMppSell, pgMppStore, setMppCharger, setMppRefunder, setMppSellDeps, type MppCharger } from '../src/mpp-sell';
import { callExternal, registerExternal } from '../src/external';

const SELLER = Keypair.random().publicKey();
const PAYER = Keypair.random().publicKey();
const XLM_TESTNET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const receipt = (reference: string) =>
  Receipt.serialize(Receipt.from({ method: 'stellar', reference, status: 'success', timestamp: new Date().toISOString() } as never));

/** Un vendedor de MPP de verdad para emitir retos; el pago en la red se simula. */
function challengeFor(amount: string, currency: string) {
  const mppx = MppxServer.create({
    secretKey: 'k'.repeat(40),
    realm: 'vendedor.test',
    methods: [stellarServerCharge({ recipient: SELLER, currency, network: MPP_NETWORK, store: Store.memory() })],
  }) as unknown as MppCharger;
  return mppx.charge({ amount, description: 'prueba' });
}

let seller: Server;
let sellerBase: string;
let sellerSeen: Array<{ url: string; authorization?: string }> = [];
let sellerMode: 'ok' | 'reject' = 'ok';
let sellerCurrency = '';

let kiba: Server;
let kibaBase: string;

before(async () => {
  await initDb();
  sellerCurrency = mppCurrency();
  seller = createServer((req, res) => {
    void (async () => {
      const authorization = req.headers.authorization;
      sellerSeen.push({ url: req.url ?? '', authorization });
      if (!authorization || sellerMode === 'reject') {
        const r = await challengeFor('0.01', sellerCurrency)(new Request(`${sellerBase}${req.url}`));
        assert.equal(r.status, 402);
        if (r.status !== 402) return;
        res.writeHead(402, { 'www-authenticate': r.challenge.headers.get('www-authenticate')!, 'content-type': 'application/json' });
        res.end(await r.challenge.text());
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'payment-receipt': receipt('feedbeef'.repeat(8)) });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    })();
  });
  await new Promise<void>((r) => seller.listen(0, '127.0.0.1', r));
  sellerBase = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json());
  app.all('/mpp/:service', (req, res) => void handleMppSell(req, res));
  kiba = createServer(app);
  await new Promise<void>((r) => kiba.listen(0, '127.0.0.1', r));
  kibaBase = `http://127.0.0.1:${(kiba.address() as AddressInfo).port}`;
});

after(async () => {
  setMppPayer(null);
  setMppCharger(null);
  setMppSellDeps(null);
  setMppRefunder(null);
  await new Promise<void>((r) => seller.close(() => r()));
  await new Promise<void>((r) => kiba.close(() => r()));
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  sellerSeen = [];
  sellerMode = 'ok';
  sellerCurrency = mppCurrency();
  setMppPayer(async () => 'Payment credencial-de-prueba');
});

async function createUser(email: string, credits = 0): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, 'x', '[]', ?, ?, ?) RETURNING id`,
    )
    .run(email, `pk-${email}`, credits, Math.floor(Date.now() / 1000));
  return Number(r.lastInsertRowid);
}

// ─── Comprador ──────────────────────────────────────────────────────────────

test('call_url reconoce el reto de MPP, cobra al usuario y paga', async () => {
  const user = await createUser('u@x.com', 1_000_000);
  const out = await callX402Url({ userId: user, url: `${sellerBase}/datos?x=1` });
  assert.equal(out.paid, true);
  assert.equal(out.protocol, 'mpp');
  assert.equal(out.cost.lamports, 100_000); // 0,01 USDC
  assert.equal(out.payTo, SELLER);
  assert.equal(out.txHash, 'feedbeef'.repeat(8));
  assert.deepEqual(out.result, { ok: true, url: '/datos?x=1' });
  assert.equal(await getBalance(user), 900_000);
  assert.deepEqual(sellerSeen.map((s) => s.authorization), [undefined, 'Payment credencial-de-prueba']);
  const tx = (await db.prepare(`SELECT signature, metadata FROM transactions WHERE user_id = ? AND type = 'call'`).get(user)) as {
    signature: string;
    metadata: string;
  };
  assert.equal(tx.signature, 'feedbeef'.repeat(8));
  assert.equal(JSON.parse(tx.metadata).mode, 'mpp');
});

test('si la API rechaza el pago de MPP, el usuario recupera su saldo', async () => {
  const user = await createUser('u@x.com', 1_000_000);
  sellerMode = 'reject';
  await assert.rejects(() => callX402Url({ userId: user, url: `${sellerBase}/datos` }), /rechazó la llamada pagada \(402\)/);
  assert.equal(await getBalance(user), 1_000_000);
});

test('un reto de MPP en otra moneda no se paga ni se cobra', async () => {
  const user = await createUser('u@x.com', 1_000_000);
  sellerCurrency = XLM_TESTNET;
  await assert.rejects(() => callX402Url({ userId: user, url: `${sellerBase}/datos` }), /no acepta USDC/);
  assert.equal(await getBalance(user), 1_000_000);
  assert.equal(sellerSeen.length, 1);
  assert.deepEqual(await probePaidUrl(`${sellerBase}/datos`), { kind: 'mpp' });
});

test('un servicio externo que cobra con MPP se lista con precio y se puede llamar', async () => {
  const pub = await createUser('pub@x.com');
  const buyer = await createUser('buyer@x.com', 1_000_000);
  const svc = await registerExternal(pub, {
    slug: 'datos-mpp',
    name: 'Datos por MPP',
    description: 'Devuelve datos y cobra con MPP.',
    url: `${sellerBase}/datos`,
  });
  assert.deepEqual([svc.protocol, svc.payable, svc.priceBaseUnits, svc.pricePerCall], ['mpp', true, 100_000, 105_000]);
  const out = await callExternal({ userId: buyer, service: 'ext:datos-mpp' });
  assert.deepEqual([out.protocol, out.cost.lamports, out.cost.feeLamports], ['mpp', 105_000, 5_000]);
  assert.equal(await getBalance(buyer), 895_000);
});

// ─── Vendedor ───────────────────────────────────────────────────────────────

test('el almacén de pruebas de pago en Postgres actualiza de forma atómica', async () => {
  const store = pgMppStore() as unknown as {
    get(k: string): Promise<unknown>;
    put(k: string, v: unknown): Promise<void>;
    delete(k: string): Promise<void>;
    update<R>(k: string, fn: (cur: unknown) => { op: 'set'; value: unknown; result: R } | { op: 'noop'; result: R } | { op: 'delete'; result: R }): Promise<R>;
  };
  assert.equal(await store.get('a'), null);
  await store.put('a', { n: 1 });
  assert.deepEqual(await store.get('a'), { n: 1 });
  // 20 incrementos a la vez: ninguno se pierde.
  await store.put('contador', { n: 0 });
  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.update('contador', (cur) => ({ op: 'set', value: { n: (cur as { n: number }).n + 1 }, result: null })),
    ),
  );
  assert.deepEqual(await store.get('contador'), { n: 20 });
  // "Usar una vez": de 10 intentos a la vez sobre la misma clave, solo uno gana.
  const wins = await Promise.all(
    Array.from({ length: 10 }, () =>
      store.update('pago:abc', (cur) => (cur ? { op: 'noop', result: false } : { op: 'set', value: { used: true }, result: true })),
    ),
  );
  assert.equal(wins.filter(Boolean).length, 1);
  assert.equal(await store.update('a', () => ({ op: 'delete', result: 'borrado' })), 'borrado');
  assert.equal(await store.get('a'), null);
  await store.delete('contador');
  assert.equal(await store.get('contador'), null);
});

/** Cobro simulado: 402 sin prueba de pago; con ella, pago aceptado y recibo. */
function fakeCharger(asked: Array<{ amount: string; meta?: Record<string, string> }>): MppCharger {
  return {
    charge: (options) => async (request) => {
      asked.push({ amount: options.amount, meta: options.meta });
      if (!request.headers.get('authorization')) {
        return {
          status: 402,
          challenge: new Response('{"title":"Payment Required"}', {
            status: 402,
            headers: { 'www-authenticate': 'Payment id="x", realm="kiba", method="stellar", intent="charge", request="e30"' },
          }),
        };
      }
      return {
        status: 200,
        withReceipt: (r: Response) => {
          const headers = new Headers(r.headers);
          headers.set('payment-receipt', receipt('cafe'.repeat(16)));
          return new Response(r.body, { status: r.status, headers });
        },
      };
    },
  };
}

/** Una prueba de pago con el formato real, que nombra a quien pagó. */
async function credentialOf(payer: string): Promise<string> {
  const r = await challengeFor('0.25', mppCurrency())(new Request('http://kiba.test/mpp/traductor'));
  assert.equal(r.status, 402);
  if (r.status !== 402) throw new Error('sin reto');
  const challenge = Challenge.fromResponse(r.challenge);
  return Credential.serialize(
    Credential.from({ challenge, payload: { type: 'hash', hash: 'ab'.repeat(32) }, source: `did:pkh:stellar:testnet:${payer}` } as never),
  );
}

test('vender por MPP: sin pago responde 402; con pago sirve y anota la ganancia del publicador', async () => {
  const asked: Array<{ amount: string; meta?: Record<string, string> }> = [];
  const served: unknown[] = [];
  setMppCharger(fakeCharger(asked));
  setMppSellDeps({
    quote: async (service, payload) => {
      if (service !== 'traductor') throw new Error('service not found');
      return { lamports: 2_500_000, payTo: 'GPUBLICADOR', ctx: { payload } };
    },
    serve: async (_service, payload) => {
      served.push(payload);
      return { translated: 'hola' };
    },
  });

  const first = await fetch(`${kibaBase}/mpp/traductor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hello"}' });
  assert.equal(first.status, 402);
  assert.match(first.headers.get('www-authenticate') ?? '', /^Payment /);
  assert.equal(served.length, 0);
  assert.deepEqual(asked[0], { amount: '0.25', meta: { service: 'traductor' } });

  const paid = await fetch(`${kibaBase}/mpp/traductor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await credentialOf(PAYER) },
    body: '{"text":"hello"}',
  });
  assert.equal(paid.status, 200);
  assert.equal(Receipt.deserialize(paid.headers.get('payment-receipt')!).reference, 'cafe'.repeat(16));
  const body = (await paid.json()) as { result: unknown; cost: { baseUnits: number }; payment: { reference: string } };
  assert.deepEqual(body.result, { translated: 'hola' });
  assert.equal(body.cost.baseUnits, 2_500_000);
  assert.deepEqual(served, [{ text: 'hello' }]);

  const earning = (await db.prepare('SELECT service, pay_to, amount_lamports, user_id, hold_id FROM agent_earnings').get()) as Record<string, unknown>;
  assert.deepEqual([earning.service, earning.pay_to, Number(earning.amount_lamports), earning.user_id, earning.hold_id], ['traductor', 'GPUBLICADOR', 2_500_000, null, null]);
  const pay = (await db.prepare('SELECT * FROM mpp_payments').get()) as Record<string, unknown>;
  assert.deepEqual([pay.status, pay.payer, Number(pay.amount), pay.reference], ['served', PAYER, 2_500_000, 'cafe'.repeat(16)]);
});

test('vender por MPP: si el servicio falla después del pago, se le devuelve a quien pagó', async () => {
  const refunds: Array<[string, number]> = [];
  setMppCharger(fakeCharger([]));
  setMppRefunder(async (to, lamports) => {
    refunds.push([to, lamports]);
    return 'tx-devolucion';
  });
  setMppSellDeps({
    quote: async () => ({ lamports: 1_000_000, payTo: 'GPUBLICADOR' }),
    serve: async () => {
      throw new Error('el servicio no responde');
    },
  });
  const r = await fetch(`${kibaBase}/mpp/traductor`, { method: 'POST', headers: { authorization: await credentialOf(PAYER) } });
  assert.equal(r.status, 502);
  const body = (await r.json()) as { error: string; refund: { status: string; transaction?: string } };
  assert.match(body.error, /falló después del pago/);
  assert.deepEqual(body.refund, { status: 'refunded', transaction: 'tx-devolucion' });
  assert.deepEqual(refunds, [[PAYER, 1_000_000]]);
  const n = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
  assert.equal(n.n, 0);
  const pay = (await db.prepare('SELECT status, refund_tx FROM mpp_payments').get()) as Record<string, unknown>;
  assert.deepEqual([pay.status, pay.refund_tx], ['refunded', 'tx-devolucion']);
});

test('vender por MPP: un servicio que no existe responde 404 sin cobrar', async () => {
  const asked: Array<{ amount: string }> = [];
  setMppCharger(fakeCharger(asked));
  setMppSellDeps({
    quote: async () => {
      throw new Error('service not found');
    },
    serve: async () => null,
  });
  const r = await fetch(`${kibaBase}/mpp/no-existe`, { method: 'POST' });
  assert.equal(r.status, 404);
  assert.equal(asked.length, 0);
});
