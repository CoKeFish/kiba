// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import {
  getSpendStatus,
  prepareActivation,
  prepareWithdraw,
  setSpendChain,
  submitPrepared,
  type PreparedTx,
  type SpendChain,
} from '../src/spend';

const PASS = Networks.TESTNET;
const USDC_ASSET = new Asset('USDC', Keypair.random().publicKey());
const TOKEN = new Contract(USDC_ASSET.contractId(PASS));
const USDC = (n: number) => Math.round(n * 1e7);

function classicTx(source: string, op: xdr.Operation) {
  return new TransactionBuilder(new Account(source, '1'), { fee: '100', networkPassphrase: PASS })
    .addOperation(op)
    .setTimeout(600)
    .build();
}
/** Firma del hash como la devuelve Privy `signRawHash` (hex con 0x). */
const signHash = (kp: Keypair, hash: string) => '0x' + kp.sign(Buffer.from(hash, 'hex')).toString('hex');

/** Red en memoria: cuentas, líneas de confianza y saldos de USDC. */
class FakeChain implements SpendChain {
  balance = new Map<string, bigint>();
  accounts = new Map<string, { trustline: boolean }>();
  created: string[] = [];
  submitted: string[] = [];
  passphrase() {
    return PASS;
  }
  tokenContract() {
    return TOKEN.contractId();
  }
  async read(owner: string) {
    return { balance: this.balance.get(owner) ?? 0n };
  }
  async latestLedger() {
    return 1000;
  }
  async accountState(owner: string) {
    const a = this.accounts.get(owner);
    return { exists: Boolean(a), trustline: Boolean(a?.trustline) };
  }
  async createAccount(owner: string) {
    this.created.push(owner);
    this.accounts.set(owner, { trustline: false });
    return `create-${owner.slice(0, 6)}`;
  }
  async buildTrustline(owner: string) {
    return classicTx(owner, Operation.changeTrust({ asset: USDC_ASSET })).toXDR();
  }
  async buildPayment(from: string, to: string, amount: bigint) {
    const s = amount.toString().padStart(8, '0');
    return classicTx(from, Operation.payment({ destination: to, asset: USDC_ASSET, amount: `${s.slice(0, -7)}.${s.slice(-7)}` })).toXDR();
  }
  /** Aplica el efecto de la tx como lo haría la red (solo los tipos que arma este módulo). */
  async submitSponsored(signedXdr: string) {
    const tx = TransactionBuilder.fromXDR(signedXdr, PASS) as Transaction;
    const op = tx.operations[0];
    if (op.type === 'changeTrust') this.accounts.set(tx.source, { trustline: true });
    else if (op.type === 'payment') {
      const amt = BigInt(Math.round(Number(op.amount) * 1e7));
      const bal = this.balance.get(tx.source) ?? 0n;
      if (amt > bal) throw new Error('op_underfunded');
      this.balance.set(tx.source, bal - amt);
      this.balance.set(op.destination, (this.balance.get(op.destination) ?? 0n) + amt);
    } else throw new Error(`operación inesperada: ${op.type}`);
    const hash = `bump-${tx.hash().toString('hex').slice(0, 8)}`;
    this.submitted.push(hash);
    return hash;
  }
}

let chain: FakeChain;

before(async () => {
  await initDb();
});

after(async () => {
  setSpendChain(null);
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  chain = new FakeChain();
  setSpendChain(chain);
});

async function createTestUser(email: string): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, balance_lamports, created_at)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', 0, Math.floor(Date.now() / 1000));
  return Number(result.lastInsertRowid);
}

/** El usuario firma el hash (como con Privy) y envía lo que preparó el gateway. */
const signAndSend = (userId: number, kp: Keypair, p: PreparedTx) =>
  submitPrepared(userId, { hash: p.hash, signature: signHash(kp, p.hash) });

/** Wallet nueva activada: Kiba crea la cuenta y el usuario firma que acepta USDC. */
async function activate(userId: number, kp: Keypair, kind: 'privy' | 'external' = 'privy') {
  const p = await prepareActivation(userId, kp.publicKey(), kind);
  assert.ok(p, 'una wallet nueva necesita aceptar USDC');
  await signAndSend(userId, kp, p!);
}

test('activar: Kiba crea la cuenta, el usuario firma que acepta USDC y la wallet queda vinculada', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  assert.equal((await getSpendStatus(u)).address, null);
  await activate(u, kp);
  assert.deepEqual(chain.created, [kp.publicKey()], 'la cuenta la crea Kiba (el usuario no necesita XLM)');
  assert.equal(chain.submitted.length, 1, 'una sola firma, con la comisión a cargo de Kiba');
  const st = await getSpendStatus(u);
  assert.equal(st.address, kp.publicKey());
  assert.equal(st.kind, 'privy');
  assert.equal(st.balanceBaseUnits, 0);
  assert.equal(await prepareActivation(u, kp.publicKey()), null, 'ya está lista');
});

