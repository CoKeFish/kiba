// El handler recibe, además del payload, el contexto de la llamada: el id que le entrega el
// gateway (X-Kiba-Call-Id) y un cliente del gateway ligado a él para pagar a otros servicios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { AgentProvider } from '../src/provider';
import { LocalPlatformSigner, buildPlatformCallHeaders } from '../src/platform-auth';
import type { CallContext } from '../src/types';
import { CALL_ID_HEADER } from '../src/gateway-client';

function providerWith(platformPubkey: string, onCall: (req: unknown, ctx: CallContext) => unknown): AgentProvider {
  const p = new AgentProvider({
    secret: Keypair.random().secret(),
    service: 'brief',
    pricePerCall: 0.01,
    platform: { publicKey: platformPubkey },
    gateway: { url: 'https://gateway.test', apiKey: 'k-publisher' },
  });
  p.serve(async (req: unknown, ctx: CallContext) => onCall(req, ctx));
  return p;
}

test('llamada firmada por la plataforma: el handler recibe callId y un ctx.kiba ligado a él', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  let got: CallContext | undefined;
  const p = providerWith(platform.publicKey(), (_req, ctx) => {
    got = ctx;
    return { ok: true };
  });
  const payload = { url: 'https://example.com' };
  const { headers, body } = await buildPlatformCallHeaders({ signer: platform, service: 'brief', payload });
  const res = await p.verifyAndServe({
    body: JSON.parse(body),
    headers: { ...headers, [CALL_ID_HEADER]: 'res_0123456789abcdef01234567' },
    rawBody: body,
  });
  assert.equal(res.status, 200);
  assert.ok(got);
  assert.equal(got.via, 'platform');
  assert.equal(got.callId, 'res_0123456789abcdef01234567');
  assert.equal(got.kiba.parentCallId, 'res_0123456789abcdef01234567');
  assert.equal(got.kiba.url, 'https://gateway.test');
  assert.equal(got.kiba.enabled, true);
});

test('sin cabecera de llamada: el ctx no tiene padre pero sí cliente', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  let got: CallContext | undefined;
  const p = providerWith(platform.publicKey(), (_req, ctx) => {
    got = ctx;
    return { ok: true };
  });
  const { headers, body } = await buildPlatformCallHeaders({ signer: platform, service: 'brief', payload: { a: 1 } });
  const res = await p.verifyAndServe({ body: JSON.parse(body), headers, rawBody: body });
  assert.equal(res.status, 200);
  assert.equal(got?.callId, undefined);
  assert.equal(got?.kiba.parentCallId, undefined);
});

test('los handlers de un solo argumento siguen funcionando', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const p = new AgentProvider({
    secret: Keypair.random().secret(),
    service: 'echo',
    pricePerCall: 0.01,
    platform: { publicKey: platform.publicKey() },
  });
  p.serve(async (req: unknown) => ({ echoed: req }));
  const { headers, body } = await buildPlatformCallHeaders({ signer: platform, service: 'echo', payload: { x: 2 } });
  const res = await p.verifyAndServe({ body: JSON.parse(body), headers, rawBody: body });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { echoed: unknown }).echoed, { x: 2 });
  // Sin configurar gateway: el cliente existe pero no puede pagar.
  assert.equal(p.gateway.enabled, Boolean(process.env.KIBA_API_KEY));
});
