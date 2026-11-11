// _setup-env.ts establece DATABASE_URL/CHAIN/etc antes de que se carguen los
// módulos del gateway. Debe ir PRIMERO (ESM evalúa imports en orden).
import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { db, initDb, pool } from '../src/db';
import { getSpendStatus, setSpendChain, submitPrepared, type PreparedTx, type SpendChain } from '../src/spend';
import {
  CHANNEL_IDLE_DAYS,
  CHANNEL_MIN_DEPOSIT,
  CHANNEL_SETTLE_THRESHOLD,
  CHANNEL_TTL_EXTEND_LEDGERS,
  CHANNEL_TTL_MIN_LEDGERS,
  CHANNEL_WAIT_LEDGERS,
  channelAvailable,
  commitmentBytes,
  confirmChannel,
  releaseChannel,
  reserveChannel,
  runChannelJob,
  getChannelStatus,
  hasOpenChannel,
  liquidateChannel,
  prepareChannelCloseStart,
  prepareChannelOpen,
  prepareChannelRefund,
  prepareChannelTopUp,
  setChannelChain,
  settleChannel,
  type ChannelChain,
  type ChannelOnChain,
} from '../src/channel';

const PASS = Networks.TESTNET;
const TOKEN = new Contract(new Asset('USDC', Keypair.random().publicKey()).contractId(PASS));
const FACTORY = new Contract(StrKey.encodeContract(randomBytes(32)));
const TREASURY = Keypair.random().publicKey();
const USDC = (n: number) => Math.round(n * 1e7);
/** Vida con la que nace un canal en la red de prueba: 7 días. */
const NEW_CHANNEL_TTL = 120_960;
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

interface FakeChannel {
  /** Hasta qué ledger tiene pagada su vida; por debajo del ledger actual está archivado. */
  liveUntil: number;
  owner: string;
  key: Buffer;
  balance: bigint;
  withdrawn: bigint;
  wait: number;
  closeAt: number | null;
}

/**
 * Red en memoria con la semántica del contrato one-way-channel: el depósito sale de la wallet,
 * `settle`/`close` exigen un compromiso firmado con la clave del canal y solo pagan la
 * diferencia con lo ya cobrado, `close` devuelve el resto, `refund` exige que pase la espera.
 */
class FakeNet implements ChannelChain {
  ledger = 1000;
  wallets = new Map<string, bigint>();
  accounts = new Map<string, { trustline: boolean }>();
  channels = new Map<string, FakeChannel>();
  opened = new Map<string, string>();
  treasury = 0n;
  failClose = false;
  /** La wallet del usuario no puede recibir la devolución (p. ej. dejó de aceptar USDC). */
  refundBroken = false;

  // ── lo que el canal usa de la cadena de la wallet (spend.ts) ──
  spend = {
    passphrase: () => PASS,
    tokenContract: () => TOKEN.contractId(),
    latestLedger: async () => this.ledger,
    accountState: async (owner: string) => {
      const a = this.accounts.get(owner);
      return { exists: Boolean(a), trustline: Boolean(a?.trustline) };
    },
    read: async (owner: string) => ({ balance: this.wallets.get(owner) ?? 0n, allowance: 0n }),
    submitSponsored: async (signedXdr: string) => this.apply(signedXdr),
  } as unknown as SpendChain;

  private tx(owner: string, op: xdr.Operation): string {
    return new TransactionBuilder(new Account(owner, '1'), { fee: '100', networkPassphrase: PASS })
      .addOperation(op)
      .setTimeout(600)
      .build()
      .toXDR();
  }