test('una wallet que ya acepta USDC no necesita firma para activarse', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  chain.accounts.set(kp.publicKey(), { trustline: true });
  assert.equal(await prepareActivation(u, kp.publicKey(), 'external'), null);
  assert.equal(chain.created.length, 0);
  // Sin firma no hay prueba de que sea suya: no queda vinculada todavía.
  assert.equal((await getSpendStatus(u)).address, null);
  await assert.rejects(() => prepareActivation(u, 'no-es-una-direccion'), /inválida/);
});

test('solo se envía lo que preparó el gateway, firmado por la wallet correcta, una vez', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  const other = await createTestUser('b@x.com');
  const p = (await prepareActivation(u, kp.publicKey()))!;

  await assert.rejects(() => submitPrepared(u, { hash: p.hash, signature: signHash(Keypair.random(), p.hash) }), /no corresponde/);
  await assert.rejects(() => submitPrepared(other, { hash: p.hash, signature: signHash(kp, p.hash) }), /no preparada/);
  await assert.rejects(() => submitPrepared(u, {}), /falta la firma/);
  // Una transacción que no armó el gateway, aunque la firme la dueña, no se envía.
  const foreign = classicTx(kp.publicKey(), Operation.payment({ destination: Keypair.random().publicKey(), asset: USDC_ASSET, amount: '5' }));
  foreign.sign(kp);
  await assert.rejects(() => submitPrepared(u, { signedXdr: foreign.toXDR() }), /no preparada/);

  // XDR firmado (wallet externa) de la tx preparada: vale.
  const signed = TransactionBuilder.fromXDR(p.xdr, PASS) as Transaction;
  signed.sign(kp);
  await submitPrepared(u, { signedXdr: signed.toXDR() });
  await assert.rejects(() => signAndSend(u, kp, p), /ya enviada/);
  assert.equal(chain.submitted.length, 1);

  // La misma wallet no puede ser la de otra cuenta.
  await assert.rejects(() => prepareActivation(other, kp.publicKey()), /otra cuenta/);
});

test('una transacción preparada vence a los diez minutos', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  const p = (await prepareActivation(u, kp.publicKey()))!;
  await db.prepare('UPDATE spend_prepared SET created_at = created_at - 601 WHERE hash = ?').run(p.hash);
  await assert.rejects(() => signAndSend(u, kp, p), /venció/);
  assert.equal(chain.submitted.length, 0);
});

test('si el envío falla, la misma firma se puede reintentar', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  await activate(u, kp);
  chain.balance.set(kp.publicKey(), BigInt(USDC(1)));
  const dest = Keypair.random().publicKey();
  chain.accounts.set(dest, { trustline: true });
  const w = await prepareWithdraw(u, { to: dest });
  chain.balance.set(kp.publicKey(), 0n); // el saldo se fue antes de enviar
  await assert.rejects(() => signAndSend(u, kp, w), /op_underfunded/);
  chain.balance.set(kp.publicKey(), BigInt(USDC(1)));
  await signAndSend(u, kp, w);
  assert.equal(chain.balance.get(dest), BigInt(USDC(1)));
});

test('enviar USDC de la wallet a otra dirección lo firma el usuario', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  const dest = Keypair.random().publicKey();
  await assert.rejects(() => prepareWithdraw(u, { to: dest }), /no tienes una wallet/);
  await activate(u, kp);
  chain.balance.set(kp.publicKey(), BigInt(USDC(4)));

  await assert.rejects(() => prepareWithdraw(u, { to: 'x' }), /destino inválida/);
  await assert.rejects(() => prepareWithdraw(u, { to: kp.publicKey() }), /misma wallet/);
  await assert.rejects(() => prepareWithdraw(u, { to: dest }), /no existe/);
  chain.accounts.set(dest, { trustline: false });
  await assert.rejects(() => prepareWithdraw(u, { to: dest }), /no acepta USDC/);
  chain.accounts.set(dest, { trustline: true });
  await assert.rejects(() => prepareWithdraw(u, { to: dest, amount: USDC(5) }), /supera el saldo/);

  const part = await prepareWithdraw(u, { to: dest, amount: USDC(1.5) });
  assert.equal(part.amountBaseUnits, USDC(1.5));
  await signAndSend(u, kp, part);
  const rest = await prepareWithdraw(u, { to: dest }); // sin monto = todo
  assert.equal(rest.amountBaseUnits, USDC(2.5));
  await signAndSend(u, kp, rest);
  assert.equal(chain.balance.get(dest), BigInt(USDC(4)));
  assert.equal((await getSpendStatus(u)).balanceBaseUnits, 0);
  await assert.rejects(() => prepareWithdraw(u, { to: dest }), /no hay saldo/);

  const rows = (await db.prepare(`SELECT amount_lamports FROM transactions WHERE user_id = ? AND type = 'withdraw' ORDER BY id`).all(u)) as {
    amount_lamports: number;
  }[];
  assert.deepEqual(rows.map((r) => Number(r.amount_lamports)), [-USDC(1.5), -USDC(2.5)]);
});

