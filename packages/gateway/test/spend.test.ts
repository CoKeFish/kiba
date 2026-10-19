// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import {
  SPEND_DEBT_CAP,
  UNLIMITED_ALLOWANCE,
  getSpendStatus,
  migrateLegacyWallet,
  parseSignedApprove,
  prepareActivation,
  prepareApprove,
  prepareWithdraw,
  reconcilePendingSpend,
  releaseSpend,
  reserveSpend,
  setLegacySignerLoader,
  setSpendChain,
  settleSpend,
  submitPrepared,
  type SpendChain,
} from '../src/spend';

const PASS = Networks.TESTNET;
const TOKEN = new Contract(new Asset('USDC', Keypair.random().publicKey()).contractId(PASS));
const COLLECTOR = Keypair.random().publicKey();
const USDC = (n: number) => Math.round(n * 1e7);

/** Cadena en memoria con la semántica del SAC: transfer_from exige saldo y permiso. */
class FakeChain implements SpendChain {
  balance = new Map<string, bigint>();
  allowance = new Map<string, bigint>();
  pulled = 0n;
  pulls = 0;
  pullDelayMs = 20;
  spender() {
    return COLLECTOR;
  }
  passphrase() {
    return PASS;
  }
  tokenContract() {
    return TOKEN.contractId();
  }
  async read(owner: string) {
    return { balance: this.balance.get(owner) ?? 0n, allowance: this.allowance.get(owner) ?? 0n };
  }
  /** Estado on-chain de cada tx enviada (para simular confirmaciones perdidas). */
  txs = new Map<string, 'success' | 'failed' | 'unknown'>();
  /** Si es true, la tx entra en la cadena pero la confirmación se pierde (pull lanza). */
  loseConfirmation = false;
  async pull(owner: string, amount: bigint, onHash?: (hash: string) => Promise<void>) {
    this.pulls++;
    const hash = `hash-${this.pulls}`;
    await onHash?.(hash);
    await new Promise((r) => setTimeout(r, this.pullDelayMs));
    const bal = this.balance.get(owner) ?? 0n;
    const allow = this.allowance.get(owner) ?? 0n;
    if (amount > bal || amount > allow) {
      this.txs.set(hash, 'failed');
      throw new Error(amount > bal ? 'saldo insuficiente' : 'permiso insuficiente');
    }
    this.balance.set(owner, bal - amount);
    this.allowance.set(owner, allow - amount);
    this.pulled += amount;
    this.txs.set(hash, 'success');
    if (this.loseConfirmation) throw new Error('timeout esperando confirmación');
    return hash;
  }
  async txStatus(hash: string) {
    return this.txs.get(hash) ?? 'unknown';
  }
  async latestLedger() {
    return 1000;
  }
  accounts = new Map<string, { trustline: boolean }>();
  created: string[] = [];
  submitted: string[] = [];
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
  async buildApprove(owner: string, amount: bigint, exp: number) {
    return approveTx(owner, COLLECTOR, amount, exp).toXDR();
  }
  /** Aplica el efecto de la tx como lo haría la red (solo los tipos que arma el gateway). */
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
    } else {
      const p = parseSignedApprove(signedXdr, { passphrase: PASS, tokenContract: this.tokenContract(), spender: COLLECTOR });
      this.allowance.set(p.owner, p.amount);
    }
    const hash = `bump-${tx.hash().toString('hex').slice(0, 8)}`;
    this.submitted.push(hash);
    return hash;
  }
}

const USDC_ASSET = new Asset('USDC', Keypair.random().publicKey());
function classicTx(source: string, op: xdr.Operation) {
  return new TransactionBuilder(new Account(source, '1'), { fee: '100', networkPassphrase: PASS })
    .addOperation(op)
    .setTimeout(600)
    .build();
}
/** Firma del hash como la devuelve Privy `signRawHash` (hex con 0x). */
const signHash = (kp: Keypair, hash: string) => '0x' + kp.sign(Buffer.from(hash, 'hex')).toString('hex');

