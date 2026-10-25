// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los módulos del gateway.
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDb, pool } from '../src/db';
import { callAndStore } from '../src/results';
import {
  attachSettlement,
  getLicense,
  jcs,
  licenseDto,
  licenseForCall,
  referenceOf,
  revokeLicense,
  sha256Hex,
  verifyLicense,
  type PaymentTx,
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
const PAY_TO = 'GCS7D7E2OM4T54QA75QGAFJ3KTXYRQWMKP7FI3EVEDCXXXPH5SJ5PXC4';

/** Stub de callOnBehalf: como el modo crédito, llama a onBeforePay ANTES de "pagar". */
function fakeCall(result: unknown, explorerUrl?: string, seen?: { reference?: bigint }): typeof callOnBehalf {
  return (async (a: Parameters<typeof callOnBehalf>[0]) => {
    const reference = await a.onBeforePay?.(result, { lamports: 500_000, payTo: PAY_TO });
    if (seen) seen.reference = reference;
    return {
      result,
      cost: { lamports: 500_000, usd: 0.05 },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: 0, usd: 0 },
      trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
      explorerUrl,
    };
  }) as unknown as typeof callOnBehalf;
}

const readerWith = (reference: bigint | undefined, found = true) => async (): Promise<PaymentTx> =>
  found ? { found: true, to: PAY_TO, amount: 500_000n, reference } : { found: false };

test('jcs: claves ordenadas, anidado, sin espacios, undefined fuera', () => {
  assert.equal(jcs({ b: 1, a: { d: [1, 'x', null], c: true }, z: undefined }), '{"a":{"c":true,"d":[1,"x",null]},"b":1}');
  assert.equal(jcs('é"\n'), JSON.stringify('é"\n'));
  assert.equal(jcs(1e21), '1e+21');
});

test('referenceOf: los primeros 8 bytes de la huella como u64 big-endian', () => {
  assert.equal(referenceOf('0000000000000001' + 'ff'.repeat(24)), 1n);
  assert.equal(referenceOf('ffffffffffffffff' + '00'.repeat(24)), 2n ** 64n - 1n);
  assert.equal(referenceOf('0123456789abcdef' + '00'.repeat(24)), 0x0123456789abcdefn);
});

test('callAndStore: el documento se escribe antes del pago y su huella viaja en el reference', async () => {
  const userId = await createTestUser('lic@test.com');
  const result = {
    audioUrl: 'https://svc/audio/1.mp3',
    license: {
      assetSha256: SHA,
      assetId: 'track-1',
      title: 'Lo-fi 1',
      filename: '1.mp3',
      mimeType: 'audio/mpeg',
      bytes: 10,
      terms: { name: 'commercial', usage: ['web', 'social-media'], user: ['commercial'], attribution: false },
    },
  };
  const seen: { reference?: bigint } = {};
  const out = await callAndStore(
    { userId, service: 'music-generator', payload: { prompt: 'lofi' }, waitMs: 2000 },
    fakeCall(result, undefined, seen),
  );
  assert.equal(out.status, 'done');
  const lic = (out as { license?: Record<string, unknown> }).license;
  assert.ok(lic, 'la respuesta trae license');
  assert.match(String(lic!.id), /^lic_[0-9a-f]{20}$/);
  assert.equal(lic!.status, 'valid');
  assert.equal(lic!.assetSha256, SHA);
  assert.equal(lic!.payTo, PAY_TO);
  assert.ok(String(lic!.documentUrl).endsWith(`/v1/licenses/${lic!.id}/document`));

  const row = (await licenseForCall(out.resultId))!;
  assert.ok(row);
  // La huella que se pasó al pago es la del documento guardado.
  assert.equal(seen.reference, referenceOf(row.doc_sha256));
  assert.equal(String(lic!.reference), referenceOf(row.doc_sha256).toString());
  // El documento guardado es JSON canónico y su SHA-256 es la huella.
  assert.equal(sha256Hex(row.doc), row.doc_sha256);
  const doc = JSON.parse(row.doc);
  assert.equal(jcs(doc), row.doc);
  assert.equal(doc.kind, 'kiba-license/1');
  assert.equal(doc.id, row.id);
  assert.equal(doc.callId, out.resultId);
  assert.equal(doc.buyer.account, `urn:kiba:user:${userId}`);
  assert.deepEqual(doc.seller, { service: 'music-generator', payTo: PAY_TO });
  assert.equal(doc.asset.sha256, SHA);
  assert.equal(doc.asset.assetId, 'track-1');
  assert.deepEqual(doc.terms.usage, ['web', 'social-media']);
  assert.equal(doc.price.amountBaseUnits, '500000');
  assert.equal(doc.price.token, 'USDC');
  assert.equal(doc.asset.assetUrl, undefined, 'la URL de descarga caduca: no va en el documento');

  // Sin transacción todavía: pendiente, no verificada.
  const v0 = await verifyLicense(row, readerWith(undefined, false));
  assert.equal(v0.verified, false);
  assert.equal(v0.pending, true);
  assert.deepEqual(v0.checks, { document: true, paymentFound: false, paymentCommits: false, notRevoked: true });

  // Llega el enlace on-chain y la transacción lleva la huella: verificada.
  await attachSettlement(out.resultId, `https://stellar.expert/explorer/testnet/tx/${TX}`);
  const row2 = (await getLicense(row.id))!;
  assert.equal(row2.tx_hash, TX);
  const v1 = await verifyLicense(row2, readerWith(referenceOf(row.doc_sha256)));
  assert.equal(v1.verified, true);
  assert.equal(v1.pending, false);
  assert.deepEqual(v1.checks, { document: true, paymentFound: true, paymentCommits: true, notRevoked: true });
  assert.equal(v1.txHash, TX);
  // La lectura confirmada se recuerda: la siguiente verificación no vuelve a la cadena.
  const row3 = (await getLicense(row.id))!;
  assert.equal(row3.anchor_ok, true);
  const v2 = await verifyLicense(row3, async () => {
    throw new Error('no debería leer la cadena');
  });
  assert.equal(v2.verified, true);

  const dto = licenseDto(row3);
  assert.equal(dto.txHash, TX);
  assert.ok(String(dto.explorerUrl).includes(TX));
});