  /** Aplica una transacción firmada por el usuario como lo haría la red. */
  private apply(signedXdr: string): string {
    const tx = TransactionBuilder.fromXDR(signedXdr, PASS) as Transaction;
    const call = (tx.operations[0] as { func: xdr.HostFunction }).func.invokeContract();
    const contract = Address.fromScAddress(call.contractAddress()).toString();
    const fn = call.functionName().toString();
    const args = call.args();
    const hash = `tx-${tx.hash().toString('hex').slice(0, 10)}`;
    const pay = (owner: string, amount: bigint) => {
      const bal = this.wallets.get(owner) ?? 0n;
      if (amount > bal) throw new Error('saldo insuficiente');
      this.wallets.set(owner, bal - amount);
    };
    if (fn === 'open') {
      assert.equal(contract, FACTORY.contractId());
      const owner = Address.fromScVal(args[2]).toString();
      assert.equal(owner, tx.source);
      assert.equal(Address.fromScVal(args[4]).toString(), TREASURY);
      const amount = BigInt(scValToNative(args[5]) as bigint);
      pay(owner, amount);
      const id = StrKey.encodeContract(randomBytes(32));
      this.channels.set(id, {
        liveUntil: this.ledger + NEW_CHANNEL_TTL,
        owner,
        key: Buffer.from(args[3].bytes()),
        balance: amount,
        withdrawn: 0n,
        wait: Number(scValToNative(args[6])),
        closeAt: null,
      });
      this.opened.set(hash, id);
      return hash;
    }
    const ch = this.channels.get(contract);
    if (!ch) throw new Error('canal inexistente');
    if (ch.liveUntil < this.ledger) throw new Error('canal archivado');
    assert.equal(ch.owner, tx.source, 'solo el dueño del depósito firma estas operaciones');
    if (fn === 'top_up') {
      const amount = BigInt(scValToNative(args[0]) as bigint);
      pay(ch.owner, amount);
      ch.balance += amount;
    } else if (fn === 'close_start') {
      if (ch.closeAt !== null && this.ledger >= ch.closeAt) throw new Error('AlreadyClosed');
      ch.closeAt = this.ledger + ch.wait;
    } else if (fn === 'refund') {
      if (ch.closeAt === null) throw new Error('NotClosed');
      if (this.ledger < ch.closeAt) throw new Error('RefundWaitingPeriodNotElapsed');
      this.wallets.set(ch.owner, (this.wallets.get(ch.owner) ?? 0n) + ch.balance);
      ch.balance = 0n;
    } else {
      throw new Error(`función inesperada: ${fn}`);
    }
    return hash;
  }