function approveTx(owner: string, spender: string, amount: bigint, exp: number, contract = TOKEN, fn = 'approve') {
  return new TransactionBuilder(new Account(owner, '1'), { fee: '100', networkPassphrase: PASS })
    .addOperation(
      contract.call(
        fn,
        new Address(owner).toScVal(),
        new Address(spender).toScVal(),
        nativeToScVal(amount, { type: 'i128' }),
        nativeToScVal(exp, { type: 'u32' }),
      ),
    )
    .setTimeout(300)
    .build();
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

async function createTestUser(email: string, address?: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at, spend_address)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', '[]', `pk-${email}`, 0, now, address ?? null);
  return Number(result.lastInsertRowid);
}

async function debtOf(userId: number): Promise<number> {
  return ((await db.prepare('SELECT spend_debt FROM users WHERE id = ?').get(userId)) as { spend_debt: number }).spend_debt;
}

/** Espera a que terminen los cobros en vuelo (se disparan en segundo plano). */
const settled = (userId: number) => settleSpend(userId);

test('sin wallet vinculada no se anota nada', async () => {
  const u = await createTestUser('a@x.com');
  const r = await reserveSpend(u, USDC(0.1));
  assert.equal(r.ok, false);
});

test('anota al instante y cobra con transfer_from al llegar a la mitad del tope', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(5)));

  assert.deepEqual(await reserveSpend(u, USDC(0.2)), { ok: true, left: USDC(4.8) });
  assert.equal(await debtOf(u), USDC(0.2));
  assert.equal(chain.pulls, 0, 'por debajo de medio tope no cobra');

  assert.deepEqual(await reserveSpend(u, USDC(0.3)), { ok: true, left: USDC(4.5) }); // 0.5 = medio tope
  await settled(u);
  assert.equal(chain.pulled, BigInt(USDC(0.5)));
  assert.equal(await debtOf(u), 0);
  const st = await getSpendStatus(u);
  assert.equal(st.charges[0].status, 'settled');
  assert.equal(st.allowanceBaseUnits, USDC(4.5));
});

test('rechaza lo que supera min(saldo, permiso) on-chain', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(0.25)));
  assert.equal((await reserveSpend(u, USDC(0.3))).ok, false, 'pasa el permiso');

  chain.allowance.set(addr, BigInt(USDC(10)));
  chain.balance.set(addr, BigInt(USDC(0.25)));
  assert.equal((await reserveSpend(u, USDC(0.3))).ok, false, 'pasa el saldo');
  assert.equal(await debtOf(u), 0);
});

test('con muchas llamadas concurrentes la deuda nunca supera el tope', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(100)));
  chain.allowance.set(addr, BigInt(USDC(100)));
  chain.pullDelayMs = 150; // el cobro on-chain tarda: las llamadas siguen llegando mientras tanto

  let maxDebt = 0;
  const watch = setInterval(async () => {
    maxDebt = Math.max(maxDebt, await debtOf(u));
  }, 5);
  const results = await Promise.all(Array.from({ length: 30 }, () => reserveSpend(u, USDC(0.3))));
  await settled(u);
  clearInterval(watch);

  const served = results.filter((r) => r.ok).length * USDC(0.3);
  assert.ok(maxDebt <= SPEND_DEBT_CAP, `deuda máxima ${maxDebt} > tope ${SPEND_DEBT_CAP}`);
  assert.equal(Number(chain.pulled) + (await debtOf(u)), served, 'todo lo servido está cobrado o anotado');
  assert.ok(served > 0);
});

test('si el usuario vacía la wallet el cobro falla, bloquea la cuenta y la pérdida ≤ tope', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));

  assert.equal((await reserveSpend(u, USDC(0.3))).ok, true);
  chain.balance.set(addr, BigInt(USDC(0.1))); // vacía la wallet antes del cobro (por fuera de Kiba)
  // La siguiente se anota con el saldo guardado (no espera a la cadena) y la relee detrás…
  assert.equal((await reserveSpend(u, USDC(0.3))).ok, true, 'anota con el saldo guardado');
  await new Promise((r) => setTimeout(r, 50));
  // …así que la que sigue ya ve el saldo real y se frena.
  assert.equal((await reserveSpend(u, USDC(0.3))).ok, false, 'la relectura on-chain lo frena');

  await settled(u); // cobro de la deuda anotada (0.6) con 0.1 en la wallet → falla
  const st = await getSpendStatus(u);
  assert.equal(st.blocked, true);
  assert.equal(st.charges[0].status, 'failed');
  assert.ok(st.debtBaseUnits <= SPEND_DEBT_CAP);
  assert.equal((await reserveSpend(u, USDC(0.01))).ok, false, 'bloqueada');

  // Recarga la wallet: la siguiente llamada cobra lo pendiente y desbloquea.
  chain.balance.set(addr, BigInt(USDC(5)));
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, true);
  const after = await getSpendStatus(u);
  assert.equal(after.blocked, false);
  assert.equal(chain.pulled, BigInt(USDC(0.6)));
});

