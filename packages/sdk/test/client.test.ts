import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import axios from 'axios';
import { AgentClient } from '../src/client';

// Mock simple de axios.post y axios.get. El SDK los importa como default
// (`import axios from 'axios'`) y la instancia es singleton, así que
// monkey-patching aquí los sustituye por debajo.

interface MockReq {
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  config?: { headers?: Record<string, string> };
}

const calls: MockReq[] = [];
let postQueue: Array<(req: MockReq) => Promise<{ status: number; data: unknown }>> = [];
let getQueue: Array<(req: MockReq) => Promise<{ status: number; data: unknown }>> = [];

const origPost = axios.post;
const origGet = axios.get;

before(() => {
  // @ts-expect-error monkey-patch
  axios.post = async (url: string, body: unknown, opts: { headers?: Record<string, string> } = {}) => {
    calls.push({ url, body, headers: opts.headers });
    const handler = postQueue.shift();
    if (!handler) throw new Error(`unexpected POST: ${url}`);
    return handler({ url, body, headers: opts.headers });
  };
  // @ts-expect-error monkey-patch
  axios.get = async (url: string) => {
    calls.push({ url });
    const handler = getQueue.shift();
    if (!handler) throw new Error(`unexpected GET: ${url}`);
    return handler({ url });
  };
});

after(() => {
  // @ts-expect-error restore
  axios.post = origPost;
  // @ts-expect-error restore
  axios.get = origGet;
});

beforeEach(() => {
  calls.length = 0;
  postQueue = [];
  getQueue = [];
});

function makeClient(): AgentClient {
  // Sin programId → modo degradado: el escrow queda como 'NO_ONCHAIN_PROGRAM_ID'
  // y no se hace ningún tx on-chain. Perfecto para tests.
  delete process.env.PROGRAM_ID;
  return new AgentClient({
    wallet: Keypair.generate(),
    rpcUrl: 'http://fake-rpc:9999',
  });
}

// ─── happy path ────────────────────────────────────────────────

test('callWithTrace: 402 → escrow_opened (degraded) → 200 con trace completo', async () => {
  const client = makeClient();

  // 1) discover via backend GET /agents/<service>
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 'translator',
      pricePerCall: 0.01,
      endpoint: 'http://translator:5001',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));

  // 2) probe POST /service → 402 con quote
  postQueue.push(async () => ({
    status: 402,
    data: {
      amount: '10000000',
      payTo: client.wallet.publicKey.toBase58(),
      asset: 'SOL',
      service: 'translator',
      nonce: '12345',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    },
  }));

  // 3) retry POST /service con X-PAYMENT → 200 con resultado
  postQueue.push(async (req) => {
    assert.ok(req.headers?.['X-PAYMENT'], 'segundo POST debe llevar X-PAYMENT');
    return {
      status: 200,
      data: {
        translation: 'hola',
        _payment: { signature: 'fake-claim-sig', amount: '10000000' },
      },
    };
  });

  const { result, trace } = await client.callWithTrace('translator', { text: 'hello' });
  assert.deepEqual((result as { translation: string }).translation, 'hola');
  assert.equal(trace.service, 'translator');
  // 3 steps: discover, 402_received, escrow_opened, service_responded → 4
  assert.equal(trace.steps.length, 4);
  assert.equal(trace.steps[0].type, 'discover');
  assert.equal(trace.steps[1].type, '402_received');
  assert.equal(trace.steps[2].type, 'escrow_opened');
  assert.equal(trace.steps[3].type, 'service_responded');

  // En modo degradado (sin PROGRAM_ID), la signature de escrow es el sentinel
  if (trace.steps[2].type === 'escrow_opened') {
    assert.equal(trace.steps[2].signature, 'NO_ONCHAIN_PROGRAM_ID');
  }
  if (trace.steps[3].type === 'service_responded') {
    assert.equal(trace.steps[3].status, 200);
    assert.equal(trace.steps[3].claimSignature, 'fake-claim-sig');
    assert.equal(trace.steps[3].claimedAmount, '10000000');
  }
});