test('verify: una transacción con otra huella no verifica', async () => {
  const userId = await createTestUser('bad@test.com');
  const out = await callAndStore(
    { userId, service: 'x', payload: {}, waitMs: 2000 },
    fakeCall({ license: { assetSha256: SHA } }, `https://stellar.expert/explorer/testnet/tx/${TX}`),
  );
  const row = (await licenseForCall(out.resultId))!;
  assert.equal(row.tx_hash, TX, 'el hash viene con el resultado');
  const v = await verifyLicense(row, readerWith(12345n));
  assert.equal(v.verified, false);
  assert.deepEqual(v.checks, { document: true, paymentFound: true, paymentCommits: false, notRevoked: true });
  assert.equal((await getLicense(row.id))!.anchor_ok, false);
});

test('verify: un documento alterado en la base no pasa', async () => {
  const userId = await createTestUser('tamper@test.com');
  const out = await callAndStore({ userId, service: 'x', payload: {}, waitMs: 2000 }, fakeCall({ license: { assetSha256: SHA } }));
  const row = (await licenseForCall(out.resultId))!;
  const doc = JSON.parse(row.doc);
  doc.terms = { name: 'commercial', exclusive: true };
  await db.prepare('UPDATE licenses SET doc = ? WHERE id = ?').run(jcs(doc), row.id);
  const v = await verifyLicense((await getLicense(row.id))!, readerWith(referenceOf(row.doc_sha256)));
  assert.equal(v.verified, false);
  assert.equal((v.checks as { document: boolean }).document, false);
});

test('callAndStore: sin license (o con hash inválido) no se escribe nada', async () => {
  const userId = await createTestUser('nolic@test.com');
  const seen: { reference?: bigint } = {};
  const a = await callAndStore({ userId, service: 'world-clock', payload: {}, waitMs: 2000 }, fakeCall({ time: 'now' }, undefined, seen));
  assert.equal((a as { license?: unknown }).license, undefined);
  assert.equal(seen.reference, undefined, 'sin licencia el pago lleva el reference de siempre');
  assert.equal(await licenseForCall(a.resultId), null);
  const b = await callAndStore({ userId, service: 'x', payload: {}, waitMs: 2000 }, fakeCall({ license: { assetSha256: 'nope' } }));
  assert.equal(await licenseForCall(b.resultId), null);
});

test('revocación: verify falla aunque el pago sea correcto', async () => {
  const userId = await createTestUser('rev@test.com');
  const out = await callAndStore(
    { userId, service: 'music-generator', payload: {}, waitMs: 2000 },
    fakeCall({ license: { assetSha256: SHA } }, `https://stellar.expert/explorer/testnet/tx/${TX}`),
  );
  const row = (await licenseForCall(out.resultId))!;
  assert.equal(await revokeLicense(row.id, 'refund'), true);
  assert.equal(await revokeLicense(row.id, 'refund'), false, 'idempotente');
  const v = await verifyLicense((await getLicense(row.id))!, readerWith(referenceOf(row.doc_sha256)));
  assert.equal(v.verified, false);
  assert.equal(v.status, 'revoked');
  assert.deepEqual(v.checks, { document: true, paymentFound: true, paymentCommits: true, notRevoked: false });
});


test('callAndStore: el hash on-chain que llega antes que la licencia no se pierde', async () => {
  const userId = await createTestUser('early@test.com');
  const result = { license: { assetSha256: SHA, filename: 'a.png' } };
  // El enlace on-chain se avisa ANTES de que el servicio devuelva (y antes de emitir la licencia).
  const call = (async (a: { onExplorerUrl?: (u: string) => void }) => {
    a.onExplorerUrl?.(`https://stellar.expert/explorer/testnet/tx/${TX}`);
    await new Promise((r) => setTimeout(r, 50));
    return {
      result,
      cost: { lamports: 500_000, usd: 0.05 },
      mode: 'virtual',
      paidWith: 'credit',
      newBalance: { lamports: 0, usd: 0 },
      trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
    };
  }) as unknown as typeof callOnBehalf;
  const out = await callAndStore({ userId, service: 'media-catalog', payload: {}, waitMs: 2000 }, call);
  const row = (await licenseForCall(out.resultId))!;
  assert.equal(row.tx_hash, TX);
  assert.equal((out as { license?: { txHash?: string } }).license?.txHash, TX);
});
