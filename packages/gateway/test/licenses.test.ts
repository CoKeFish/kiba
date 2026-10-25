// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los módulos del gateway.
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { Keypair } from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import { callAndStore } from '../src/results';
import {
  attachSettlement,
  certificateHtml,
  base58btcDecode,
  base58btcEncode,
  didKeyFromStellar,
  getLicense,
  issuerDid,
  jcs,
  licenseForCall,
  revokeLicense,
  signCredential,
  statusListCredential,
  stellarFromDidKey,
  verifyLicense,
  verifySignature,
} from '../src/licenses';
import type { callOnBehalf } from '../src/proxy';

before(async () => {
  await initDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
});

async function createTestUser(email: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', '[]', `pk-${email}`, 0, now);
  return Number(result.lastInsertRowid);
}

const SHA = 'a'.repeat(64);
const TX = 'f'.repeat(64);

function fakeCall(result: unknown, explorerUrl?: string): typeof callOnBehalf {
  return (async () => ({
    result,
    cost: { lamports: 500_000, usd: 0.05 },
    mode: 'virtual',
    paidWith: 'credit',
    newBalance: { lamports: 0, usd: 0 },
    trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
    explorerUrl,
  })) as unknown as typeof callOnBehalf;
}

test('jcs: claves ordenadas, anidado, sin espacios, undefined fuera', () => {
  assert.equal(jcs({ b: 1, a: { d: [1, 'x', null], c: true }, z: undefined }), '{"a":{"c":true,"d":[1,"x",null]},"b":1}');
  assert.equal(jcs('é"\n'), JSON.stringify('é"\n'));
  assert.equal(jcs(1e21), '1e+21');
});

test('base58btc: ida y vuelta, ceros iniciales', () => {
  for (const hex of ['00', '0000ff', 'deadbeef', '00'.repeat(32), 'ff'.repeat(64)]) {
    const bytes = Buffer.from(hex, 'hex');
    assert.equal(Buffer.from(base58btcDecode(base58btcEncode(bytes))).toString('hex'), hex);
  }
  assert.equal(base58btcEncode(Buffer.from('Hello World!')), '2NEpo7TZRRrLZSi2U');
});

test('did:key Ed25519 ↔ clave Stellar', () => {
  const kp = Keypair.random();
  const did = didKeyFromStellar(kp.publicKey());
  assert.match(did, /^did:key:z6Mk/);
  assert.equal(stellarFromDidKey(did), kp.publicKey());
  assert.equal(stellarFromDidKey(`${did}#${did.slice(8)}`), kp.publicKey());
});

test('eddsa-jcs-2022: firma y verificación; una alteración invalida', async () => {
  const kp = Keypair.random();
  const key = { publicKey: () => kp.publicKey(), sign: (m: Uint8Array) => kp.sign(Buffer.from(m)) };
  const did = didKeyFromStellar(kp.publicKey());
  const vc = await signCredential(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      issuer: did,
      credentialSubject: { id: 'urn:x:1', n: 1 },
    },
    key,
  );
  const proof = vc.proof as Record<string, unknown>;
  assert.equal(proof.cryptosuite, 'eddsa-jcs-2022');
  assert.equal(proof.verificationMethod, `${did}#${did.slice(8)}`);
  assert.deepEqual(verifySignature(vc), { ok: true, issuer: did });
  const tampered = { ...vc, credentialSubject: { id: 'urn:x:1', n: 2 } };
  assert.equal(verifySignature(tampered).ok, false);
  // La firma de otra clave que diga ser el mismo emisor tampoco pasa.
  const other = Keypair.random();
  const forged = await signCredential({ ...vc, proof: undefined }, { publicKey: () => other.publicKey(), sign: (m) => other.sign(Buffer.from(m)) });
  assert.equal(verifySignature({ ...forged, issuer: did }).ok, false);
});