test('callWithTrace: timestamps son monotónicamente no-decrecientes', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 's',
      pricePerCall: 0.01,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  postQueue.push(async () => ({
    status: 402,
    data: {
      amount: '1000',
      payTo: client.wallet.publicKey.toBase58(),
      asset: 'SOL',
      service: 's',
      nonce: '1',
      expiresAt: 0,
    },
  }));
  postQueue.push(async () => ({ status: 200, data: { ok: true } }));

  const { trace } = await client.callWithTrace('s', {});
  for (let i = 1; i < trace.steps.length; i++) {
    assert.ok(
      trace.steps[i].timestamp >= trace.steps[i - 1].timestamp,
      `timestamp regression entre step ${i - 1} y ${i}`,
    );
  }
});

test('callWithTrace: legacy 200 directo (sin 402) devuelve resultado y trace parcial', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 's',
      pricePerCall: 0.01,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  postQueue.push(async () => ({ status: 200, data: { legacy: 'response' } }));

  const { result, trace } = await client.callWithTrace('s', {});
  assert.deepEqual(result, { legacy: 'response' });
  // Solo el step discover (no se llegó al 402_received)
  assert.equal(trace.steps.length, 1);
  assert.equal(trace.steps[0].type, 'discover');
});

test('callWithTrace: status no 200/402 lanza error con detalle', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 's',
      pricePerCall: 0.01,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  postQueue.push(async () => ({ status: 500, data: { error: 'boom' } }));

  await assert.rejects(client.callWithTrace('s', {}), /unexpected status 500/);
});

test('callWithTrace: maxPrice circuit breaker rechaza si pricePerCall lo excede', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 'expensive',
      pricePerCall: 1.0,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  await assert.rejects(
    client.callWithTrace('expensive', {}, { maxPrice: 0.5 }),
    /exceeds maxPrice/,
  );
});

test('callWithTrace: allowlist excluye servicios no permitidos', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 'unwanted',
      pricePerCall: 0.01,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  await assert.rejects(
    client.callWithTrace('unwanted', {}, { allowlist: ['only-this'] }),
    /not in allowlist/,
  );
});

// ─── call() es wrapper ─────────────────────────────────────────

test('call() devuelve solo el resultado (descarta trace)', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 's',
      pricePerCall: 0.01,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  postQueue.push(async () => ({
    status: 402,
    data: {
      amount: '1000',
      payTo: client.wallet.publicKey.toBase58(),
      asset: 'SOL',
      service: 's',
      nonce: '1',
      expiresAt: 0,
    },
  }));
  postQueue.push(async () => ({ status: 200, data: { value: 42 } }));

  const r = await client.call<{ value: number }>('s', {});
  assert.equal(r.value, 42);
});

// ─── getQuote ──────────────────────────────────────────────────

test('getQuote: backend devuelve 402 → quote correcta', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 's',
      pricePerCall: 0.01,
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  postQueue.push(async () => ({
    status: 402,
    data: {
      amount: '5000',
      payTo: client.wallet.publicKey.toBase58(),
      asset: 'SOL',
      service: 's',
      nonce: 'abc',
      expiresAt: 999,
    },
  }));

  const { manifest, quote } = await client.getQuote('s', { hello: 'world' });
  assert.equal(manifest.service, 's');
  assert.equal(quote.amount, '5000');
  assert.equal(quote.nonce, 'abc');
});

test('getQuote: agente legacy 200 sin paywall → quote sintética desde manifest', async () => {
  const client = makeClient();
  getQueue.push(async () => ({
    status: 200,
    data: {
      service: 's',
      pricePerCall: 0.05, // 0.05 SOL = 50_000_000 lamports
      endpoint: 'http://x',
      ownerWallet: client.wallet.publicKey.toBase58(),
      acceptedToken: 'SOL',
    },
  }));
  postQueue.push(async () => ({ status: 200, data: { ok: true } }));

  const { quote } = await client.getQuote('s', {});
  // 0.05 * 1e9 = 50_000_000 → string
  assert.equal(quote.amount, '50000000');
  assert.equal(quote.nonce, '0');
});
