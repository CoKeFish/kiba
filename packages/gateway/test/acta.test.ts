// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los módulos del gateway.
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Account, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import { callAndStore } from '../src/results';
import { licenseForCall, getLicense } from '../src/licenses';
import { ActaClient, depositLicense, ensureIssuerDid, pendingDeposits, runActaQueueOnce } from '../src/acta';
import type { callOnBehalf } from '../src/proxy';

const signer = Keypair.random();
const holder = Keypair.random();

/** Servidor falso de ACTA + did.acta.build: registra lo que recibe y devuelve XDR reales sin firmar. */
const received: { path: string; body: Record<string, unknown> }[] = [];
let failIssueTimes = 0;
let server: http.Server;
let baseUrl: string;

function unsignedXdr(): string {
  const source = new Account(signer.publicKey(), '1');
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: 'kiba-test', value: 'x' }))
    .setTimeout(300)
    .build()
    .toXDR();
}

function signedBy(xdr: string, kp: Keypair): boolean {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  const hash = tx.hash();
  return tx.signatures.some((s) => kp.verify(hash, s.signature()));
}

before(async () => {
  await initDb();
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const path = req.url ?? '';
      received.push({ path, body });
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.headers['x-acta-key'] !== 'k-test' && !path.startsWith('/v1/dids')) return json(401, { error: 'unauthorized' });
      if (path === '/config') return json(200, { networkPassphrase: Networks.TESTNET, networkType: 'testnet' });
      if (path === '/v1/dids/stellar') return json(200, { xdr: unsignedXdr(), network: 'testnet', networkPassphrase: Networks.TESTNET });
      if (path === '/v1/dids/stellar/submit') {
        return signedBy(String(body.signedXdr), signer) ? json(200, { txId: 'did-tx-1' }) : json(400, { error: 'unsigned' });
      }
      if (path === '/contracts/sponsored-vault/create' || path === '/contracts/vc/issue') {
        if (!body.signedXdr) {
          if (path === '/contracts/vc/issue' && failIssueTimes > 0) {
            failIssueTimes--;
            return json(502, { error: 'rpc down' });
          }
          return json(200, { xdr: unsignedXdr(), network: 'testnet' });
        }
        if (!signedBy(String(body.signedXdr), signer)) return json(400, { error: 'bad signature' });
        return json(200, { tx_id: path.includes('vault') ? 'vault-tx-1' : 'issue-tx-1' });
      }
      return json(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  await db.exec('TRUNCATE issuer_identities, acta_vaults');
  received.length = 0;
  failIssueTimes = 0;
});

function client(): ActaClient {
  return new ActaClient({ apiKey: 'k-test', apiUrl: baseUrl, didApiUrl: baseUrl, signer, network: 'testnet' });
}

async function createUser(email: string, address: string | null): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const r = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at, stellar_address)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'x', '[]', address ?? `pk-${email}`, 0, now, address);
  return Number(r.lastInsertRowid);
}

const fakeCall = ((result: unknown) =>
  (async () => ({
    result,
    cost: { lamports: 500_000, usd: 0.05 },
    mode: 'virtual',
    paidWith: 'credit',
    newBalance: { lamports: 0, usd: 0 },
    trace: { service: 's', endpoint: 'e', totalDurationMs: 1, steps: [] },
  })) as unknown as typeof callOnBehalf) as (result: unknown) => typeof callOnBehalf;

const LICENSE = { license: { assetSha256: 'b'.repeat(64), filename: 'a.png', mimeType: 'image/png' } };

test('ensureIssuerDid: registra un did:stellar una sola vez y lo persiste', async () => {
  const c = client();
  const did = await ensureIssuerDid(c);
  assert.match(did, /^did:stellar:testnet:[a-z2-7]{26}$/);
  const prep = received.find((r) => r.path === '/v1/dids/stellar')!;
  const rec = prep.body.record as { controller: string; authentication: { publicKeyMultibase: string }[] };
  assert.equal(rec.controller, signer.publicKey());
  assert.match(rec.authentication[0].publicKeyMultibase, /^z6Mk/);
  assert.equal(prep.body.sourcePublicKey, signer.publicKey());
  received.length = 0;
  assert.equal(await ensureIssuerDid(c), did);
  assert.equal(received.length, 0, 'la segunda vez sale de la base de datos');
});