  // ── ChannelChain ──
  recipient() {
    return TREASURY;
  }
  commitment(channel: string, amount: bigint) {
    return commitmentBytes(PASS, channel, amount);
  }
  async buildOpen(a: { owner: string; salt: Buffer; commitmentKey: Buffer; amount: bigint; waitLedgers: number }) {
    return this.tx(
      a.owner,
      FACTORY.call(
        'open',
        xdr.ScVal.scvBytes(a.salt),
        new Address(TOKEN.contractId()).toScVal(),
        new Address(a.owner).toScVal(),
        xdr.ScVal.scvBytes(a.commitmentKey),
        new Address(TREASURY).toScVal(),
        i128(a.amount),
        nativeToScVal(a.waitLedgers, { type: 'u32' }),
      ),
    );
  }
  async buildTopUp(owner: string, channel: string, amount: bigint) {
    return this.tx(owner, new Contract(channel).call('top_up', i128(amount)));
  }
  async buildCloseStart(owner: string, channel: string) {
    return this.tx(owner, new Contract(channel).call('close_start'));
  }
  async buildRefund(owner: string, channel: string) {
    return this.tx(owner, new Contract(channel).call('refund'));
  }
  async openedChannel(hash: string) {
    const id = this.opened.get(hash);
    if (!id) throw new Error('apertura sin resultado');
    return id;
  }
  async read(channel: string) {
    const ch = this.channels.get(channel)!;
    return { balance: ch.balance, withdrawn: ch.withdrawn };
  }
  async inspect(channels: string[]) {
    return new Map(
      channels.map((c) => {
        const ch = this.channels.get(c)!;
        return [c, { closeEffective: ch.closeAt, liveUntil: ch.liveUntil >= this.ledger ? ch.liveUntil : null }] as [string, ChannelOnChain];
      }),
    );
  }
  renewals: string[] = [];
  async keepAlive(channel: string) {
    this.channels.get(channel)!.liveUntil = this.ledger + CHANNEL_TTL_EXTEND_LEDGERS;
    this.renewals.push(channel);
    return `renew-${this.renewals.length}`;
  }
  async maintainFactory() {}
  /** El usuario pide el retiro directamente al contrato, sin pasar por Kiba. */
  externalCloseStart(channel: string) {
    const ch = this.channels.get(channel)!;
    ch.closeAt = this.ledger + ch.wait;
  }
  /** Pasada la espera, el usuario retira directamente del contrato todo lo que quede. */
  externalRefund(channel: string) {
    const ch = this.channels.get(channel)!;
    if (ch.closeAt === null || this.ledger < ch.closeAt) throw new Error('RefundWaitingPeriodNotElapsed');
    this.wallets.set(ch.owner, (this.wallets.get(ch.owner) ?? 0n) + ch.balance);
    ch.balance = 0n;
  }
  private withdraw(channel: string, amount: bigint, sig: Buffer): FakeChannel {
    const ch = this.channels.get(channel);
    if (!ch) throw new Error('canal inexistente');
    if (ch.liveUntil < this.ledger) throw new Error('canal archivado');
    const key = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(ch.key));
    if (!key.verify(this.commitment(channel, amount), sig)) throw new Error('firma del compromiso inválida');
    const payout = amount - ch.withdrawn;
    if (payout > 0n) {
      if (payout > ch.balance) throw new Error('el compromiso supera el depósito');
      ch.withdrawn = amount;
      ch.balance -= payout;
      this.treasury += payout;
    }
    return ch;
  }
  settles = 0;
  async settle(channel: string, amount: bigint, sig: Buffer) {
    this.withdraw(channel, amount, sig);
    return `settle-${++this.settles}`;
  }
  async close(channel: string, amount: bigint, sig: Buffer) {
    if (this.failClose) throw new Error('red caída');
    const ch = this.withdraw(channel, amount, sig);
    if (ch.closeAt === null || ch.closeAt > this.ledger) ch.closeAt = this.ledger;
    if (!this.refundBroken) {
      this.wallets.set(ch.owner, (this.wallets.get(ch.owner) ?? 0n) + ch.balance);
      ch.balance = 0n;
    }
    return `close-${channel.slice(0, 6)}`;
  }

  /** Wallet lista para depositar: cuenta creada, acepta USDC y tiene saldo. */
  fund(kp: Keypair, usdc: number) {
    this.accounts.set(kp.publicKey(), { trustline: true });
    this.wallets.set(kp.publicKey(), BigInt(USDC(usdc)));
  }
}

let net: FakeNet;

before(async () => {
  await initDb();
});

after(async () => {
  setSpendChain(null);
  setChannelChain(null);
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
  net = new FakeNet();
  setSpendChain(net.spend);
  setChannelChain(net);
});

async function createTestUser(email: string): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake-hash', '[]', `pk-${email}`, 0, Math.floor(Date.now() / 1000));
  return Number(result.lastInsertRowid);
}

/** El usuario firma (como una wallet externa: XDR completo) y envía lo que preparó el gateway. */
async function signAndSend(userId: number, kp: Keypair, p: PreparedTx) {
  const tx = TransactionBuilder.fromXDR(p.xdr, PASS) as Transaction;
  tx.sign(kp);
  return submitPrepared(userId, { signedXdr: tx.toXDR() });
}

/** Abre un canal con `usdc` de depósito para un usuario nuevo con 10 USDC en la wallet. */
async function openChannel(email: string, usdc: number) {
  const user = await createTestUser(email);
  const kp = Keypair.random();
  net.fund(kp, 10);
  await signAndSend(user, kp, await prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(usdc) }));
  return { user, kp };
}

/** Anota consumo (lo hará cada llamada; aquí directo en la base de datos). */
const spend = (userId: number, usdc: number) =>
  db.prepare(`UPDATE pay_channels SET spent = spent + ? WHERE user_id = ? AND status = 'open'`).run(USDC(usdc), userId);
const wallet = (kp: Keypair) => Number(net.wallets.get(kp.publicKey()) ?? 0n);

