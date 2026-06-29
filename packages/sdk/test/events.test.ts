import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { StellarChainClient } from '../src/chain/stellar';
import { LocalKeypairSigner } from '../src/chain/signer';

const CONTRACT_ID = 'CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF';

function makeClient() {
  return new StellarChainClient({
    signer: new LocalKeypairSigner(Keypair.random()),
    contractId: CONTRACT_ID,
    rpcUrl: 'https://fake-rpc.example.com',
    networkPassphrase: Networks.TESTNET,
  });
}

// Build an event as the SDK's getEvents returns it: topic[0] = symbol, value = ScVal.
function registered(service: string): { topic: xdr.ScVal[]; value: xdr.ScVal } {
  return {
    topic: [nativeToScVal('agent_registered', { type: 'symbol' }), nativeToScVal(Keypair.random().publicKey(), { type: 'address' })],
    // contract emits (service, price, created_at) → a vec
    value: xdr.ScVal.scvVec([
      nativeToScVal(service, { type: 'string' }),
      nativeToScVal(1n, { type: 'i128' }),
      nativeToScVal(0n, { type: 'u64' }),
    ]),
  };
}
function deregistered(service: string): { topic: xdr.ScVal[]; value: xdr.ScVal } {
  return {
    topic: [nativeToScVal('agent_deregistered', { type: 'symbol' }), nativeToScVal(Keypair.random().publicKey(), { type: 'address' })],
    value: nativeToScVal(service, { type: 'string' }),
  };
}

function mockEvents(client: StellarChainClient, events: Array<{ topic: xdr.ScVal[]; value: xdr.ScVal }>) {
  const c = client as unknown as { server: { getLatestLedger: () => unknown; getEvents: (req: unknown) => unknown } };
  c.server.getLatestLedger = async () => ({ sequence: 1000 });
  c.server.getEvents = async () => ({ events, cursor: '', latestLedger: 1000, oldestLedger: 1 });
}

test('listRegisteredServices: returns registered services, drops deregistered', async () => {
  const client = makeClient();
  mockEvents(client, [registered('svc-a'), registered('svc-b'), deregistered('svc-b')]);
  const live = await client.listRegisteredServices();
  assert.deepEqual(live.sort(), ['svc-a']);
});

test('listRegisteredServices: re-registration after deregister stays live (last event wins)', async () => {
  const client = makeClient();
  mockEvents(client, [registered('svc-c'), deregistered('svc-c'), registered('svc-c')]);
  const live = await client.listRegisteredServices();
  assert.deepEqual(live, ['svc-c']);
});

test('listRegisteredServices: ignores unrelated event topics', async () => {
  const client = makeClient();
  const unrelated = {
    topic: [nativeToScVal('agent_updated', { type: 'symbol' })],
    value: nativeToScVal('svc-x', { type: 'string' }),
  };
  mockEvents(client, [registered('svc-a'), unrelated]);
  const live = await client.listRegisteredServices();
  assert.deepEqual(live, ['svc-a']);
});

test('listRegisteredServices: paginates past empty pages (does not stop on first empty page)', async () => {
  const client = makeClient();
  // Soroban RPC scans forward in chunks: an early page can be empty while a later page
  // carries the event. The loop must follow the cursor, not stop on the empty page.
  const pages = [
    { events: [], cursor: 'c1' },
    { events: [registered('svc-late')], cursor: 'c2' },
    { events: [], cursor: 'c2' }, // cursor unchanged → stop
  ];
  let i = 0;
  const c = client as unknown as { server: { getLatestLedger: () => unknown; getEvents: (req: unknown) => unknown } };
  c.server.getLatestLedger = async () => ({ sequence: 1000 });
  c.server.getEvents = async () => pages[Math.min(i++, pages.length - 1)];
  const live = await client.listRegisteredServices();
  assert.deepEqual(live, ['svc-late']);
});

test('listRegisteredServices: RPC failure → returns [] (no throw)', async () => {
  const client = makeClient();
  const c = client as unknown as { server: { getLatestLedger: () => unknown; getEvents: (req: unknown) => unknown } };
  c.server.getLatestLedger = async () => ({ sequence: 1000 });
  c.server.getEvents = async () => {
    throw new Error('startLedger out of range');
  };
  const live = await client.listRegisteredServices();
  assert.deepEqual(live, []);
});
