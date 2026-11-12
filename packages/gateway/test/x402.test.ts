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
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';
import { USDC_TESTNET_ADDRESS } from '@x402/stellar';
import { db, initDb, pool } from '../src/db';
import { getBalance } from '../src/billing';
import { assertAllowedUrl, callX402Url, pickStellarRequirements, setX402Scheme, X402_NETWORK } from '../src/x402';

/** Esquema de pago simulado: firma "algo" sin tocar la cadena y anota qué se le pidió. */
const signed: PaymentRequirements[] = [];
const fakeScheme: SchemeNetworkClient = {
  scheme: 'exact',
  async createPaymentPayload(x402Version, requirements) {
    signed.push(requirements);
    return { x402Version, payload: { transaction: 'AAAA-fake-xdr' } };
  },
};

const PAY_TO = 'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX';

interface SellerBehaviour {
  /** Precio en unidades base (USDC 7 decimales). */
  amount: string;
  network?: string;
  asset?: string;
  /** Qué responde cuando llega el pago: 200 liquidado, 500 sin liquidar, o 402 otra vez. */
  onPaid?: 'settle' | 'fail' | 'free';
  free?: boolean;
}

let server: Server;
let base: string;
let behaviour: SellerBehaviour;
let received: Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];

function requirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: (behaviour.network ?? X402_NETWORK) as PaymentRequirements['network'],
    asset: behaviour.asset ?? USDC_TESTNET_ADDRESS,
    amount: behaviour.amount,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

before(async () => {
  await initDb();
  setX402Scheme(() => fakeScheme);
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      if (behaviour.free) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ free: true, echo: body || undefined }));
        return;
      }
      const sig = req.headers['payment-signature'];
      if (!sig) {
        const required = {
          x402Version: 2,
          resource: { url: `${base}${req.url}`, description: 'test' },
          accepts: [requirements()],
        };
        res.writeHead(402, { 'content-type': 'application/json', 'payment-required': encodePaymentRequiredHeader(required) });
        res.end(JSON.stringify({ error: 'payment required' }));
        return;
      }
      const payload = decodePaymentSignatureHeader(String(sig));
      if (behaviour.onPaid === 'fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'boom' }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'payment-response': encodePaymentResponseHeader({
          success: true,
          transaction: 'deadbeef'.repeat(8),
          network: payload.accepted.network,
          payer: 'GPAYER',
        }),
      });
      res.end(JSON.stringify({ ok: true, paidFor: req.url, payload: payload.payload }));
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
  received = [];
  signed.length = 0;
  behaviour = { amount: '100000', onPaid: 'settle' }; // 0.01 USDC
});

async function user(balanceLamports: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const u = await db
    .prepare(
      `INSERT INTO users (email, password_hash, balance_lamports, created_at)
       VALUES (?, 'x', ?, ?) RETURNING id`,
    )
    .run(`u${Date.now()}${Math.random()}@x.com`, balanceLamports, now);
  return Number(u.lastInsertRowid);
}

test('URL gratis: devuelve la respuesta sin cobrar ni abrir pago', async () => {
  behaviour.free = true;
  const uid = await user(5_000_000);
  const out = await callX402Url({ userId: uid, url: `${base}/free` });
  assert.equal(out.paid, false);
  assert.equal(out.status, 200);
  assert.deepEqual(out.result, { free: true });
  assert.equal(out.cost.lamports, 0);
  assert.equal(await getBalance(uid), 5_000_000);
  assert.equal(signed.length, 0);
  const row = await db.prepare('SELECT status, service FROM call_results WHERE id = ?').get<{ status: string; service: string }>(out.resultId);
  assert.equal(row?.status, 'done');
  assert.ok(row?.service.startsWith('x402:127.0.0.1'));
});

