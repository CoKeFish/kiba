import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';
import { AgentClient } from '../src/client';
import type { ChainClient } from '../src/chain';

// Mock of axios.post/get. The SDK imports axios as default and the instance is a
// singleton, so monkey-patching here substitutes them underneath.

interface MockReq {
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

let postQueue: Array<(req: MockReq) => Promise<{ status: number; data: unknown }>> = [];
let getQueue: Array<(req: MockReq) => Promise<{ status: number; data: unknown }>> = [];

const origPost = axios.post;
const origGet = axios.get;

before(() => {
  // @ts-expect-error monkey-patch
  axios.post = async (url: string, body: unknown, opts: { headers?: Record<string, string> } = {}) => {
    const handler = postQueue.shift();
    if (!handler) throw new Error(`unexpected POST: ${url}`);
    return handler({ url, body, headers: opts.headers });
  };
  // @ts-expect-error monkey-patch
  axios.get = async (url: string) => {
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
  postQueue = [];
  getQueue = [];
});

function makeClient(): AgentClient {
  // No contractId → degraded mode: escrow is 'NO_ONCHAIN_PROGRAM_ID' and no on-chain
  // tx happens. A discoveryUrl is set so discover() hits the mocked backend.
  return new AgentClient({ wallet: Keypair.random(), discoveryUrl: 'http://backend:4000' });
}

function manifest(client: AgentClient, over: Record<string, unknown> = {}) {
  return {
    service: 's',
    pricePerCall: 0.01,
    endpoint: 'http://x',
    ownerWallet: client.ownerAddress,
    acceptedToken: 'USDC',
    ...over,
  };
}

// ─── happy path ────────────────────────────────────────────────

test('callWithTrace: 402 → escrow_opened (degraded) → 200 with full trace', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client, { service: 'translator', endpoint: 'http://translator:5001' }) }));

  postQueue.push(async () => ({
    status: 402,
    data: { amount: '100000', payTo: client.ownerAddress, asset: 'USDC', service: 'translator', nonce: '12345', expiresAt: Math.floor(Date.now() / 1000) + 60 },
  }));
  postQueue.push(async (req) => {
    assert.ok(req.headers?.['X-PAYMENT'], 'second POST must carry X-PAYMENT');
    return { status: 200, data: { translation: 'hola', _payment: { signature: 'fake-claim-sig', amount: '100000' } } };
  });

  const { result, trace } = await client.callWithTrace('translator', { text: 'hello' });
  assert.equal((result as { translation: string }).translation, 'hola');
  assert.equal(trace.steps.length, 4);
  assert.deepEqual(trace.steps.map((s) => s.type), ['discover', '402_received', 'escrow_opened', 'service_responded']);
  if (trace.steps[2].type === 'escrow_opened') assert.equal(trace.steps[2].signature, 'NO_ONCHAIN_PROGRAM_ID');
  if (trace.steps[3].type === 'service_responded') {
    assert.equal(trace.steps[3].claimSignature, 'fake-claim-sig');
    assert.equal(trace.steps[3].claimedAmount, '100000');
  }
});

test('callWithTrace: legacy 200 (no 402) returns result + partial trace', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client) }));
  postQueue.push(async () => ({ status: 200, data: { legacy: 'response' } }));

  const { result, trace } = await client.callWithTrace('s', {});
  assert.deepEqual(result, { legacy: 'response' });
  assert.equal(trace.steps.length, 1);
  assert.equal(trace.steps[0].type, 'discover');
});

test('callWithTrace: non 200/402 throws with detail', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client) }));
  postQueue.push(async () => ({ status: 500, data: { error: 'boom' } }));
  await assert.rejects(client.callWithTrace('s', {}), /unexpected status 500/);
});

test('callWithTrace: maxPrice circuit breaker rejects when price exceeds it', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client, { service: 'expensive', pricePerCall: 1.0 }) }));
  await assert.rejects(client.callWithTrace('expensive', {}, { maxPrice: 0.5 }), /exceeds maxPrice/);
});