test('abrir el canal mueve el depósito de la wallet al canal', async () => {
  const { user, kp } = await openChannel('a@x.com', 4);
  assert.equal(wallet(kp), USDC(6));
  const st = await getChannelStatus(user);
  assert.equal(st.enabled, true);
  assert.equal(st.channel?.state, 'open');
  assert.equal(st.channel?.depositedBaseUnits, USDC(4));
  assert.equal(st.channel?.availableBaseUnits, USDC(4));
  assert.equal(st.channel?.waitLedgers, CHANNEL_WAIT_LEDGERS);
  assert.equal(Number(net.channels.get(st.channel!.channel)!.balance), USDC(4));
  assert.equal(await hasOpenChannel(user), true);
  assert.deepEqual(
    st.moves.map((m) => [m.kind, m.amount]),
    [['open', USDC(4)]],
  );
  // Firmó la apertura con esa wallet: queda vinculada a su cuenta.
  const w = await getSpendStatus(user);
  assert.equal(w.address, kp.publicKey());
  assert.equal(w.balanceBaseUnits, USDC(6));
});

test('el saldo que ve el usuario es uno solo: créditos más lo que queda del depósito', async () => {
  const { getUserBalances } = await import('../src/wallets');
  const { user } = await openChannel('a@x.com', 4);
  await db.prepare('UPDATE users SET balance_lamports = ? WHERE id = ?').run(USDC(1), user);
  const r = await reserveChannel(user, USDC(0.25));
  if (r.ok) await confirmChannel(r);
  assert.equal((await getUserBalances(user)).totalBaseUnits, USDC(1) + USDC(4) - USDC(0.25));
});

test('abrir exige wallet activada, depósito mínimo y saldo suficiente', async () => {
  const user = await createTestUser('a@x.com');
  const kp = Keypair.random();
  await assert.rejects(prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(2) }), /activa la wallet/);
  net.fund(kp, 3);
  await assert.rejects(prepareChannelOpen(user, { address: kp.publicKey(), amount: CHANNEL_MIN_DEPOSIT - 1 }), /mínimo/);
  await assert.rejects(prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(5) }), /no tiene ese monto/);
  await assert.rejects(prepareChannelOpen(user, { address: 'no-es-una-direccion', amount: USDC(2) }), /inválida/);
  assert.equal((await getChannelStatus(user)).channel, null);
});

test('una apertura preparada no cuenta hasta que el usuario la firma', async () => {
  const user = await createTestUser('a@x.com');
  const kp = Keypair.random();
  net.fund(kp, 10);
  await prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(2) });
  assert.equal(await hasOpenChannel(user), false);
  assert.equal(wallet(kp), USDC(10));
  // Puede preparar otra (p. ej. con otro monto) y firmar esa.
  await signAndSend(user, kp, await prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(3) }));
  assert.equal((await getChannelStatus(user)).channel?.depositedBaseUnits, USDC(3));
});

test('solo el dueño de la wallet puede firmar la apertura', async () => {
  const user = await createTestUser('a@x.com');
  const kp = Keypair.random();
  net.fund(kp, 10);
  const p = await prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(2) });
  await assert.rejects(signAndSend(user, Keypair.random(), p), /no corresponde a la wallet/);
  assert.equal(await hasOpenChannel(user), false);
});

test('un canal vivo por usuario y por wallet', async () => {
  const { user, kp } = await openChannel('a@x.com', 2);
  await assert.rejects(prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(2) }), /ya tienes un depósito/);
  const other = await createTestUser('b@x.com');
  await assert.rejects(prepareChannelOpen(other, { address: kp.publicKey(), amount: USDC(2) }), /otra cuenta/);
});

test('recargar suma al depósito', async () => {
  const { user, kp } = await openChannel('a@x.com', 2);
  await signAndSend(user, kp, await prepareChannelTopUp(user, USDC(1.5)));
  const st = await getChannelStatus(user);
  assert.equal(st.channel?.depositedBaseUnits, USDC(3.5));
  assert.equal(wallet(kp), USDC(6.5));
  await assert.rejects(prepareChannelTopUp(user, USDC(50)), /no tiene ese monto/);
  await assert.rejects(prepareChannelTopUp(user, 0), /inválido/);
});