test('un fallo de red (con fondos) no bloquea la cuenta', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  await reserveSpend(u, USDC(0.2));
  chain.pull = async () => {
    throw new Error('timeout del RPC');
  };
  await settled(u);
  const st = await getSpendStatus(u);
  assert.equal(st.blocked, false);
  assert.equal(st.debtBaseUnits, USDC(0.2));
});

test('releaseSpend devuelve la reserva de una llamada fallida', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  await reserveSpend(u, USDC(0.2));
  await releaseSpend(u, USDC(0.2));
  assert.equal(await debtOf(u), 0);
});

test('parseSignedApprove acepta solo un approve de USDC al collector firmado por la dueña', () => {
  const owner = Keypair.random();
  const expect = { passphrase: PASS, tokenContract: TOKEN.contractId(), spender: COLLECTOR };
  const sign = (tx: ReturnType<typeof approveTx>, kp = owner) => {
    tx.sign(kp);
    return tx.toXDR();
  };

  const ok = parseSignedApprove(sign(approveTx(owner.publicKey(), COLLECTOR, 50n, 2000)), expect);
  assert.deepEqual(ok, { owner: owner.publicKey(), amount: 50n, expirationLedger: 2000 });

  assert.throws(() => parseSignedApprove(approveTx(owner.publicKey(), COLLECTOR, 50n, 2000).toXDR(), expect), /firma/);
  assert.throws(
    () => parseSignedApprove(sign(approveTx(owner.publicKey(), COLLECTOR, 50n, 2000), Keypair.random()), expect),
    /firma/,
  );
  assert.throws(
    () => parseSignedApprove(sign(approveTx(owner.publicKey(), Keypair.random().publicKey(), 50n, 2000)), expect),
    /no es para Kiba/,
  );
  const other = new Contract(new Asset('FAKE', Keypair.random().publicKey()).contractId(PASS));
  assert.throws(
    () => parseSignedApprove(sign(approveTx(owner.publicKey(), COLLECTOR, 50n, 2000, other)), expect),
    /USDC/,
  );
  assert.throws(
    () => parseSignedApprove(sign(approveTx(owner.publicKey(), COLLECTOR, 50n, 2000, TOKEN, 'transfer')), expect),
    /approve/,
  );
  // El approve de OTRA dirección firmado por un tercero (fuente distinta del owner).
  const victim = Keypair.random().publicKey();
  const forged = new TransactionBuilder(new Account(owner.publicKey(), '1'), { fee: '100', networkPassphrase: PASS })
    .addOperation(
      TOKEN.call(
        'approve',
        new Address(victim).toScVal(),
        new Address(COLLECTOR).toScVal(),
        nativeToScVal(50n, { type: 'i128' }),
        nativeToScVal(2000, { type: 'u32' }),
      ),
    )
    .setTimeout(300)
    .build();
  assert.throws(() => parseSignedApprove(sign(forged), expect), /dueña/);
});

test('si se pierde la confirmación de un cobro que sí entró, no se vuelve a cobrar', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  await reserveSpend(u, USDC(0.2));
  chain.loseConfirmation = true;
  await settled(u);
  chain.loseConfirmation = false;
  assert.equal(await debtOf(u), 0, 'la deuda se descuenta por el estado on-chain');
  await settled(u);
  assert.equal(chain.pulled, BigInt(USDC(0.2)), 'cobrado una sola vez');
  assert.equal((await getSpendStatus(u)).charges[0].status, 'settled');
});

