import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { AgentProvider } from '../src/provider';
import { LocalPlatformSigner, buildPlatformCallHeaders } from '../src/platform-auth';
import type { ChainClient, ChainEscrowInfo } from '../src/chain';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ─── HTTP integration (degraded, allowUnverified) ──────────────

let provider: AgentProvider;
let server: Server;
let baseUrl: string;

before(async () => {
  // No contractId → degraded mode. The provider is fail-CLOSED: in degraded mode it
  // only serves when allowUnverified is set. These tests exercise that path.
  provider = new AgentProvider({
    secret: Keypair.random().secret(),
    service: 'echo',
    pricePerCall: 0.01,
    description: 'echoes payload',
    allowUnverified: true,
    priceFn: (req) => {
      const text = (req as { text?: string })?.text ?? '';
      return 0.001 + text.length * 0.0001;
    },
  });
  provider.serve(async (req: unknown) => ({ echoed: req }));

  await new Promise<void>((resolve) => {
    server = provider.app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

test('GET /manifest returns the agent config (USDC)', async () => {
  const r = await fetch(`${baseUrl}/manifest`);
  assert.equal(r.status, 200);
  const data = (await r.json()) as {
    service: string;
    pricePerCall: number;
    acceptedToken: string;
    dynamicPricing?: boolean;
    platformAuth?: boolean;
  };
  assert.equal(data.service, 'echo');
  assert.equal(data.pricePerCall, 0.01);
  assert.equal(data.acceptedToken, 'USDC');
  assert.equal(data.dynamicPricing, true);
  assert.equal(data.platformAuth, false);
});

test('POST /service without X-PAYMENT → 402 with quote and nonce (stroops)', async () => {
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(r.status, 402);
  const data = (await r.json()) as { amount: string; asset: string; service: string; nonce: string; expiresAt: number };
  assert.equal(data.service, 'echo');
  assert.equal(data.asset, 'USDC');
  // priceFn: 0.001 + 5*0.0001 = 0.0015 < floor 0.01 → floor 0.01 USDC = 100000 stroops.
  assert.equal(data.amount, '100000');
  assert.ok(data.nonce);
  assert.ok(data.expiresAt > Math.floor(Date.now() / 1000));
});

test('POST /service: priceFn raised above the floor', async () => {
  // 0.001 + 200*0.0001 = 0.021 USDC > floor 0.01 → 210000 stroops.
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'a'.repeat(200) }),
  });
  assert.equal(r.status, 402);
  assert.equal(((await r.json()) as { amount: string }).amount, '210000');
});

test('POST /service with X-PAYMENT (degraded, allowUnverified) → 200 + handler ran', async () => {
  const paymentHeader = Buffer.from(JSON.stringify({ escrowId: 'x', nonce: '1' })).toString('base64');
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT': paymentHeader },
    body: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(r.status, 200);
  const data = (await r.json()) as { echoed: { text: string }; _payment?: { mode?: string } };
  assert.equal(data.echoed.text, 'hi');
  assert.equal(data._payment?.mode, 'degraded-no-onchain-verification');
});