test('callWithTrace: allowlist excludes services not permitted', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client, { service: 'unwanted' }) }));
  await assert.rejects(client.callWithTrace('unwanted', {}, { allowlist: ['only-this'] }), /not in allowlist/);
});

test('call() returns only the result (discards trace)', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client) }));
  postQueue.push(async () => ({ status: 402, data: { amount: '1000', payTo: client.ownerAddress, asset: 'USDC', service: 's', nonce: '1', expiresAt: 0 } }));
  postQueue.push(async () => ({ status: 200, data: { value: 42 } }));
  const r = await client.call<{ value: number }>('s', {});
  assert.equal(r.value, 42);
});

// ─── getQuote ──────────────────────────────────────────────────

test('getQuote: backend 402 → correct quote', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client) }));
  postQueue.push(async () => ({ status: 402, data: { amount: '5000', payTo: client.ownerAddress, asset: 'USDC', service: 's', nonce: 'abc', expiresAt: 999 } }));
  const { manifest: m, quote } = await client.getQuote('s', { hello: 'world' });
  assert.equal(m.service, 's');
  assert.equal(quote.amount, '5000');
  assert.equal(quote.nonce, 'abc');
});

test('getQuote: legacy 200 (no paywall) → synthetic quote from manifest', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 200, data: manifest(client, { pricePerCall: 0.05 }) }));
  postQueue.push(async () => ({ status: 200, data: { ok: true } }));
  const { quote } = await client.getQuote('s', {});
  // 0.05 USDC * 1e7 = 500000 stroops.
  assert.equal(quote.amount, '500000');
  assert.equal(quote.nonce, '0');
});

// ─── discover errors ───────────────────────────────────────────

test('discover: backend 404 → ServiceNotFoundError', async () => {
  const client = makeClient();
  getQueue.push(async () => ({ status: 404, data: { error: 'nope' } }));
  await assert.rejects(client.call('ghost', {}), /agent 'ghost' not found/);
});

test('discover: no discoveryUrl and no chain → ServiceNotFoundError', async () => {
  delete process.env.BACKEND_URL;
  delete process.env.KIBA_DISCOVERY_URL;
  const client = new AgentClient({ wallet: Keypair.random() }); // no discoveryUrl
  await assert.rejects(client.call('ghost', {}), /agent 'ghost' not found/);
});

// ─── verifyEndpoint (anti name-squatting) ──────────────────────

function mockChainWithAgent(endpoint: string, owner: string): ChainClient {
  return {
    asset: 'USDC',
    baseUnitsPerToken: 1e7,
    ownerAddress: owner,
    fetchAgent: async (service: string) => ({
      service,
      pricePerCallBaseUnits: 100000n,
      description: 'd',
      endpoint,
      ownerAddress: owner,
    }),
  } as unknown as ChainClient;
}

test('discover verifyEndpoint: live manifest owner matches → ok', async () => {
  const client = new AgentClient({ wallet: Keypair.random(), verifyEndpoint: true });
  (client as unknown as { chain: ChainClient }).chain = mockChainWithAgent('http://agent', 'GOWNER');
  getQueue.push(async () => ({
    status: 200,
    data: { service: 'svc', ownerWallet: 'GOWNER', endpoint: 'http://agent', pricePerCall: 0.01, acceptedToken: 'USDC' },
  }));
  const m = await client.discover('svc');
  assert.equal(m.ownerWallet, 'GOWNER');
});

test('discover verifyEndpoint: endpoint owned by an impostor → EndpointVerificationError', async () => {
  const client = new AgentClient({ wallet: Keypair.random(), verifyEndpoint: true });
  (client as unknown as { chain: ChainClient }).chain = mockChainWithAgent('http://victim', 'GREGISTRANT');
  // The endpoint actually serves a different owner → registration is squatting the endpoint.
  getQueue.push(async () => ({
    status: 200,
    data: { service: 'svc', ownerWallet: 'GVICTIM', endpoint: 'http://victim', pricePerCall: 0.01, acceptedToken: 'USDC' },
  }));
  await assert.rejects(client.discover('svc'), /endpoint verification failed/);
});
