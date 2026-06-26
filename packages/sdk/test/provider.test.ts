import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { AgentProvider } from '../src/provider';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let provider: AgentProvider;
let server: Server;
let baseUrl: string;

before(async () => {
  // Sin PROGRAM_ID → modo degradado. El provider es fail-CLOSED: en degradado solo
  // sirve si se opta explícitamente con ALLOW_DEGRADED_PAYMENTS=1. Estos tests
  // ejercitan justamente ese camino (sin Solana), así que lo activamos.
  delete process.env.PROGRAM_ID;
  process.env.ALLOW_DEGRADED_PAYMENTS = '1';

  provider = new AgentProvider({
    wallet: Keypair.generate(),
    service: 'echo',
    pricePerCall: 0.01,
    description: 'echoes payload',
    priceFn: (req) => {
      // Pricing dinámico: 0.001 base + 0.0001 por carácter del campo `text`
      const text = (req as { text?: string })?.text ?? '';
      return 0.001 + text.length * 0.0001;
    },
  });
  provider.serve(async (req: unknown) => ({ echoed: req }));

  await new Promise<void>((resolve) => {
    server = provider.app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server?.close();
  delete process.env.ALLOW_DEGRADED_PAYMENTS;
});

// ─── manifest endpoint ─────────────────────────────────────────

test('GET /manifest devuelve la config del agente', async () => {
  const r = await fetch(`${baseUrl}/manifest`);
  assert.equal(r.status, 200);
  const data = (await r.json()) as {
    service: string;
    pricePerCall: number;
    description: string;
    ownerWallet: string;
    acceptedToken: string;
    dynamicPricing?: boolean;
  };
  assert.equal(data.service, 'echo');
  assert.equal(data.pricePerCall, 0.01);
  assert.equal(data.description, 'echoes payload');
  assert.equal(data.acceptedToken, 'SOL');
  assert.equal(data.dynamicPricing, true);
});

// ─── /service handshake ────────────────────────────────────────

test('POST /service sin X-PAYMENT → 402 con quote y nonce', async () => {
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(r.status, 402);
  const data = (await r.json()) as {
    amount: string;
    payTo: string;
    asset: string;
    service: string;
    nonce: string;
    expiresAt: number;
  };
  assert.equal(data.service, 'echo');
  assert.equal(data.asset, 'SOL');
  // priceFn: 0.001 + 5 * 0.0001 = 0.0015 SOL = 1_500_000 lamports.
  // Pero el floor es 0.01 → debe elevarse al floor: 10_000_000 lamports.
  assert.equal(data.amount, '10000000');
  assert.ok(data.nonce);
  assert.ok(data.expiresAt > Math.floor(Date.now() / 1000));
});

test('POST /service: priceFn elevado por sobre el floor', async () => {
  // Texto largo: 0.001 + 200 * 0.0001 = 0.021 SOL > floor 0.01 → 21_000_000
  const longText = 'a'.repeat(200);
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: longText }),
  });
  assert.equal(r.status, 402);
  const data = (await r.json()) as { amount: string };
  assert.equal(data.amount, '21000000');
});

test('POST /service con X-PAYMENT válido (modo degradado, sin verificación) → 200 + handler ejecutado', async () => {
  const paymentHeader = Buffer.from(
    JSON.stringify({
      signature: 'sig-fake',
      nonce: '123',
      clientWallet: Keypair.generate().publicKey.toBase58(),
    }),
  ).toString('base64');

  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader,
    },
    body: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(r.status, 200);
  const data = (await r.json()) as { echoed: { text: string }; _payment?: { mode?: string } };
  assert.equal(data.echoed.text, 'hi');
  // En modo degradado el provider deja un breadcrumb explícito
  assert.equal(data._payment?.mode, 'degraded-no-onchain-verification');
});

test('POST /service con X-PAYMENT inválido (no base64 JSON) → 400', async () => {
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': '!!!not-base64-json!!!',
    },
    body: JSON.stringify({ text: 'x' }),
  });
  assert.equal(r.status, 400);
  const data = (await r.json()) as { error: string };
  assert.match(data.error, /invalid X-PAYMENT/);
});

// ─── /health ───────────────────────────────────────────────────

test('GET /health devuelve ok', async () => {
  const r = await fetch(`${baseUrl}/health`);
  assert.equal(r.status, 200);
  const data = (await r.json()) as { ok: boolean; service: string };
  assert.equal(data.ok, true);
  assert.equal(data.service, 'echo');
});

// ─── handler not configured (caso edge) ────────────────────────

test('si no hay handler → 500', async () => {
  // Provider local sin .serve()
  const lonely = new AgentProvider({
    wallet: Keypair.generate(),
    service: 'lonely',
    pricePerCall: 0.001,
  });

  const lonelyServer = await new Promise<Server>((resolve) => {
    const s = lonely.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const lonelyAddr = lonelyServer.address() as AddressInfo;
  const lonelyUrl = `http://127.0.0.1:${lonelyAddr.port}`;

  const paymentHeader = Buffer.from(
    JSON.stringify({ signature: 's', nonce: '1', clientWallet: Keypair.generate().publicKey.toBase58() }),
  ).toString('base64');

  const r = await fetch(`${lonelyUrl}/service`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader,
    },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 500);

  lonelyServer.close();
});
