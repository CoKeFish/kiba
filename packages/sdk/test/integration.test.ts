import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { AgentProvider, AgentClient, LocalPlatformSigner } from '../src';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * End-to-end "dry-run": a real AgentProvider serves over loopback HTTP and a real
 * AgentClient calls it via the asymmetric platform-signed path (mint → HTTP →
 * express rawBody capture → verify → handler). No chain / no mocks.
 */

const platform = new LocalPlatformSigner(Keypair.random());
let server: Server;
let endpoint: string;

before(async () => {
  const provider = new AgentProvider({
    secret: Keypair.random().secret(),
    service: 'sentiment',
    pricePerCall: 0.002,
    platform: { publicKey: platform.publicKey() },
  });
  provider.serve(async (req: { text: string }) => ({
    label: /good|great|love/i.test(req.text) ? 'positive' : 'negative',
  }));
  server = await new Promise<Server>((resolve) => {
    const s = provider.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

test('e2e: platform-signed call is discovered-free, served, and returns the result', async () => {
  const client = new AgentClient({ secret: Keypair.random().secret() });
  const out = await client.callSigned<{ label: string }>(
    endpoint,
    { text: 'this is great' },
    { signer: platform, service: 'sentiment' },
  );
  assert.equal(out.label, 'positive');
});

test('e2e: a call signed by the wrong key is rejected', async () => {
  const client = new AgentClient({ secret: Keypair.random().secret() });
  const impostor = new LocalPlatformSigner(Keypair.random()); // not the configured platform key
  await assert.rejects(
    client.callSigned(endpoint, { text: 'great' }, { signer: impostor, service: 'sentiment' }),
    /failed/,
  );
});

test('e2e: an unpaid plain POST gets a 402 quote (USDC)', async () => {
  const res = await fetch(`${endpoint}/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(res.status, 402);
  const q = (await res.json()) as { asset: string; service: string };
  assert.equal(q.asset, 'USDC');
  assert.equal(q.service, 'sentiment');
});
