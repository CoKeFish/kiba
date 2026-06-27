import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Keypair,
  Account,
  Operation,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  Networks,
} from '@stellar/stellar-sdk';
import axios from 'axios';
import { TrustlessWorkEscrowClient } from '../src/chain/trustless-work';
import { LocalKeypairSigner, type StellarSigner } from '../src/chain/signer';

/**
 * Tests del TrustlessWorkEscrowClient con la API REST de TW mockeada (sin red).
 * Verifican el mapeo de roles/fee/amount/trustline, la firma del XDR y el flujo
 * deploy+fund → escrowId, release (change-status→approve→release) y getEscrow.
 * Los shapes/endpoints replican los confirmados contra la API viva (Fase 2).
 */

type Handler = (body: unknown) => { status: number; data: unknown };
const posted: Record<string, unknown> = {};
const postRoutes: Record<string, Handler> = {};
const getRoutes: Record<string, Handler> = {};

const origCreate = axios.create;
before(() => {
  // @ts-expect-error monkey-patch
  axios.create = () => ({
    post: async (url: string, body: unknown) => {
      posted[url] = body;
      const h = postRoutes[url];
      if (!h) throw new Error(`unexpected POST ${url}`);
      return h(body);
    },
    get: async (url: string) => {
      const h = getRoutes[url];
      if (!h) throw new Error(`unexpected GET ${url}`);
      return h(undefined);
    },
  });
});
after(() => {
  // @ts-expect-error restore
  axios.create = origCreate;
});
beforeEach(() => {
  for (const k of Object.keys(posted)) delete posted[k];
  for (const k of Object.keys(postRoutes)) delete postRoutes[k];
  for (const k of Object.keys(getRoutes)) delete getRoutes[k];
});

/** XDR de tx sin firmar válido (para que TransactionBuilder.fromXDR lo parsee). */
function unsignedXdr(): string {
  const src = new Account(Keypair.random().publicKey(), '1');
  return new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .setTimeout(30)
    .build()
    .toXDR();
}
const unsigned = () => ({ status: 201, data: { unsignedTransaction: unsignedXdr() } });