test('callAndStore: un resultado con license emite la credencial y la devuelve', async () => {
  const userId = await createTestUser('lic@test.com');
  const result = {
    audioUrl: 'https://svc/audio/1.mp3',
    license: { assetSha256: SHA, filename: '1.mp3', mimeType: 'audio/mpeg', bytes: 10, terms: { name: 'commercial', attribution: false } },
  };
  const out = await callAndStore({ userId, service: 'music-generator', payload: { prompt: 'lofi' }, waitMs: 2000 }, fakeCall(result));
  assert.equal(out.status, 'done');
  const lic = (out as { license?: Record<string, unknown> }).license;
  assert.ok(lic, 'la respuesta trae license');
  assert.match(String(lic!.id), /^lic_[0-9a-f]{20}$/);
  assert.equal(lic!.status, 'valid');
  assert.equal(lic!.assetSha256, SHA);
  assert.ok(String(lic!.credentialUrl).endsWith(`/v1/licenses/${lic!.id}`));

  const row = await licenseForCall(out.resultId);
  assert.ok(row);
  const vc = JSON.parse(row!.vc);
  assert.deepEqual(vc.type, ['VerifiableCredential', 'MediaLicenseCredential']);
  assert.equal(vc.issuer.id, issuerDid());
  assert.equal(vc.credentialSubject.id, `urn:kiba:user:${userId}`);
  assert.equal(vc.credentialSubject.license.assetSha256, SHA);
  assert.equal(vc.credentialSubject.license.service, 'music-generator');
  assert.equal(vc.credentialSubject.license.terms.name, 'commercial');
  assert.equal(vc.credentialStatus.statusListIndex, String(row!.seq));
  assert.equal(vc.evidence[0].callId, out.resultId);
  assert.equal(vc.evidence[0].txHash, undefined, 'sin tx todavía');
  assert.equal(verifySignature(vc).ok, true);
  const v = await verifyLicense(row!);
  assert.equal(v.verified, true);
  assert.deepEqual(v.checks, { signature: true, issuerIsKiba: true, notRevoked: true, paymentAnchored: false });

  // Llega el enlace on-chain: se ancla el pago y la credencial se vuelve a firmar.
  await attachSettlement(out.resultId, `https://stellar.expert/explorer/testnet/tx/${TX}`);
  const row2 = await getLicense(row!.id);
  assert.equal(row2!.tx_hash, TX);
  const vc2 = JSON.parse(row2!.vc);
  assert.equal(vc2.evidence[0].txHash, TX);
  assert.equal(vc2.validFrom, vc.validFrom);
  assert.equal(verifySignature(vc2).ok, true);
  assert.equal((await verifyLicense(row2!)).checks.paymentAnchored, true);
});

test('callAndStore: sin license (o con hash inválido) no se emite nada', async () => {
  const userId = await createTestUser('nolic@test.com');
  const a = await callAndStore({ userId, service: 'world-clock', payload: {}, waitMs: 2000 }, fakeCall({ time: 'now' }));
  assert.equal((a as { license?: unknown }).license, undefined);
  assert.equal(await licenseForCall(a.resultId), null);
  const b = await callAndStore({ userId, service: 'x', payload: {}, waitMs: 2000 }, fakeCall({ license: { assetSha256: 'nope' } }));
  assert.equal(await licenseForCall(b.resultId), null);
});

test('revocación: verify falla y la lista de estado marca el bit', async () => {
  const userId = await createTestUser('rev@test.com');
  const out = await callAndStore(
    { userId, service: 'music-generator', payload: {}, waitMs: 2000 },
    fakeCall({ license: { assetSha256: SHA } }),
  );
  const row = (await licenseForCall(out.resultId))!;
  assert.equal(await revokeLicense(row.id, 'refund'), true);
  assert.equal(await revokeLicense(row.id, 'refund'), false, 'idempotente');
  const v = await verifyLicense((await getLicense(row.id))!);
  assert.equal(v.verified, false);
  assert.equal(v.status, 'revoked');

  const list = await statusListCredential();
  assert.equal(verifySignature(list).ok, true);
  const encoded = String((list.credentialSubject as { encodedList: string }).encodedList);
  assert.equal(encoded[0], 'u');
  const bits = gunzipSync(Buffer.from(encoded.slice(1), 'base64url'));
  assert.ok(bits.length * 8 >= 131_072, 'tamaño mínimo de la lista');
  const i = Number(row.seq);
  assert.equal((bits[i >> 3] >> (7 - (i & 7))) & 1, 1, 'bit de la licencia revocada');
  assert.equal((bits[(i + 1) >> 3] >> (7 - ((i + 1) & 7))) & 1, 0);
});

test('certificado: los campos que manda el servicio se escapan (sin HTML inyectado)', async () => {
  const userId = await createTestUser('xss@test.com');
  const result = {
    license: { assetSha256: SHA, title: '<b>t</b>', mimeType: 'image/png"><script>alert(1)</script>', bytes: '<img src=x onerror=alert(1)>' },
  };
  const out = await callAndStore({ userId, service: 'media-catalog', payload: {}, waitMs: 2000 }, fakeCall(result));
  const html = certificateHtml((await licenseForCall(out.resultId))!);
  assert.doesNotMatch(html, /<script>|<img|<b>/);
  assert.match(html, /&lt;script&gt;/);
});