test('402 en Stellar: cobra el crédito, firma con el esquema y guarda la tx liquidada', async () => {
  const uid = await user(5_000_000);
  const out = await callX402Url({ userId: uid, url: `${base}/weather?city=Bogota`, headers: { 'X-Demo': 'yes' } });
  assert.equal(out.paid, true);
  assert.equal(out.paidWith, 'credit');
  assert.equal(out.cost.lamports, 100_000);
  assert.equal(out.network, X402_NETWORK);
  assert.equal(out.payTo, PAY_TO);
  assert.equal(out.txHash, 'deadbeef'.repeat(8));
  assert.match(out.explorerUrl ?? '', /stellar\.expert\/explorer\/testnet\/tx\//);
  assert.equal(out.newBalance?.lamports, 4_900_000);
  assert.deepEqual((out.result as { paidFor: string }).paidFor, '/weather?city=Bogota');
  // Dos llamadas al vendedor: la sonda y la pagada (con PAYMENT-SIGNATURE y la cabecera propia).
  assert.equal(received.length, 2);
  assert.equal(received[0].headers['payment-signature'], undefined);
  assert.ok(received[1].headers['payment-signature']);
  assert.equal(received[1].headers['x-demo'], 'yes');
  // Se firmó exactamente lo que el vendedor pidió.
  assert.equal(signed.length, 1);
  assert.equal(signed[0].amount, '100000');
  assert.equal(signed[0].payTo, PAY_TO);
  // Contabilidad: cargo con la firma de la tx y resultado guardado.
  const tx = await db
    .prepare("SELECT amount_lamports, signature, service, metadata FROM transactions WHERE user_id = ? AND type = 'call'")
    .get<{ amount_lamports: number; signature: string; service: string; metadata: string }>(uid);
  assert.equal(Number(tx?.amount_lamports), -100_000);
  assert.equal(tx?.signature, 'deadbeef'.repeat(8));
  assert.equal(JSON.parse(tx?.metadata ?? '{}').mode, 'x402');
  const row = await db
    .prepare('SELECT status, cost_lamports, explorer_url FROM call_results WHERE id = ?')
    .get<{ status: string; cost_lamports: number; explorer_url: string }>(out.resultId);
  assert.equal(row?.status, 'done');
  assert.equal(Number(row?.cost_lamports), 100_000);
  assert.ok(row?.explorer_url);
});

test('POST con body: manda el JSON las dos veces y el content-type', async () => {
  const uid = await user(5_000_000);
  const out = await callX402Url({ userId: uid, url: `${base}/echo`, body: { q: 'hola' } });
  assert.equal(out.paid, true);
  assert.equal(received.length, 2);
  for (const r of received) {
    assert.equal(r.method, 'POST');
    assert.equal(r.body, '{"q":"hola"}');
    assert.match(String(r.headers['content-type']), /application\/json/);
  }
});

test('precio por encima de maxUsd: no cobra ni firma', async () => {
  behaviour.amount = '25000000'; // 2.5 USDC > 1 USD por defecto
  const uid = await user(50_000_000);
  await assert.rejects(callX402Url({ userId: uid, url: `${base}/caro` }), /límite es 1 USD/);
  assert.equal(await getBalance(uid), 50_000_000);
  assert.equal(signed.length, 0);
  // Con autorización explícita sí paga.
  const out = await callX402Url({ userId: uid, url: `${base}/caro`, maxUsd: 3 });
  assert.equal(out.paid, true);
  assert.equal(out.cost.lamports, 25_000_000);
});

test('saldo insuficiente: error claro y sin llamada pagada', async () => {
  const uid = await user(10); // casi nada
  await assert.rejects(callX402Url({ userId: uid, url: `${base}/weather` }), /saldo insuficiente/);
  assert.equal(received.length, 1); // solo la sonda
  assert.equal(await getBalance(uid), 10);
});

test('la API rechaza la llamada pagada sin liquidar: reembolsa el crédito', async () => {
  behaviour.onPaid = 'fail';
  const uid = await user(5_000_000);
  await assert.rejects(callX402Url({ userId: uid, url: `${base}/rompe` }), /rechazó la llamada pagada \(500\): boom/);
  assert.equal(await getBalance(uid), 5_000_000);
  const refund = await db
    .prepare("SELECT amount_lamports FROM transactions WHERE user_id = ? AND type = 'refund'")
    .get<{ amount_lamports: number }>(uid);
  assert.equal(Number(refund?.amount_lamports), 100_000);
  const row = await db.prepare("SELECT status FROM call_results WHERE user_id = ?").get<{ status: string }>(uid);
  assert.equal(row?.status, 'error');
});

test('la API no acepta USDC en nuestra red: error sin cobrar', async () => {
  behaviour.network = 'eip155:8453';
  behaviour.asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const uid = await user(5_000_000);
  await assert.rejects(callX402Url({ userId: uid, url: `${base}/evm` }), /no acepta USDC en stellar:testnet/);
  assert.equal(await getBalance(uid), 5_000_000);
  assert.equal(signed.length, 0);
});

test('pickStellarRequirements elige exact+USDC en nuestra red y explica si es otra red Stellar', () => {
  const stellar = { ...requirements() };
  const evm = { ...requirements(), network: 'eip155:1' as const, asset: '0xabc' };
  assert.equal(pickStellarRequirements([evm, stellar]), stellar);
  assert.throws(() => pickStellarRequirements([{ ...stellar, network: 'stellar:pubnet' }]), /cobra en stellar:pubnet/);
});

test('assertAllowedUrl: exige https y rechaza redes privadas salvo que se abra', async () => {
  delete process.env.X402_ALLOW_HTTP;
  delete process.env.X402_ALLOW_PRIVATE;
  try {
    await assert.rejects(assertAllowedUrl('http://example.com/x'), /debe ser https/);
    await assert.rejects(assertAllowedUrl('https://127.0.0.1/x'), /red privada/);
    await assert.rejects(assertAllowedUrl('https://localhost/x'), /red privada/);
    await assert.rejects(assertAllowedUrl('https://10.0.0.8/x'), /red privada/);
    await assert.rejects(assertAllowedUrl('https://user:pw@example.com/x'), /credenciales/);
    await assert.rejects(assertAllowedUrl('no-es-url'), /url inválida/);
  } finally {
    process.env.X402_ALLOW_HTTP = '1';
    process.env.X402_ALLOW_PRIVATE = '1';
  }
  const ok = await assertAllowedUrl('http://127.0.0.1:9/x');
  assert.equal(ok.hostname, '127.0.0.1');
});