function makeClient() {
  const keypair = Keypair.random();
  const platform = Keypair.random().publicKey();
  const client = new TrustlessWorkEscrowClient(new LocalKeypairSigner(keypair), {
    apiUrl: 'https://dev.api.trustlesswork.com',
    apiKey: 'test-key',
    platformAddress: platform,
    platformFee: 5,
    trustline: { address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', symbol: 'USDC' },
    networkPassphrase: Networks.TESTNET,
    baseUnitsPerToken: 1e7,
    label: 'test',
  });
  return { client, keypair, platform };
}

test('deployAndFund: payload de deploy correcto + contractId del send + fund verificado', async () => {
  const { client, keypair, platform } = makeClient();
  const agentOwner = Keypair.random().publicKey();

  postRoutes['/deployer/single-release'] = () => unsigned();
  postRoutes['/helper/send-transaction'] = (body) => {
    const tx = new Transaction((body as { signedXdr: string }).signedXdr, Networks.TESTNET);
    assert.ok(tx.signatures.length >= 1, 'el XDR enviado debe ir firmado');
    return { status: 201, data: { status: 'SUCCESS', contractId: 'CESCROW123' } };
  };
  postRoutes['/escrow/single-release/fund-escrow'] = () => unsigned();
  // waitFor(balance>0) lee el indexer (array).
  getRoutes['/helper/get-escrow-by-contract-ids'] = () => ({
    status: 200,
    data: [{ contractId: 'CESCROW123', balance: 0.0005, amount: 0.0005, flags: {} }],
  });

  const { escrowId, signature } = await client.deployAndFund({
    agentOwner,
    service: 'translator-pro',
    engagementId: 'translator-pro-42',
    amountBaseUnits: 5000n, // 5000 / 1e7 = 0.0005
  });
  assert.equal(escrowId, 'CESCROW123');
  assert.ok(signature);

  const deploy = posted['/deployer/single-release'] as {
    signer: string;
    engagementId: string;
    amount: number;
    platformFee: number;
    trustline: { address: string; symbol: string };
    roles: Record<string, string>;
  };
  assert.equal(deploy.signer, keypair.publicKey());
  assert.equal(deploy.engagementId, 'translator-pro-42');
  assert.equal(deploy.amount, 0.0005);
  assert.equal(deploy.platformFee, 5);
  assert.equal(deploy.trustline.symbol, 'USDC');
  assert.equal(deploy.roles.receiver, agentOwner);
  assert.equal(deploy.roles.serviceProvider, agentOwner);
  assert.equal(deploy.roles.releaseSigner, agentOwner);
  assert.equal(deploy.roles.approver, agentOwner);
  assert.equal(deploy.roles.platformAddress, platform);
  assert.equal(deploy.roles.disputeResolver, platform);

  const fund = posted['/escrow/single-release/fund-escrow'] as { contractId: string; amount: number };
  assert.equal(fund.contractId, 'CESCROW123');
  assert.equal(fund.amount, 0.0005);
});

test('release: change-status (idx string) → approve → release-funds', async () => {
  const { client, keypair } = makeClient();
  postRoutes['/escrow/single-release/change-milestone-status'] = (body) => {
    const b = body as { contractId: string; milestoneIndex: unknown; newStatus: string };
    assert.equal(b.contractId, 'CESCROW123');
    assert.equal(b.milestoneIndex, '0'); // STRING, no número
    assert.equal(b.newStatus, 'completed');
    return unsigned();
  };
  postRoutes['/escrow/single-release/approve-milestone'] = (body) => {
    assert.equal((body as { approver: string }).approver, keypair.publicKey());
    return unsigned();
  };
  postRoutes['/escrow/single-release/release-funds'] = (body) => {
    assert.equal((body as { releaseSigner: string }).releaseSigner, keypair.publicKey());
    return unsigned();
  };
  postRoutes['/helper/send-transaction'] = () => ({ status: 201, data: { status: 'SUCCESS' } });
  getRoutes['/helper/get-escrow-by-contract-ids'] = () => ({
    status: 200,
    data: [{ contractId: 'CESCROW123', flags: { released: true } }],
  });

  const sig = await client.release('CESCROW123');
  assert.equal(sig, 'CESCROW123');
});

test('getEscrow: mapea balance/flags al ChainEscrowInfo neutral', async () => {
  const { client } = makeClient();
  getRoutes['/helper/get-escrow-by-contract-ids'] = () => ({
    status: 200,
    data: [{ contractId: 'CESCROW123', balance: 0.0005, amount: 0.0005, flags: { released: false } }],
  });
  const escrow = await client.getEscrow('CESCROW123');
  assert.ok(escrow);
  assert.equal(escrow!.amountBaseUnits, 5000n);
  assert.equal(escrow!.state, 'Pending');
});

test('getEscrow: flag released → Completed', async () => {
  const { client } = makeClient();
  getRoutes['/helper/get-escrow-by-contract-ids'] = () => ({
    status: 200,
    data: [{ contractId: 'CESCROW123', balance: 0.0005, flags: { released: true } }],
  });
  const escrow = await client.getEscrow('CESCROW123');
  assert.equal(escrow!.state, 'Completed');
});

/**
 * Firmante remoto estilo Privy: firma `tx.hash()` y la adjunta con `addSignature`,
 * sin tener el Keypair dentro del cliente. Prueba la MITAD Stellar del spike #1
 * (sin Privy): que firmar el hash + addSignature produce una firma que verifica
 * contra el hash, es decir, un XDR que la red aceptaría. Lo único que queda por
 * validar en vivo es que el `raw_sign` de Privy devuelva esa misma firma ed25519.
 */
class MockRemoteSigner implements StellarSigner {
  constructor(private readonly kp: Keypair) {}
  publicKey(): string {
    return this.kp.publicKey();
  }
  async signTransaction(tx: Transaction): Promise<void> {
    const sig = this.kp.sign(tx.hash()); // == lo que hará PrivyStellarSigner vía raw_sign
    tx.addSignature(this.kp.publicKey(), sig.toString('base64'));
  }
}

test('firmante remoto (hash→sign→addSignature) produce un XDR firmado válido', async () => {
  const kp = Keypair.random();
  const client = new TrustlessWorkEscrowClient(new MockRemoteSigner(kp), {
    apiUrl: 'https://dev.api.trustlesswork.com',
    apiKey: 'test-key',
    platformAddress: Keypair.random().publicKey(),
    platformFee: 5,
    trustline: { address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', symbol: 'USDC' },
    networkPassphrase: Networks.TESTNET,
    baseUnitsPerToken: 1e7,
    label: 'test-remote',
  });

  postRoutes['/deployer/single-release'] = () => unsigned();
  postRoutes['/helper/send-transaction'] = (body) => {
    const tx = new Transaction((body as { signedXdr: string }).signedXdr, Networks.TESTNET);
    assert.equal(tx.signatures.length, 1, 'el firmante remoto debe adjuntar 1 firma');
    assert.ok(
      kp.verify(tx.hash(), tx.signatures[0].signature()),
      'la firma remota debe verificar contra el hash de la tx',
    );
    return { status: 201, data: { status: 'SUCCESS', contractId: 'CESCROW_REMOTE' } };
  };
  postRoutes['/escrow/single-release/fund-escrow'] = () => unsigned();
  getRoutes['/helper/get-escrow-by-contract-ids'] = () => ({
    status: 200,
    data: [{ contractId: 'CESCROW_REMOTE', balance: 0.0005, amount: 0.0005, flags: {} }],
  });

  const { escrowId } = await client.deployAndFund({
    agentOwner: Keypair.random().publicKey(),
    service: 'svc',
    engagementId: 'svc-1',
    amountBaseUnits: 5000n,
  });
  assert.equal(escrowId, 'CESCROW_REMOTE');
});