test('liquidar: Kiba cobra lo consumido y el resto vuelve a la wallet en un solo paso', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await spend(user, 1.3);
  const r = await liquidateChannel(user);
  assert.equal(r.paidBaseUnits, USDC(1.3));
  assert.equal(r.refundedBaseUnits, USDC(3.7));
  assert.equal(r.pendingBaseUnits, 0);
  assert.equal(Number(net.treasury), USDC(1.3));
  assert.equal(wallet(kp), USDC(5 + 3.7));
  const st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closed');
  assert.equal(st.channel?.availableBaseUnits, 0);
  assert.equal(await hasOpenChannel(user), false);
  await assert.rejects(liquidateChannel(user), /no tienes un depósito/);
  // Cerrado el canal, puede abrir otro.
  await signAndSend(user, kp, await prepareChannelOpen(user, { address: kp.publicKey(), amount: USDC(2) }));
  assert.equal((await getChannelStatus(user)).channel?.state, 'open');
});

test('liquidar sin consumo devuelve todo el depósito', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  const r = await liquidateChannel(user);
  assert.equal(r.paidBaseUnits, 0);
  assert.equal(r.refundedBaseUnits, USDC(5));
  assert.equal(Number(net.treasury), 0);
  assert.equal(wallet(kp), USDC(10));
});

test('si la liquidación falla, el canal sigue abierto', async () => {
  const { user } = await openChannel('a@x.com', 5);
  await spend(user, 1);
  net.failClose = true;
  await assert.rejects(liquidateChannel(user), /red caída/);
  assert.equal((await getChannelStatus(user)).channel?.state, 'open');
  net.failClose = false;
  assert.equal((await liquidateChannel(user)).paidBaseUnits, USDC(1));
});

test('cobro sin cerrar: solo paga la diferencia con lo ya cobrado', async () => {
  const { user } = await openChannel('a@x.com', 5);
  assert.equal(await settleChannel(user), null);
  await spend(user, 0.4);
  assert.ok(await settleChannel(user));
  assert.equal(Number(net.treasury), USDC(0.4));
  assert.equal(await settleChannel(user), null);
  await spend(user, 0.6);
  await settleChannel(user);
  assert.equal(Number(net.treasury), USDC(1));
  const st = await getChannelStatus(user);
  assert.equal(st.channel?.settledBaseUnits, USDC(1));
  assert.equal(st.channel?.state, 'open');
  // La liquidación posterior solo cobra lo nuevo.
  await spend(user, 0.2);
  const r = await liquidateChannel(user);
  assert.equal(r.paidBaseUnits, USDC(0.2));
  assert.equal(r.refundedBaseUnits, USDC(3.8));
  assert.equal(Number(net.treasury), USDC(1.2));
});

test('Kiba no puede cobrar más de lo que respalda la clave del canal', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const channel = (await getChannelStatus(user)).channel!.channel;
  // Un compromiso firmado con otra clave no vale.
  const forged = Keypair.random().sign(commitmentBytes(PASS, channel, BigInt(USDC(2))));
  await assert.rejects(net.settle(channel, BigInt(USDC(2)), forged), /firma del compromiso/);
  // Y un consumo anotado por encima del depósito no se puede cobrar.
  await spend(user, 3);
  await assert.rejects(settleChannel(user), /supera el depósito/);
  assert.equal(Number(net.treasury), 0);
});

test('retiro con espera: pedirlo, que Kiba cobre lo consumido y retirar el resto al vencer', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await spend(user, 1.5);
  await signAndSend(user, kp, await prepareChannelCloseStart(user));
  let st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closing');
  assert.equal(st.channel?.closeEffectiveLedger, net.ledger + CHANNEL_WAIT_LEDGERS);
  assert.ok(st.channel?.refundAt);
  assert.equal(await hasOpenChannel(user), false);
  // Kiba cobró lo consumido al enterarse del retiro.
  assert.equal(Number(net.treasury), USDC(1.5));
  // Antes del plazo no hay retiro; tampoco recargas.
  await assert.rejects(prepareChannelRefund(user), /disponible en unos/);
  await assert.rejects(prepareChannelTopUp(user, USDC(1)), /no tienes un depósito abierto/);
  net.ledger += CHANNEL_WAIT_LEDGERS;
  const p = await prepareChannelRefund(user);
  assert.equal(p.amountBaseUnits, USDC(3.5));
  await signAndSend(user, kp, p);
  assert.equal(wallet(kp), USDC(5 + 3.5));
  st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closed');
  assert.deepEqual(
    st.moves.map((m) => m.kind),
    ['refund', 'settle', 'close_start', 'open'],
  );
});