test('un cobro enviado sin resultado conocido bloquea nuevos cobros hasta resolverse', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  await reserveSpend(u, USDC(0.2));
  // El proceso "muere" con el cobro en vuelo: la tx se envió pero nadie vio el resultado.
  const realPull = chain.pull.bind(chain);
  chain.pull = async (owner, amount, onHash) => {
    await onHash?.('hash-perdido');
    throw new Error('el proceso murió');
  };
  await settled(u);
  chain.pull = realPull;
  assert.equal((await getSpendStatus(u)).charges[0].status, 'pending');

  await settled(u);
  assert.equal(chain.pulls, 0, 'no cobra otra vez mientras el anterior siga sin resolver');

  chain.txs.set('hash-perdido', 'success'); // la cadena confirma que sí entró
  assert.equal(await reconcilePendingSpend(), 0);
  assert.equal(await debtOf(u), 0);
  assert.equal((await getSpendStatus(u)).charges[0].status, 'settled');
});

test('tras un fallo que no es por fondos espera antes de reintentar', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  await reserveSpend(u, USDC(0.2));
  let attempts = 0;
  chain.pull = async () => {
    attempts++;
    throw new Error('falta trustline en la treasury');
  };
  await settled(u);
  await settled(u);
  await settled(u);
  assert.equal(attempts, 1);
});

test('si otro proceso del gateway ya tiene un cobro en vuelo para el usuario, no cobra en paralelo', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  await reserveSpend(u, USDC(0.2));
  // Fila del otro proceso: recién creada, aún sin hash.
  await db
    .prepare(`INSERT INTO spend_charges (user_id, address, amount, status, created_at) VALUES (?, ?, ?, 'pending', ?)`)
    .run(u, addr, USDC(0.2), Math.floor(Date.now() / 1000));
  await settled(u);
  assert.equal(chain.pulls, 0);
});

// ─── Wallet de pagos: activar, firmar, retirar, migrar ─────────────────────

/** Recorre la activación completa como lo hace el dashboard con Privy (firma del hash). */
async function activate(userId: number, kp: Keypair) {
  const t = await prepareActivation(userId, kp.publicKey());
  if (t) await submitPrepared(userId, { hash: t.hash, signature: signHash(kp, t.hash) });
  const a = await prepareApprove(userId, { address: kp.publicKey(), kind: 'privy' });
  return submitPrepared(userId, { hash: a.hash, signature: signHash(kp, a.hash) });
}

test('activar: Kiba crea la cuenta, el usuario firma trustline y permiso sin tope', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  await activate(u, kp);
  assert.deepEqual(chain.created, [kp.publicKey()], 'la cuenta la crea Kiba (el usuario no necesita XLM)');
  assert.equal(chain.submitted.length, 2, 'trustline + permiso, ambos con comisión a cargo de Kiba');
  const st = await getSpendStatus(u);
  assert.equal(st.address, kp.publicKey());
  assert.equal(st.kind, 'privy');
  assert.equal(st.unlimited, true);
  assert.equal(st.allowanceBaseUnits, UNLIMITED_ALLOWANCE);
  assert.equal(await prepareActivation(u, kp.publicKey()), null, 'ya activa');

  // Con permiso sin tope el límite es el saldo: el agente gasta sin pedir firma.
  chain.balance.set(kp.publicKey(), BigInt(USDC(0.5)));
  assert.equal((await reserveSpend(u, USDC(0.3))).ok, true);
  assert.equal((await reserveSpend(u, USDC(0.3))).ok, false, 'no pasa del saldo');
});