test('depositLicense: vault patrocinado + emisión; el DID del titular es su did:key', async () => {
  const userId = await createUser('h@test.com', holder.publicKey());
  const out = await callAndStore({ userId, service: 'media-catalog', payload: { assetId: 'x' }, waitMs: 2000 }, fakeCall(LICENSE));
  const row = (await licenseForCall(out.resultId))!;
  const vc = JSON.parse(row.vc);
  assert.match(vc.credentialSubject.id, /^did:key:z6Mk/);
  assert.equal(vc.credentialSubject.kibaAccount, `urn:kiba:user:${userId}`);

  assert.equal(await depositLicense(client(), row), 'done');
  const vault = received.find((r) => r.path === '/contracts/sponsored-vault/create' && !r.body.signedXdr)!;
  assert.equal(vault.body.sponsor, signer.publicKey());
  assert.equal(vault.body.owner, holder.publicKey());
  assert.equal(vault.body.didUri, vc.credentialSubject.id);
  const issue = received.find((r) => r.path === '/contracts/vc/issue' && !r.body.signedXdr)!;
  assert.equal(issue.body.owner, holder.publicKey());
  assert.equal(issue.body.vcId, row.id);
  assert.match(String(issue.body.issuer), /^did:stellar:testnet:/);
  assert.deepEqual(issue.body.vcData, vc, 'se deposita la credencial firmada por Kiba tal cual');
  const after1 = (await getLicense(row.id))!;
  assert.equal(after1.acta_vc_id, row.id);
  assert.equal(after1.acta_tx, 'issue-tx-1');
  assert.equal((await db.prepare('SELECT count(*)::int AS n FROM acta_vaults').get<{ n: number }>())!.n, 1);

  // Segunda licencia del mismo comprador: no se crea otro vault.
  received.length = 0;
  const out2 = await callAndStore({ userId, service: 'media-catalog', payload: { assetId: 'y' }, waitMs: 2000 }, fakeCall(LICENSE));
  await depositLicense(client(), (await licenseForCall(out2.resultId))!);
  assert.equal(received.filter((r) => r.path === '/contracts/sponsored-vault/create').length, 0);
});

test('depositLicense: sin wallet se omite; un fallo programa reintento y la cola lo recupera', async () => {
  const noWallet = await createUser('nw@test.com', null);
  const a = await callAndStore({ userId: noWallet, service: 's', payload: {}, waitMs: 2000 }, fakeCall(LICENSE));
  assert.equal(await depositLicense(client(), (await licenseForCall(a.resultId))!), 'skipped');

  const userId = await createUser('retry@test.com', holder.publicKey());
  const b = await callAndStore({ userId, service: 's', payload: {}, waitMs: 2000 }, fakeCall(LICENSE));
  failIssueTimes = 1;
  const row = (await licenseForCall(b.resultId))!;
  assert.equal(await depositLicense(client(), row), 'retry');
  const failed = (await getLicense(row.id))!;
  assert.equal(failed.acta_attempts, 1);
  assert.match(String(failed.acta_error), /502/);
  assert.ok((failed.acta_next_at ?? 0) > Math.floor(Date.now() / 1000), 'reintento en el futuro');
  assert.equal((await pendingDeposits()).length, 0, 'todavía no toca');
  await db.prepare('UPDATE licenses SET acta_next_at = 0 WHERE id = ?').run(row.id);
  assert.equal((await pendingDeposits()).map((r) => r.id).includes(row.id), true);
  assert.equal(await runActaQueueOnce(client()), 1);
  assert.equal((await getLicense(row.id))!.acta_tx, 'issue-tx-1');
});