test('durante la espera Kiba también puede liquidar de inmediato', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await spend(user, 1);
  await signAndSend(user, kp, await prepareChannelCloseStart(user));
  const r = await liquidateChannel(user);
  assert.equal(r.paidBaseUnits, 0); // ya se cobró al pedir el retiro
  assert.equal(r.refundedBaseUnits, USDC(4));
  assert.equal(wallet(kp), USDC(9));
  assert.equal((await getChannelStatus(user)).channel?.state, 'closed');
});

test('el retiro no se puede preparar sin haberlo pedido', async () => {
  const { user } = await openChannel('a@x.com', 2);
  await assert.rejects(prepareChannelRefund(user), /primero pide el retiro/);
});

// ─── Consumo por llamada y cobro por tandas ─────────────────────────────────

/** Una llamada servida: aparta el precio y lo confirma. */
async function call(userId: number, usdc: number) {
  const r = await reserveChannel(userId, USDC(usdc));
  assert.equal(r.ok, true, 'la llamada debía caber en el depósito');
  if (r.ok) await confirmChannel(r);
}
const treasuryIs = async (usdc: number) => {
  for (let i = 0; i < 100 && Number(net.treasury) !== USDC(usdc); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(Number(net.treasury), USDC(usdc));
  // El cobro termina cuando queda anotado como movimiento, no cuando llega el dinero.
  for (let i = 0; i < 100; i++) {
    const { n } = (await db.prepare(`SELECT COUNT(*) AS n FROM pay_channel_moves WHERE kind = 'settle'`).get()) as { n: number };
    if (Number(n) >= net.settles) break;
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('una llamada aparta su precio y, al servirse, pasa a consumido', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const r = await reserveChannel(user, USDC(0.03));
  assert.ok(r.ok && r.left === USDC(1.97));
  assert.equal(await channelAvailable(user), USDC(1.97));
  let st = await getChannelStatus(user);
  assert.equal(st.channel?.spentBaseUnits, 0); // aún no es consumo
  assert.equal(st.channel?.availableBaseUnits, USDC(1.97));
  if (r.ok) await confirmChannel(r);
  st = await getChannelStatus(user);
  assert.equal(st.channel?.spentBaseUnits, USDC(0.03));
  assert.equal(st.channel?.availableBaseUnits, USDC(1.97));
  assert.equal(Number(net.treasury), 0); // por debajo del umbral no se cobra todavía
});

test('si la llamada falla, lo apartado vuelve a estar disponible', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const r = await reserveChannel(user, USDC(0.5));
  assert.ok(r.ok);
  if (r.ok) await releaseChannel(r);
  assert.equal(await channelAvailable(user), USDC(2));
  assert.equal((await getChannelStatus(user)).channel?.spentBaseUnits, 0);
});

test('sin depósito o sin saldo suficiente no se aparta nada', async () => {
  const nobody = await createTestUser('b@x.com');
  assert.deepEqual(await reserveChannel(nobody, USDC(0.1)), { ok: false, reason: 'none', available: 0 });
  assert.equal(await channelAvailable(nobody), null);
  const { user } = await openChannel('a@x.com', 1);
  await call(user, 0.9);
  assert.deepEqual(await reserveChannel(user, USDC(0.2)), { ok: false, reason: 'insufficient', available: USDC(0.1) });
  await treasuryIs(0.9); // el cobro por umbral corre en segundo plano
});

test('llamadas simultáneas nunca apartan más de lo depositado', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const rs = await Promise.all(Array.from({ length: 30 }, () => reserveChannel(user, USDC(0.1))));
  assert.equal(rs.filter((r) => r.ok).length, 20);
  assert.equal(await channelAvailable(user), 0);
});

test('al llegar al umbral Kiba cobra lo consumido en una sola transacción', async () => {
  const { user } = await openChannel('a@x.com', 2);
  assert.ok(CHANNEL_SETTLE_THRESHOLD === USDC(0.1));
  await call(user, 0.04);
  await call(user, 0.04);
  assert.equal(net.settles, 0);
  await call(user, 0.04); // 0.12 sin cobrar ≥ 0.10
  await treasuryIs(0.12);
  assert.equal(net.settles, 1);
  const st = await getChannelStatus(user);
  assert.equal(st.channel?.settledBaseUnits, USDC(0.12));
  assert.deepEqual(st.moves[0] && [st.moves[0].kind, st.moves[0].amount], ['settle', USDC(0.12)]);
});