test('POST /service with invalid X-PAYMENT (not base64 JSON) → 400', async () => {
  const r = await fetch(`${baseUrl}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT': '!!!not-base64-json!!!' },
    body: JSON.stringify({ text: 'x' }),
  });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /invalid X-PAYMENT/);
});

test('GET /health → ok', async () => {
  const r = await fetch(`${baseUrl}/health`);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { ok: boolean }).ok, true);
});

// ─── platform-signed (trusted) path ────────────────────────────

function trustedProvider(platformPubkey: string): AgentProvider {
  const p = new AgentProvider({
    secret: Keypair.random().secret(),
    service: 'echo',
    pricePerCall: 0.01,
    platform: { publicKey: platformPubkey },
  });
  p.serve(async (req: unknown) => ({ echoed: req }));
  return p;
}

test('platform-signed call → 200 trusted, no escrow', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const p = trustedProvider(platform.publicKey());
  const payload = { text: 'trusted' };
  const { headers, body } = await buildPlatformCallHeaders({ signer: platform, service: 'echo', payload });

  const res = await p.verifyAndServe({ body: JSON.parse(body), headers, rawBody: body });
  assert.equal(res.status, 200);
  const b = res.body as { echoed: { text: string }; _payment?: { trusted?: boolean } };
  assert.equal(b.echoed.text, 'trusted');
  assert.equal(b._payment?.trusted, true);
});

test('platform-signed call with tampered payload → 401', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const p = trustedProvider(platform.publicKey());
  const { headers } = await buildPlatformCallHeaders({ signer: platform, service: 'echo', payload: { a: 1 } });
  const res = await p.verifyAndServe({ body: { a: 2 }, headers, rawBody: JSON.stringify({ a: 2 }) });
  assert.equal(res.status, 401);
  assert.equal((res.body as { reason?: string }).reason, 'payload-mismatch');
});

test('platform-signed call replayed → 401', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const p = trustedProvider(platform.publicKey());
  const { headers, body } = await buildPlatformCallHeaders({ signer: platform, service: 'echo', payload: { a: 1 } });
  const first = await p.verifyAndServe({ body: JSON.parse(body), headers, rawBody: body });
  assert.equal(first.status, 200);
  const second = await p.verifyAndServe({ body: JSON.parse(body), headers, rawBody: body });
  assert.equal(second.status, 401);
  assert.equal((second.body as { reason?: string }).reason, 'replayed');
});

test('platform cert presented but platform-auth not configured → 401', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const p = new AgentProvider({ secret: Keypair.random().secret(), service: 'echo', pricePerCall: 0.01 });
  p.serve(async (req: unknown) => ({ echoed: req }));
  const { headers, body } = await buildPlatformCallHeaders({ signer: platform, service: 'echo', payload: { a: 1 } });
  const res = await p.verifyAndServe({ body: JSON.parse(body), headers, rawBody: body });
  assert.equal(res.status, 401);
  assert.match((res.body as { error: string }).error, /not enabled/);
});

// ─── x402 escrow binding + single-use ──────────────────────────

const OWNER = Keypair.random().publicKey();

function mockChain(escrow: ChainEscrowInfo | null, claim = async () => 'released'): ChainClient {
  return {
    asset: 'USDC',
    baseUnitsPerToken: 1e7,
    ownerAddress: OWNER,
    fetchEscrow: async () => escrow,
    claimPayment: claim,
  } as unknown as ChainClient;
}

function escrowProvider(chain: ChainClient): AgentProvider {
  const p = new AgentProvider({
    secret: Keypair.random().secret(),
    service: 'echo',
    pricePerCall: 0.01, // floor = 100000 stroops
    escrowPollAttempts: 1,
    escrowPollIntervalMs: 1,
  });
  p.serve(async (req: unknown) => ({ echoed: req }));
  (p as unknown as { chain: ChainClient }).chain = chain;
  return p;
}

function xpayment(escrowId: string): string {
  return Buffer.from(JSON.stringify({ escrowId, nonce: 'n1' })).toString('base64');
}

test('escrow funded + this agent is receiver → 200 once', async () => {
  const p = escrowProvider(mockChain({ amountBaseUnits: 200000n, state: 'Pending', receiver: OWNER }));
  const res = await p.verifyAndServe({
    body: { text: 'hi' },
    headers: { 'x-payment': xpayment('CESCROW1') },
  });
  assert.equal(res.status, 200);
  assert.equal((res.body as { _payment?: { settling?: boolean } })._payment?.settling, true);
});

test('escrow with a different receiver → 402 (cross-agent reuse blocked)', async () => {
  const otherAgent = Keypair.random().publicKey();
  const p = escrowProvider(mockChain({ amountBaseUnits: 200000n, state: 'Pending', receiver: otherAgent }));
  const res = await p.verifyAndServe({ body: { text: 'hi' }, headers: { 'x-payment': xpayment('CESCROW2') } });
  assert.equal(res.status, 402);
  assert.match((res.body as { error: string }).error, /receiver does not match/);
});

test('escrow without a known receiver → 402 (fail-closed)', async () => {
  const p = escrowProvider(mockChain({ amountBaseUnits: 200000n, state: 'Pending' }));
  const res = await p.verifyAndServe({ body: { text: 'hi' }, headers: { 'x-payment': xpayment('CESCROW3') } });
  assert.equal(res.status, 402);
  assert.match((res.body as { error: string }).error, /receiver unknown/);
});

test('escrow under-funded → 402', async () => {
  const p = escrowProvider(mockChain({ amountBaseUnits: 1n, state: 'Pending', receiver: OWNER }));
  const res = await p.verifyAndServe({ body: { text: 'hi' }, headers: { 'x-payment': xpayment('CESCROW4') } });
  assert.equal(res.status, 402);
  assert.match((res.body as { error: string }).error, /below price/);
});

test('same escrow presented twice → second is 409 (single-use)', async () => {
  const p = escrowProvider(mockChain({ amountBaseUnits: 200000n, state: 'Pending', receiver: OWNER }));
  const first = await p.verifyAndServe({ body: { text: 'hi' }, headers: { 'x-payment': xpayment('CESCROW5') } });
  assert.equal(first.status, 200);
  const second = await p.verifyAndServe({ body: { text: 'hi' }, headers: { 'x-payment': xpayment('CESCROW5') } });
  assert.equal(second.status, 409);
  assert.match((second.body as { error: string }).error, /already consumed/);
});

test('no handler configured → 500', async () => {
  const lonely = new AgentProvider({ secret: Keypair.random().secret(), service: 'lonely', pricePerCall: 0.001 });
  const res = await lonely.verifyAndServe({ body: {}, headers: {} });
  assert.equal(res.status, 500);
});