test('solo se envía lo que preparó el gateway, firmado por la wallet correcta, una vez', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  const other = await createTestUser('b@x.com');
  chain.accounts.set(kp.publicKey(), { trustline: true });
  const a = await prepareApprove(u, { address: kp.publicKey() });

  await assert.rejects(() => submitPrepared(u, { hash: a.hash, signature: signHash(Keypair.random(), a.hash) }), /no corresponde/);
  await assert.rejects(() => submitPrepared(other, { hash: a.hash, signature: signHash(kp, a.hash) }), /no preparada/);
  const foreign = approveTx(kp.publicKey(), COLLECTOR, 5n, 2000);
  foreign.sign(kp);
  await assert.rejects(() => submitPrepared(u, { signedXdr: foreign.toXDR() }), /no preparada/);

  // XDR firmado (Stellar Wallets Kit) de la tx preparada: vale.
  const signed = TransactionBuilder.fromXDR(a.xdr, PASS) as Transaction;
  signed.sign(kp);
  await submitPrepared(u, { signedXdr: signed.toXDR() });
  await assert.rejects(() => submitPrepared(u, { hash: a.hash, signature: signHash(kp, a.hash) }), /ya enviada/);
  assert.equal(chain.submitted.length, 1);

  // La misma wallet no puede ser la de pagos de otra cuenta.
  await assert.rejects(() => prepareApprove(other, { address: kp.publicKey() }), /otra cuenta/);
});

test('retirar: cobra lo pendiente, retira el resto y congela el gasto mientras tanto', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  await activate(u, kp);
  chain.balance.set(kp.publicKey(), BigInt(USDC(5)));
  await reserveSpend(u, USDC(0.3));

  const dest = Keypair.random().publicKey();
  const noTrust = Keypair.random().publicKey();
  chain.accounts.set(noTrust, { trustline: false });
  await assert.rejects(() => prepareWithdraw(u, { to: noTrust }), /no acepta USDC/);
  await assert.rejects(() => prepareWithdraw(u, { to: Keypair.random().publicKey() }), /no existe/);
  chain.accounts.set(dest, { trustline: true });
  const w = await prepareWithdraw(u, { to: dest });
  assert.equal(chain.pulled, BigInt(USDC(0.3)), 'primero cobró la deuda');
  assert.equal(w.amountBaseUnits, USDC(4.7), 'retira lo que queda');
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, false, 'sin gasto con un retiro preparado');

  await submitPrepared(u, { hash: w.hash, signature: signHash(kp, w.hash) });
  assert.equal(chain.balance.get(dest), BigInt(USDC(4.7)));
  assert.equal(chain.balance.get(kp.publicKey()), 0n);
  await assert.rejects(() => prepareWithdraw(u, { to: dest }), /no hay saldo/);
  await assert.rejects(() => prepareWithdraw(u, { to: kp.publicKey() }), /misma wallet/);
});

test('revocar: un permiso de 0 corta el gasto', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  await activate(u, kp);
  chain.balance.set(kp.publicKey(), BigInt(USDC(5)));
  const r = await prepareApprove(u, { address: kp.publicKey(), amount: 0 });
  await submitPrepared(u, { hash: r.hash, signature: signHash(kp, r.hash) });
  const st = await getSpendStatus(u);
  assert.equal(st.allowanceBaseUnits, 0);
  assert.equal(st.expiresLedger, null);
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, false);
});

test('migrar: el USDC de la wallet anterior pasa a la wallet de pagos', async () => {
  const kp = Keypair.random();
  const legacy = Keypair.random();
  const u = await createTestUser('a@x.com');
  setLegacySignerLoader(async () => ({
    publicKey: () => legacy.publicKey(),
    signTransaction: async (tx: Transaction) => tx.sign(legacy),
  }));
  try {
    await assert.rejects(() => migrateLegacyWallet(u), /activa/);
    await activate(u, kp);
    chain.balance.set(legacy.publicKey(), BigInt(USDC(3.25)));
    const r = await migrateLegacyWallet(u);
    assert.equal(r.amountBaseUnits, USDC(3.25));
    assert.equal(chain.balance.get(kp.publicKey()), BigInt(USDC(3.25)));
    assert.equal(chain.balance.get(legacy.publicKey()), 0n);
    await assert.rejects(() => migrateLegacyWallet(u), /no tiene USDC/);
  } finally {
    setLegacySignerLoader(null);
  }
});