test('el job cobra lo que lleva demasiado sin cobrar aunque no llegue al umbral', async () => {
  const { user } = await openChannel('a@x.com', 2);
  await call(user, 0.04);
  await runChannelJob();
  assert.equal(net.settles, 0); // reciente y bajo el umbral: espera
  await db.prepare('UPDATE pay_channels SET unsettled_since = unsettled_since - 3600 WHERE user_id = ?').run(user);
  await runChannelJob();
  await treasuryIs(0.04);
  await call(user, 0.01); // el reloj vuelve a contar desde el consumo nuevo
  await runChannelJob();
  assert.equal(net.settles, 1);
});

test('lo apartado por una llamada que nunca terminó se suelta, y si termina tarde cuenta igual', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const r = await reserveChannel(user, USDC(0.5));
  assert.ok(r.ok);
  await db.prepare('UPDATE pay_channel_holds SET created_at = created_at - 3600').run();
  await runChannelJob();
  assert.equal(await channelAvailable(user), USDC(2));
  if (r.ok) await confirmChannel(r);
  const st = await getChannelStatus(user);
  assert.equal(st.channel?.spentBaseUnits, USDC(0.5));
  assert.equal(st.channel?.availableBaseUnits, USDC(1.5));
  await treasuryIs(0.5);
});

test('con una llamada en curso no se liquida', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const r = await reserveChannel(user, USDC(0.5));
  await assert.rejects(liquidateChannel(user), /llamada en curso/);
  if (r.ok) await confirmChannel(r);
  await treasuryIs(0.5);
  const liq = await liquidateChannel(user);
  assert.equal(liq.paidBaseUnits, 0);
  assert.equal(liq.refundedBaseUnits, USDC(1.5));
});

test('retiro pedido directamente al contrato: Kiba se entera, cobra y deja de aceptar gasto', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await call(user, 0.06);
  const channel = (await getChannelStatus(user)).channel!.channel;
  net.externalCloseStart(channel);
  await runChannelJob();
  let st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closing');
  assert.equal(st.channel?.closeEffectiveLedger, net.ledger + CHANNEL_WAIT_LEDGERS);
  await treasuryIs(0.06); // cobrado dentro de la espera, aunque estaba bajo el umbral
  assert.deepEqual(await reserveChannel(user, USDC(0.01)), { ok: false, reason: 'none', available: 0 });
  // Pasada la espera el usuario retira por fuera; Kiba cierra el canal en sus libros.
  net.ledger += CHANNEL_WAIT_LEDGERS;
  net.externalRefund(channel);
  await runChannelJob();
  st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closed');
  assert.equal(wallet(kp), USDC(5 + 4.94));
  assert.deepEqual(
    st.moves.map((m) => [m.kind, m.amount]),
    [
      ['refund', USDC(4.94)],
      ['settle', USDC(0.06)],
      ['close_start', 0],
      ['open', USDC(5)],
    ],
  );
});

// ─── Inactividad ────────────────────────────────────────────────────────────

const DAY = 86_400;
const idleFor = (userId: number, days: number) =>
  db.prepare('UPDATE pay_channels SET last_active_at = ? WHERE user_id = ?').run(Math.floor(Date.now() / 1000) - days * DAY, userId);

test('un depósito sin uso se devuelve a la wallet a los 90 días, cobrando antes lo pendiente', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await call(user, 0.04);
  assert.equal(CHANNEL_IDLE_DAYS, 90);
  let st = await getChannelStatus(user);
  assert.ok(Math.abs(st.channel!.idleReturnAt! - (Math.floor(Date.now() / 1000) + 90 * DAY)) < 5);
  await idleFor(user, 89);
  await runChannelJob();
  assert.equal((await getChannelStatus(user)).channel?.state, 'open'); // aún no
  await idleFor(user, 91);
  await runChannelJob();
  st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closed');
  assert.equal(st.channel?.closedReason, 'idle');
  assert.equal(Number(net.treasury), USDC(0.04));
  assert.equal(wallet(kp), USDC(5 + 4.96));
});

