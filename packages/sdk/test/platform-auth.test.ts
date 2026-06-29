import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import {
  LocalPlatformSigner,
  buildPlatformCallHeaders,
  verifyPlatformCall,
  ReplayGuard,
  hashBody,
  PLATFORM_CERT_HEADER,
  PLATFORM_SIGNATURE_HEADER,
} from '../src/platform-auth';

const SERVICE = 'translator-pro';

async function mint(signer: LocalPlatformSigner, payload: unknown, opts: { service?: string; now?: number } = {}) {
  return buildPlatformCallHeaders({
    signer,
    service: opts.service ?? SERVICE,
    payload,
    now: opts.now,
  });
}

test('valid platform-signed call verifies', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const guard = new ReplayGuard();
  const payload = { text: 'hello', to: 'es' };
  const { headers, body } = await mint(platform, payload);

  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: guard,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.cert.service, SERVICE);
    assert.equal(res.cert.iss, platform.publicKey());
    assert.equal(res.cert.payloadHash, hashBody(body));
  }
});

test('forged signature (signed by another key) is rejected', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const attacker = new LocalPlatformSigner(Keypair.random());
  const { body, cert } = await mint(platform, { a: 1 });

  // Attacker re-signs the same cert bytes but the agent trusts the platform key.
  const certBytes = Buffer.from(JSON.stringify(cert), 'utf8');
  const forged = {
    [PLATFORM_CERT_HEADER]: certBytes.toString('base64'),
    [PLATFORM_SIGNATURE_HEADER]: Buffer.from(attacker.sign(certBytes)).toString('base64'),
  };
  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers: forged,
    body,
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
  });
  assert.equal(res.ok, false);
  // iss in the cert still names the platform, so the issuer check passes and the
  // signature check is what fails.
  if (!res.ok) assert.equal(res.error.reason, 'bad-signature');
});

test('issuer mismatch is rejected', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const other = Keypair.random().publicKey();
  const { headers, body } = await mint(platform, { a: 1 });
  const res = verifyPlatformCall({
    publicKey: other, // agent configured to trust a different key
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.reason, 'bad-signature');
});

test('tampered payload is rejected (payload binding)', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const { headers } = await mint(platform, { amount: 1 });
  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body: JSON.stringify({ amount: 1000000 }), // different body than was signed
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.reason, 'payload-mismatch');
});

test('wrong service is rejected', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const { headers, body } = await mint(platform, { a: 1 }, { service: 'other-service' });
  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.reason, 'wrong-service');
});

test('expired certificate is rejected', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const past = 1_000_000; // way in the past
  const { headers, body } = await mint(platform, { a: 1 }, { now: past });
  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
    now: past + 10_000, // long after exp
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.reason, 'expired');
});

test('future-dated certificate is rejected', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const future = 2_000_000_000;
  const { headers, body } = await mint(platform, { a: 1 }, { now: future });
  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
    now: future - 10_000, // long before ts, beyond skew
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.reason, 'expired');
});

test('replayed nonce is rejected on the second use', async () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const guard = new ReplayGuard();
  const { headers, body } = await mint(platform, { a: 1 });

  const first = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: guard,
  });
  assert.equal(first.ok, true);

  const second = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers,
    body,
    expectedService: SERVICE,
    replayGuard: guard,
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.reason, 'replayed');
});

test('missing headers → reason "missing"', () => {
  const platform = new LocalPlatformSigner(Keypair.random());
  const res = verifyPlatformCall({
    publicKey: platform.publicKey(),
    headers: {},
    body: '{}',
    expectedService: SERVICE,
    replayGuard: new ReplayGuard(),
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.reason, 'missing');
});

test('ReplayGuard prunes expired nonces', () => {
  const guard = new ReplayGuard();
  guard.check('a', 100, 50);
  assert.equal(guard.size, 1);
  // A later check past 'a' exp prunes it.
  guard.check('b', 1000, 200);
  assert.equal(guard.size, 1); // 'a' pruned, 'b' present
});
