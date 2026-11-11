// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

// El vendedor de prueba escucha en 127.0.0.1 por http: hay que abrir el guardián de URLs.
process.env.X402_ALLOW_HTTP = '1';
process.env.X402_ALLOW_PRIVATE = '1';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { SchemeNetworkClient } from '@x402/core/types';
import { USDC_TESTNET_ADDRESS } from '@x402/stellar';
import { db, initDb, pool } from '../src/db';
import { getBalance } from '../src/billing';
import { setX402Scheme, X402_NETWORK } from '../src/x402';
import {
  EXTERNAL_FEE_BPS,
  callExternal,
  externalFee,
  isExternalService,
  listExternal,
  listMyExternal,
  registerExternal,
  removeExternal,
} from '../src/external';

const fakeScheme: SchemeNetworkClient = {
  scheme: 'exact',
  async createPaymentPayload(x402Version) {
    return { x402Version, payload: { transaction: 'AAAA-fake-xdr' } };
  },
};

const PRICE = 100_000; // 0.01 USDC
let server: Server;
let base: string;
let seen: Array<{ method: string; url: string; body: string; paid: boolean }> = [];

before(async () => {
  await initDb();
  setX402Scheme(() => fakeScheme);
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      const paid = Boolean(req.headers['payment-signature']);
      seen.push({ method: req.method ?? '', url: req.url ?? '', body, paid });
      if (path === '/free') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"free":true}');
        return;
      }
      if (path === '/mpp') {
        res.writeHead(402, { 'www-authenticate': 'Payment id="abc", realm="test", method="stellar", intent="charge"' });
        res.end('{}');
        return;
      }
      if (!paid) {
        const required = {
          x402Version: 2,
          resource: { url: `${base}${req.url}`, description: 'test' },
          accepts: [
            {
              scheme: 'exact',
              network: X402_NETWORK,
              asset: USDC_TESTNET_ADDRESS,
              amount: String(PRICE),
              payTo: 'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX',
              maxTimeoutSeconds: 60,
              extra: {},
            },
          ],
        };
        res.writeHead(402, { 'content-type': 'application/json', 'payment-required': encodePaymentRequiredHeader(required as never) });
        res.end('{"error":"payment required"}');
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'payment-response': encodePaymentResponseHeader({
          success: true,
          transaction: 'deadbeef'.repeat(8),
          network: X402_NETWORK,
          payer: 'GPAYER',
        } as never),
      });
      res.end(JSON.stringify({ ok: true, url: req.url, body: body || undefined }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  setX402Scheme(null);
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  seen = [];
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

const weather = () => ({
  slug: 'clima',
  name: 'Clima por ciudad',
  description: 'Devuelve el clima actual de una ciudad.',
  url: `${base}/weather`,
  method: 'GET',
  params: [{ name: 'city', in: 'query', description: 'Nombre de la ciudad', required: true, example: 'Bogota' }],
});

test('listar un servicio externo: se le pide cotización y queda con precio más comisión', async () => {
  const pub = await createUser('pub@x.com');
  const svc = await registerExternal(pub, weather());
  assert.equal(svc.service, 'ext:clima');
  assert.equal(svc.kind, 'external');
  assert.equal(svc.protocol, 'x402');
  assert.equal(svc.payable, true);
  assert.equal(svc.priceBaseUnits, PRICE);
  assert.equal(svc.pricePerCall, PRICE + externalFee(PRICE));
  assert.equal(EXTERNAL_FEE_BPS, 500);
  assert.equal(externalFee(PRICE), 5_000);
  // La cotización se pidió con el valor de ejemplo y sin pagar.
  assert.deepEqual([seen.length, seen[0].url, seen[0].paid], [1, '/weather?city=Bogota', false]);
  assert.equal((await listMyExternal(pub)).length, 1);
  assert.equal((await listExternal()).length, 1);
});

test('no se lista una URL que no cobra, ni un identificador repetido o inválido', async () => {
  const pub = await createUser('pub@x.com');
  await assert.rejects(() => registerExternal(pub, { ...weather(), url: `${base}/free` }), /sin pedir pago/);
  await assert.rejects(() => registerExternal(pub, { ...weather(), slug: 'Mi Servicio' }), /identificador inválido/);
  await assert.rejects(() => registerExternal(pub, { ...weather(), description: 'corta' }), /descripción/);
  await assert.rejects(() => registerExternal(pub, { ...weather(), params: [{ name: 'a b' }] }), /parámetro inválido/);
  await registerExternal(pub, weather());
  await assert.rejects(() => registerExternal(pub, weather()), /ya existe/);
  assert.equal((await listExternal()).length, 1);
});

test('llamar un servicio externo: la API recibe su precio y el usuario paga precio más comisión', async () => {
  const pub = await createUser('pub@x.com');
  const buyer = await createUser('buyer@x.com', 1_000_000);
  await registerExternal(pub, weather());
  seen = [];
  const out = await callExternal({ userId: buyer, service: 'ext:clima', payload: { city: 'Cali' } });
  assert.equal(out.paid, true);
  assert.equal(out.cost.lamports, PRICE + 5_000);
  assert.equal(out.cost.feeLamports, 5_000);
  assert.equal(await getBalance(buyer), 1_000_000 - PRICE - 5_000);
  assert.deepEqual(seen.map((s) => [s.url, s.paid]), [
    ['/weather?city=Cali', false],
    ['/weather?city=Cali', true],
  ]);
  const tx = (await db.prepare(`SELECT service, amount_lamports, metadata FROM transactions WHERE user_id = ? AND type = 'call'`).get(buyer)) as {
    service: string;
    amount_lamports: number;
    metadata: string;
  };
  assert.equal(tx.service, 'ext:clima');
  assert.equal(Number(tx.amount_lamports), -(PRICE + 5_000));
  const meta = JSON.parse(tx.metadata);
  assert.deepEqual([meta.priceLamports, meta.feeLamports], [PRICE, 5_000]);
  // No genera ganancia retenida: a la API se le pagó directo.
  const earnings = (await db.prepare('SELECT COUNT(*)::int AS n FROM agent_earnings').get()) as { n: number };
  assert.equal(earnings.n, 0);
  assert.equal((await listExternal())[0].calls, 1);
});

test('los parámetros van donde se declararon, y los obligatorios se exigen antes de cobrar', async () => {
  const pub = await createUser('pub@x.com');
  const buyer = await createUser('buyer@x.com', 1_000_000);
  await registerExternal(pub, {
    slug: 'resumen',
    name: 'Resumen de texto',
    description: 'Resume un texto en el idioma pedido.',
    url: `${base}/summary`,
    method: 'POST',
    params: [
      { name: 'lang', in: 'query', description: 'Idioma', required: false, example: 'es' },
      { name: 'text', in: 'body', description: 'Texto a resumir', required: true, example: 'hola' },
    ],
  });
  await assert.rejects(() => callExternal({ userId: buyer, service: 'ext:resumen', payload: { lang: 'en' } }), /falta el parámetro 'text'/);
  assert.equal(await getBalance(buyer), 1_000_000);
  seen = [];
  await callExternal({ userId: buyer, service: 'resumen', payload: { lang: 'en', text: 'un texto largo', extra: 1 } });
  const paid = seen.find((s) => s.paid)!;
  assert.equal(paid.url, '/summary?lang=en');
  assert.deepEqual(JSON.parse(paid.body), { text: 'un texto largo', extra: 1 });
});

test('sin saldo no se llama, y el límite por llamada cuenta la comisión', async () => {
  const pub = await createUser('pub@x.com');
  const poor = await createUser('poor@x.com', PRICE); // alcanza el precio, no la comisión
  await registerExternal(pub, weather());
  await assert.rejects(() => callExternal({ userId: poor, service: 'ext:clima', payload: { city: 'Cali' } }), /saldo insuficiente/);
  assert.equal(await getBalance(poor), PRICE);
  const rich = await createUser('rich@x.com', 1_000_000);
  await assert.rejects(
    () => callExternal({ userId: rich, service: 'ext:clima', payload: { city: 'Cali' }, maxUsd: 0.01 }),
    /el límite es 0.01 USD/,
  );
  assert.equal(await getBalance(rich), 1_000_000);
});

test('un servicio que cobra con MPP se lista pero todavía no se puede llamar', async () => {
  const pub = await createUser('pub@x.com');
  const buyer = await createUser('buyer@x.com', 1_000_000);
  const svc = await registerExternal(pub, { ...weather(), slug: 'clima-mpp', url: `${base}/mpp`, params: [] });
  assert.deepEqual([svc.protocol, svc.payable, svc.pricePerCall], ['mpp', false, null]);
  await assert.rejects(() => callExternal({ userId: buyer, service: 'ext:clima-mpp' }), /MPP/);
  assert.equal(await getBalance(buyer), 1_000_000);
});

test('buscar en el catálogo y quitar un servicio propio', async () => {
  const pub = await createUser('pub@x.com');
  const other = await createUser('otro@x.com');
  await registerExternal(pub, weather());
  await registerExternal(pub, { ...weather(), slug: 'divisas', name: 'Tasas de cambio', description: 'Tasa de cambio entre dos monedas.', params: [] });
  assert.deepEqual((await listExternal('clima en mi ciudad')).map((s) => s.slug), ['clima']);
  assert.equal((await listExternal('nada que ver')).length, 0);
  assert.equal(isExternalService('ext:clima'), true);
  assert.equal(isExternalService('traductor'), false);
  await assert.rejects(() => removeExternal(other, 'clima'), /no es tuyo/);
  await removeExternal(pub, 'clima');
  assert.deepEqual((await listExternal()).map((s) => s.slug), ['divisas']);
  await assert.rejects(() => callExternal({ userId: other, service: 'ext:clima' }), /no encontrado/);
});