test('cualquier uso reinicia la cuenta de inactividad', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await idleFor(user, 91);
  await call(user, 0.01); // una llamada
  await runChannelJob();
  assert.equal((await getChannelStatus(user)).channel?.state, 'open');
  await idleFor(user, 91);
  await signAndSend(user, kp, await prepareChannelTopUp(user, USDC(1))); // una recarga
  await runChannelJob();
  const st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'open');
  assert.equal(st.channel?.closedReason, null);
});

test('si la wallet no puede recibir la devolución, el resto queda como retiro disponible', async () => {
  const { user, kp } = await openChannel('a@x.com', 5);
  await call(user, 0.04);
  net.refundBroken = true;
  const liq = await liquidateChannel(user);
  assert.equal(liq.paidBaseUnits, USDC(0.04));
  assert.equal(liq.refundedBaseUnits, 0);
  assert.equal(liq.pendingBaseUnits, USDC(4.96));
  let st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closing');
  assert.ok(st.channel!.refundAt! <= Math.floor(Date.now() / 1000) + 1); // disponible ya
  // Arreglada la wallet, el usuario retira lo que quedó.
  net.refundBroken = false;
  const p = await prepareChannelRefund(user);
  assert.equal(p.amountBaseUnits, USDC(4.96));
  await signAndSend(user, kp, p);
  st = await getChannelStatus(user);
  assert.equal(st.channel?.state, 'closed');
  assert.equal(wallet(kp), USDC(5 + 4.96));
});

// ─── Vida del canal ─────────────────────────────────────────────────────────

test('el job renueva el canal cuando le queda poca vida, y no antes', async () => {
  const { user } = await openChannel('a@x.com', 2);
  const channel = (await getChannelStatus(user)).channel!.channel;
  await runChannelJob();
  assert.equal(net.renewals.length, 0); // recién creado: le quedan 7 días
  net.ledger += NEW_CHANNEL_TTL - CHANNEL_TTL_MIN_LEDGERS + 1; // le quedan menos de 3 días
  await runChannelJob();
  assert.deepEqual(net.renewals, [channel]);
  assert.equal(net.channels.get(channel)!.liveUntil, net.ledger + CHANNEL_TTL_EXTEND_LEDGERS);
  await runChannelJob();
  assert.equal(net.renewals.length, 1); // ya renovado: no se repite
});

test('un canal que llegó a archivarse se restaura y vuelve a servir', async () => {
  const { user, kp } = await openChannel('a@x.com', 2);
  await call(user, 0.04);
  net.ledger += NEW_CHANNEL_TTL + 10; // Kiba estuvo caído más de 7 días
  await assert.rejects(liquidateChannel(user), /archivado/);
  assert.equal((await getChannelStatus(user)).channel?.state, 'open'); // la liquidación fallida no lo rompe
  await db.prepare('UPDATE pay_channels SET unsettled_since = unsettled_since - 3600 WHERE user_id = ?').run(user);
  await runChannelJob();
  assert.equal(net.renewals.length, 1);
  await treasuryIs(0.04); // restaurado, el mismo job ya pudo cobrar lo pendiente
  const liq = await liquidateChannel(user);
  assert.equal(liq.refundedBaseUnits, USDC(1.96));
  assert.equal(wallet(kp), USDC(8 + 1.96));
});

test('con la fábrica apagada los depósitos no están disponibles', async () => {
  const user = await createTestUser('a@x.com');
  setChannelChain(null);
  const prev = process.env.KIBA_CHANNEL_FACTORY_ID;
  process.env.KIBA_CHANNEL_FACTORY_ID = '0';
  try {
    assert.equal((await getChannelStatus(user)).enabled, false);
    await assert.rejects(
      prepareChannelOpen(user, { address: Keypair.random().publicKey(), amount: USDC(2) }),
      /no están disponibles/,
    );
  } finally {
    if (prev === undefined) delete process.env.KIBA_CHANNEL_FACTORY_ID;
    else process.env.KIBA_CHANNEL_FACTORY_ID = prev;
  }
});