test('retirar con un cobro ya en vuelo también cobra lo anotado después', async () => {
  const kp = Keypair.random();
  const u = await createTestUser('a@x.com');
  await activate(u, kp);
  chain.balance.set(kp.publicKey(), BigInt(USDC(5)));
  chain.pullDelayMs = 150;
  await reserveSpend(u, USDC(0.2));
  const job = settleSpend(u); // el job periódico arranca a cobrar 0.2
  await reserveSpend(u, USDC(0.1)); // llega otra llamada mientras tanto
  const dest = Keypair.random().publicKey();
  chain.accounts.set(dest, { trustline: true });
  const w = await prepareWithdraw(u, { to: dest });
  await job;
  assert.equal(chain.pulled, BigInt(USDC(0.3)));
  assert.equal(w.amountBaseUnits, USDC(4.7));
});

test('si el RPC tarda, anota con el último saldo conocido (riesgo acotado por el tope)', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, true); // primera lectura: queda en caché
  const realRead = chain.read.bind(chain);
  chain.read = (owner) => new Promise((r) => setTimeout(() => r(realRead(owner)), 8_000).unref());
  const t0 = Date.now();
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, true);
  assert.ok(Date.now() - t0 < 4_000, `esperó ${Date.now() - t0} ms al RPC lento`);
  chain.read = realRead;
});

test('la última lectura sobrevive a un reinicio y a ratos sin uso; un retiro la invalida', async () => {
  const kp = Keypair.random();
  const addr = kp.publicKey();
  const u = await createTestUser('a@x.com');
  await activate(u, kp);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, true);
  await new Promise((r) => setTimeout(r, 100)); // la lectura se guarda en segundo plano
  // Reinicio (memoria vacía) + lectura de hace 1 h + RPC lento: usa la guardada en la DB.
  setSpendChain(chain);
  await db.prepare('UPDATE spend_reads SET read_at = read_at - 3600000 WHERE address = ?').run(addr);
  const realRead = chain.read.bind(chain);
  chain.read = (owner) => new Promise((r) => setTimeout(() => r(realRead(owner)), 8_000).unref());
  const t0 = Date.now();
  const r = await reserveSpend(u, USDC(0.1));
  assert.ok(r.ok && r.left === USDC(9.8), JSON.stringify(r));
  assert.ok(Date.now() - t0 < 4_000, `esperó ${Date.now() - t0} ms al RPC lento`);
  chain.read = realRead;

  // Un retiro enviado borra la lectura guardada.
  await settleSpend(u);
  const dest = Keypair.random().publicKey();
  chain.accounts.set(dest, { trustline: true });
  const w = await prepareWithdraw(u, { to: dest });
  await submitPrepared(u, { hash: w.hash, signature: signHash(kp, w.hash) });
  const left = await db.prepare('SELECT count(*) AS n FROM spend_reads WHERE address = ?').get(addr);
  assert.equal(Number((left as { n: number }).n), 0);
});

test('anota sin esperar a la cadena cuando hay un saldo guardado (la relee en segundo plano)', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(10)));
  chain.allowance.set(addr, BigInt(USDC(10)));
  assert.equal((await reserveSpend(u, USDC(0.1))).ok, true); // primera: lee la cadena
  const realRead = chain.read.bind(chain);
  let reads = 0;
  chain.read = (owner) => {
    reads++;
    return new Promise((r) => setTimeout(() => r(realRead(owner)), 300).unref());
  };
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) assert.equal((await reserveSpend(u, USDC(0.01))).ok, true);
  assert.ok(Date.now() - t0 < 250, `esperó ${Date.now() - t0} ms a la cadena`);
  assert.ok(reads >= 1 && reads <= 5, `relecturas en segundo plano: ${reads}`);
  chain.read = realRead;
});

test('una recarga reciente no falla por el saldo guardado viejo', async () => {
  const addr = Keypair.random().publicKey();
  const u = await createTestUser('a@x.com', addr);
  chain.balance.set(addr, BigInt(USDC(0.05)));
  chain.allowance.set(addr, BigInt(USDC(100)));
  assert.equal((await reserveSpend(u, USDC(0.01))).ok, true); // guarda saldo 0.05
  chain.balance.set(addr, BigInt(USDC(5))); // el usuario recarga
  const r = await reserveSpend(u, USDC(0.3)); // el guardado (0.05) no alcanza → relee
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(await debtOf(u), USDC(0.31));
});
