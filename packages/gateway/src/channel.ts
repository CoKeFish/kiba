/**
 * Depósito retirable: el usuario paga desde SU wallet dejando un depósito en un canal de pago.
 *
 * Modelo: un canal de pago de Stellar por usuario (contrato one-way-channel de
 * stellar-experimental, creado por su fábrica). El usuario deposita USDC en el canal con una
 * transacción que firma él; ese dinero sigue siendo suyo. Cada llamada sube el total consumido
 * (`spent`) sin tocar la cadena, y Kiba cobra ese total al contrato presentando un compromiso
 * firmado con la clave de gasto del canal. El contrato nunca paga más de lo depositado.
 *
 * Salidas del usuario:
 *   - Liquidar: Kiba cierra el canal; en una sola transacción el contrato le paga a Kiba lo
 *     consumido y devuelve el resto a la wallet del usuario. Es inmediato.
 *   - Retiro con espera (no depende de que Kiba coopere): el usuario pide el cierre, pasa el
 *     plazo del canal y retira todo lo que Kiba no haya cobrado.
 *
 * Clave de gasto: es una clave ed25519 distinta de la wallet, fijada al abrir el canal. Solo
 * autoriza cobros de ESE canal a favor de Kiba, hasta lo depositado. Con el conector web no hay
 * programa del usuario que firme cada llamada, así que la guarda Kiba: se deriva del seed de la
 * tesorería y del `salt` del canal (no se almacena en la base de datos).
 *
 * Todas las transacciones del usuario las arma el gateway y él solo las firma (mismo mecanismo
 * que spend.ts: tabla `spend_prepared`, envío con las comisiones a cargo de Kiba).
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { resolveChainConfig } from 'kiba-sdk';
import { db } from './db';
import { getMasterWallet } from './wallets';
import {
  ADDRESS_RE,
  collectorKeypair,
  getSpendChain,
  onPreparedSent,
  serialCollector,
  storePrepared,
  type PreparedTx,
} from './spend';

/** Fábrica publicada en testnet (packages/contracts-channel). `KIBA_CHANNEL_FACTORY_ID` la cambia; `0` la apaga. */
const TESTNET_FACTORY = 'CBV34HJF4VU4YBGMNHC2L3TKLDSTOXYN5ADZRBWCILJLHOTAAKWX75SV';
/** Espera del retiro sin Kiba, en ledgers (~5 s cada uno). Default ~1 h. */
export const CHANNEL_WAIT_LEDGERS = Number(process.env.CHANNEL_REFUND_WAIT_LEDGERS) || 720;
/** Depósito mínimo para abrir un canal (unidades base). Default 1 USDC. */
export const CHANNEL_MIN_DEPOSIT = Number(process.env.CHANNEL_MIN_DEPOSIT) || 10_000_000;
/** Validez de una transacción preparada (igual que en spend.ts). */
const PREPARED_TTL_S = 600;

// ─── Acceso a la cadena (inyectable en tests) ───────────────────────────────

export interface ChannelChain {
  /** Cuenta de Kiba que cobra del canal (la tesorería). */
  recipient(): string;
  /** Transacciones que firma el usuario (fuente = owner), sin firmar, en XDR. */
  buildOpen(a: { owner: string; salt: Buffer; commitmentKey: Buffer; amount: bigint; waitLedgers: number }): Promise<string>;
  buildTopUp(owner: string, channel: string, amount: bigint): Promise<string>;
  buildCloseStart(owner: string, channel: string): Promise<string>;
  buildRefund(owner: string, channel: string): Promise<string>;
  /** Dirección del canal que creó una apertura ya confirmada. */
  openedChannel(hash: string): Promise<string>;
  /** Saldo que queda en el canal y total ya cobrado por Kiba. */
  read(channel: string): Promise<{ balance: bigint; withdrawn: bigint }>;
  /** Bytes del compromiso «de este canal llevo gastado `amount`» (lo que firma la clave de gasto). */
  commitment(channel: string, amount: bigint): Buffer;
  /** Cobra hasta `amount` sin cerrar el canal. Devuelve el hash. */
  settle(channel: string, amount: bigint, sig: Buffer): Promise<string>;
  /** Cobra hasta `amount`, cierra el canal y devuelve el resto al usuario. Devuelve el hash. */
  close(channel: string, amount: bigint, sig: Buffer): Promise<string>;
}

const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

/** Bytes del compromiso: ScVal::Map {amount, channel, domain: "chancmmt", network} en XDR. */
export function commitmentBytes(networkPassphrase: string, channel: string, amount: bigint): Buffer {
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  return xdr.ScVal.scvMap([
    entry('amount', i128(amount)),
    entry('channel', new Address(channel).toScVal()),
    entry('domain', xdr.ScVal.scvSymbol('chancmmt')),
    entry('network', xdr.ScVal.scvBytes(createHash('sha256').update(networkPassphrase).digest())),
  ]).toXDR();
}

function treasuryKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(getMasterWallet().secretKey.slice(0, 32)));
}

class StellarChannelChain implements ChannelChain {
  private readonly cfg = resolveChainConfig();
  private readonly server = new rpc.Server(this.cfg.rpcUrl);
  private readonly factory: Contract;
  private readonly treasury = treasuryKeypair();
  private readonly collector = collectorKeypair();
  private funded = false;

  constructor(factoryId: string) {
    this.factory = new Contract(factoryId);
  }

  recipient(): string {
    return this.treasury.publicKey();
  }

  commitment(channel: string, amount: bigint): Buffer {
    return commitmentBytes(this.cfg.networkPassphrase, channel, amount);
  }

  /** Transacción de un solo llamado, fuente = el usuario; la comisión la paga Kiba al enviarla. */
  private async userTx(owner: string, op: xdr.Operation): Promise<string> {
    const tx = new TransactionBuilder(await this.server.getAccount(owner), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(PREPARED_TTL_S)
      .build();
    return (await this.server.prepareTransaction(tx)).toXDR();
  }

  buildOpen(a: { owner: string; salt: Buffer; commitmentKey: Buffer; amount: bigint; waitLedgers: number }): Promise<string> {
    return this.userTx(
      a.owner,
      this.factory.call(
        'open',
        xdr.ScVal.scvBytes(a.salt),
        new Address(getSpendChain().tokenContract()).toScVal(),
        new Address(a.owner).toScVal(),
        xdr.ScVal.scvBytes(a.commitmentKey),
        new Address(this.recipient()).toScVal(),
        i128(a.amount),
        nativeToScVal(a.waitLedgers, { type: 'u32' }),
      ),
    );
  }

  buildTopUp(owner: string, channel: string, amount: bigint): Promise<string> {
    return this.userTx(owner, new Contract(channel).call('top_up', i128(amount)));
  }

  buildCloseStart(owner: string, channel: string): Promise<string> {
    return this.userTx(owner, new Contract(channel).call('close_start'));
  }

  buildRefund(owner: string, channel: string): Promise<string> {
    return this.userTx(owner, new Contract(channel).call('refund'));
  }

  async openedChannel(hash: string): Promise<string> {
    const r = await this.server.getTransaction(hash);
    if (r.status !== 'SUCCESS' || !r.returnValue) throw new Error(`[channel] apertura ${hash} sin resultado`);
    return Address.fromScVal(r.returnValue).toString();
  }

  private async view(channel: string, fn: string): Promise<bigint> {
    const tx = new TransactionBuilder(new Account(this.collector.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(new Contract(channel).call(fn))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`[channel] ${fn}: ${sim.error}`);
    return BigInt(scValToNative(sim.result!.retval) as bigint);
  }

  async read(channel: string): Promise<{ balance: bigint; withdrawn: bigint }> {
    const [balance, withdrawn] = await Promise.all([this.view(channel, 'balance'), this.view(channel, 'withdrawn')]);
    return { balance, withdrawn };
  }

  private async ensureCollectorFunded(): Promise<void> {
    if (this.funded) return;
    try {
      await this.server.getAccount(this.collector.publicKey());
    } catch {
      if (!this.cfg.friendbotUrl) throw new Error(`[channel] collector ${this.collector.publicKey()} sin fondos (XLM)`);
      await fetch(`${this.cfg.friendbotUrl}?addr=${this.collector.publicKey()}`);
    }
    this.funded = true;
  }

  /**
   * Llamada de Kiba al canal (`settle` o `close`). El contrato exige la autorización de la
   * tesorería (la receptora); la transacción la envía y la paga el collector, así no compite
   * por el número de secuencia de la tesorería.
   */
  private kibaCall(channel: string, fn: 'settle' | 'close', amount: bigint, sig: Buffer): Promise<string> {
    return serialCollector(async () => {
      await this.ensureCollectorFunded();
      const source = this.collector.publicKey();
      const seq = (await this.server.getAccount(source)).sequenceNumber();
      const build = (op: xdr.Operation) =>
        new TransactionBuilder(new Account(source, seq), { fee: '100000', networkPassphrase: this.cfg.networkPassphrase })
          .addOperation(op)
          .setTimeout(60)
          .build();
      const call = new Contract(channel).call(fn, i128(amount), xdr.ScVal.scvBytes(sig));
      // 1) Simular para saber qué autorización pide; 2) firmarla con la tesorería; 3) preparar y enviar.
      const sim = await this.server.simulateTransaction(build(call));
      if (rpc.Api.isSimulationError(sim)) throw new Error(`[channel] ${fn}: ${sim.error}`);
      const auth = await Promise.all(
        (sim.result?.auth ?? []).map((e) => authorizeEntry(e, this.treasury, sim.latestLedger + 100, this.cfg.networkPassphrase)),
      );
      const func = call.body().invokeHostFunctionOp().hostFunction();
      const tx = await this.server.prepareTransaction(build(Operation.invokeHostFunction({ func, auth })));
      tx.sign(this.collector);
      const sent = await this.server.sendTransaction(tx);
      if (sent.status === 'ERROR') {
        throw new Error(`[channel] ${fn} rechazada al enviar: ${sent.errorResult?.result().switch().name ?? 'ERROR'}`);
      }
      const res = await this.server.pollTransaction(sent.hash, { attempts: 60 });
      if (res.status !== 'SUCCESS') throw new Error(`[channel] ${fn} ${sent.hash} ${res.status}`);
      return sent.hash;
    });
  }

  settle(channel: string, amount: bigint, sig: Buffer): Promise<string> {
    return this.kibaCall(channel, 'settle', amount, sig);
  }

  close(channel: string, amount: bigint, sig: Buffer): Promise<string> {
    return this.kibaCall(channel, 'close', amount, sig);
  }
}

/** Fábrica de canales configurada, o null si los depósitos están apagados. */
export function channelFactoryId(): string | null {
  const v = process.env.KIBA_CHANNEL_FACTORY_ID;
  if (v === '0') return null;
  if (v) return v;
  return resolveChainConfig().networkPassphrase === Networks.TESTNET ? TESTNET_FACTORY : null;
}

let chain: ChannelChain | null = null;
let injected = false;
function getChain(): ChannelChain {
  if (chain) return chain;
  const id = channelFactoryId();
  if (!id) throw new Error('los depósitos no están disponibles');
  return (chain = new StellarChannelChain(id));
}
/** Tests: sustituye el acceso a la cadena (null = el real). */
export function setChannelChain(c: ChannelChain | null): void {
  chain = c;
  injected = c !== null;
}
const enabled = () => injected || channelFactoryId() !== null;

// ─── Clave de gasto ─────────────────────────────────────────────────────────

/** Clave de gasto del canal, derivada del seed de la tesorería y del `salt` del canal. */
function commitmentKeypair(salt: string): Keypair {
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return Keypair.fromRawEd25519Seed(
    createHash('sha256').update('kiba:channel-commitment:').update(seed).update(Buffer.from(salt, 'hex')).digest(),
  );
}

function signCommitment(row: ChannelRow, amount: number): Buffer {
  return commitmentKeypair(row.salt).sign(getChain().commitment(row.channel!, BigInt(amount)));
}

// ─── Estado por usuario ─────────────────────────────────────────────────────

export type ChannelState = 'preparing' | 'open' | 'closing' | 'liquidating' | 'closed';
const LIVE = `('open','closing','liquidating')`;

interface ChannelRow {
  id: number;
  user_id: number;
  address: string;
  kind: string;
  salt: string;
  channel: string | null;
  wait_ledgers: number;
  deposited: number;
  spent: number;
  settled: number;
  status: ChannelState;
  close_effective_ledger: number | null;
  refunded: number | null;
  created_at: number;
  closed_at: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);
const num = (r: ChannelRow): ChannelRow => ({
  ...r,
  id: Number(r.id),
  deposited: Number(r.deposited),
  spent: Number(r.spent),
  settled: Number(r.settled),
  close_effective_ledger: r.close_effective_ledger === null ? null : Number(r.close_effective_ledger),
  refunded: r.refunded === null ? null : Number(r.refunded),
  created_at: Number(r.created_at),
  closed_at: r.closed_at === null ? null : Number(r.closed_at),
});

async function liveChannel(userId: number): Promise<ChannelRow | undefined> {
  const r = (await db.prepare(`SELECT * FROM pay_channels WHERE user_id = ? AND status IN ${LIVE}`).get(userId)) as
    | ChannelRow
    | undefined;
  return r && num(r);
}

async function channelById(id: number): Promise<ChannelRow> {
  return num((await db.prepare('SELECT * FROM pay_channels WHERE id = ?').get(id)) as ChannelRow);
}

async function addMove(channelId: number, kind: string, amount: number, hash: string | null): Promise<void> {
  await db
    .prepare('INSERT INTO pay_channel_moves (channel_id, kind, amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(channelId, kind, amount, hash, nowS());
}

/** true si el usuario tiene un depósito abierto con el que pagar. */
export async function hasOpenChannel(userId: number): Promise<boolean> {
  return (await liveChannel(userId))?.status === 'open';
}

// ─── Transacciones que firma el usuario ─────────────────────────────────────

/**
 * Prepara la apertura del canal con su depósito inicial. La wallet debe existir y aceptar USDC
 * (ver `prepareActivation` en spend.ts) y tener el monto.
 */
export async function prepareChannelOpen(
  userId: number,
  args: { address: string; amount: number; kind?: 'privy' | 'external' },
): Promise<PreparedTx & { amountBaseUnits: number; waitLedgers: number }> {
  const c = getChain();
  const sc = getSpendChain();
  if (!ADDRESS_RE.test(args.address)) throw new Error('dirección Stellar inválida');
  if (!Number.isInteger(args.amount) || args.amount < CHANNEL_MIN_DEPOSIT) {
    throw new Error(`el depósito mínimo es ${CHANNEL_MIN_DEPOSIT / 1e7} USDC`);
  }
  if (await liveChannel(userId)) throw new Error('ya tienes un depósito abierto; recárgalo o liquídalo');
  const taken =
    (await db.prepare(`SELECT 1 FROM pay_channels WHERE address = ? AND user_id <> ? AND status IN ${LIVE}`).get(args.address, userId)) ||
    (await db.prepare('SELECT 1 FROM users WHERE spend_address = ? AND id <> ?').get(args.address, userId));
  if (taken) throw new Error('esa wallet ya está vinculada a otra cuenta');
  const state = await sc.accountState(args.address);
  if (!state.exists || !state.trustline) throw new Error('activa la wallet primero');
  const { balance } = await sc.read(args.address);
  if (balance < BigInt(args.amount)) throw new Error('la wallet no tiene ese monto en USDC');

  // Aperturas preparadas y nunca firmadas no dejan rastro.
  await db.prepare(`DELETE FROM pay_channels WHERE user_id = ? AND status = 'preparing'`).run(userId);
  const salt = randomBytes(32).toString('hex');
  const row = (await db
    .prepare(
      `INSERT INTO pay_channels (user_id, address, kind, salt, wait_ledgers, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'preparing', ?) RETURNING id`,
    )
    .get(userId, args.address, args.kind ?? 'external', salt, CHANNEL_WAIT_LEDGERS, nowS())) as { id: number };
  const built = await c.buildOpen({
    owner: args.address,
    salt: Buffer.from(salt, 'hex'),
    commitmentKey: commitmentKeypair(salt).rawPublicKey(),
    amount: BigInt(args.amount),
    waitLedgers: CHANNEL_WAIT_LEDGERS,
  });
  const p = await storePrepared(userId, 'channel_open', args.address, built, { channelId: Number(row.id), amount: args.amount });
  return { ...p, amountBaseUnits: args.amount, waitLedgers: CHANNEL_WAIT_LEDGERS };
}

/** Prepara una recarga del canal abierto. */
export async function prepareChannelTopUp(userId: number, amount: number): Promise<PreparedTx & { amountBaseUnits: number }> {
  const c = getChain();
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'open') throw new Error('no tienes un depósito abierto');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('monto inválido');
  const { balance } = await getSpendChain().read(ch.address);
  if (balance < BigInt(amount)) throw new Error('la wallet no tiene ese monto en USDC');
  const built = await c.buildTopUp(ch.address, ch.channel!, BigInt(amount));
  const p = await storePrepared(userId, 'channel_topup', ch.address, built, { channelId: ch.id, amount });
  return { ...p, amountBaseUnits: amount };
}

/**
 * Retiro con espera, paso 1: el usuario pide el cierre. Desde ese momento no se anota más
 * consumo y Kiba cobra lo pendiente; pasado el plazo del canal, el usuario retira el resto.
 */
export async function prepareChannelCloseStart(userId: number): Promise<PreparedTx> {
  const c = getChain();
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'open') throw new Error('no tienes un depósito abierto');
  const built = await c.buildCloseStart(ch.address, ch.channel!);
  return storePrepared(userId, 'channel_close_start', ch.address, built, { channelId: ch.id });
}

/** Retiro con espera, paso 2: pasado el plazo, el usuario retira lo que queda en el canal. */
export async function prepareChannelRefund(userId: number): Promise<PreparedTx & { amountBaseUnits: number }> {
  const c = getChain();
  const ch = await liveChannel(userId);
  if (!ch || ch.status !== 'closing') throw new Error('primero pide el retiro');
  const latest = await getSpendChain().latestLedger();
  if (ch.close_effective_ledger !== null && latest < ch.close_effective_ledger) {
    const mins = Math.ceil(((ch.close_effective_ledger - latest) * 5) / 60);
    throw new Error(`el retiro estará disponible en unos ${mins} min`);
  }
  // Lo consumido se cobra antes: el retiro se lleva TODO lo que quede en el canal.
  await settleChannel(userId);
  const { balance } = await c.read(ch.channel!);
  const built = await c.buildRefund(ch.address, ch.channel!);
  const p = await storePrepared(userId, 'channel_refund', ch.address, built, { channelId: ch.id, amount: Number(balance) });
  return { ...p, amountBaseUnits: Number(balance) };
}

onPreparedSent('channel_open', async ({ meta, hash }) => {
  const id = Number(meta.channelId);
  const amount = Number(meta.amount);
  const channel = await getChain().openedChannel(hash);
  await db
    .prepare(`UPDATE pay_channels SET channel = ?, deposited = ?, status = 'open' WHERE id = ? AND status = 'preparing'`)
    .run(channel, amount, id);
  await addMove(id, 'open', amount, hash);
});

onPreparedSent('channel_topup', async ({ meta, hash }) => {
  const id = Number(meta.channelId);
  const amount = Number(meta.amount);
  await db.prepare('UPDATE pay_channels SET deposited = deposited + ? WHERE id = ?').run(amount, id);
  await addMove(id, 'top_up', amount, hash);
});

onPreparedSent('channel_close_start', async ({ userId, meta, hash }) => {
  const id = Number(meta.channelId);
  const ch = await channelById(id);
  // El cierre se hace efectivo `wait_ledgers` después del ledger de la transacción, que ya pasó:
  // contar desde el último ledger da un momento igual o posterior (el contrato decide el real).
  const effective = (await getSpendChain().latestLedger()) + ch.wait_ledgers;
  await db
    .prepare(`UPDATE pay_channels SET status = 'closing', close_effective_ledger = ? WHERE id = ? AND status = 'open'`)
    .run(effective, id);
  await addMove(id, 'close_start', 0, hash);
  // Kiba cobra lo consumido dentro de la espera; si falla aquí, se reintenta al preparar el retiro.
  await settleChannel(userId).catch((err) => console.error('[channel] cobro tras pedir retiro:', (err as Error).message));
});

onPreparedSent('channel_refund', async ({ meta, hash }) => {
  const id = Number(meta.channelId);
  const amount = Number(meta.amount ?? 0);
  await db
    .prepare(`UPDATE pay_channels SET status = 'closed', refunded = ?, closed_at = ? WHERE id = ? AND status = 'closing'`)
    .run(amount, nowS(), id);
  await addMove(id, 'refund', amount, hash);
});

// ─── Cobros de Kiba ─────────────────────────────────────────────────────────

/**
 * Cobra al canal lo consumido que aún no se ha cobrado, sin cerrarlo. Devuelve el hash, o null
 * si no había nada que cobrar.
 */
export async function settleChannel(userId: number): Promise<string | null> {
  const ch = await liveChannel(userId);
  if (!ch || !ch.channel || ch.status === 'liquidating' || ch.spent <= ch.settled) return null;
  const amount = ch.spent;
  const hash = await getChain().settle(ch.channel, BigInt(amount), signCommitment(ch, amount));
  await db.prepare('UPDATE pay_channels SET settled = GREATEST(settled, ?) WHERE id = ?').run(amount, ch.id);
  await addMove(ch.id, 'settle', amount - ch.settled, hash);
  return hash;
}

export interface Liquidation {
  hash: string;
  /** Lo que Kiba cobró en esta transacción. */
  paidBaseUnits: number;
  /** Lo que volvió a la wallet del usuario. */
  refundedBaseUnits: number;
  /** Lo que quedó en el canal porque la devolución automática falló (el usuario lo retira aparte). */
  pendingBaseUnits: number;
}

/**
 * Liquida el canal: en una transacción el contrato le paga a Kiba lo consumido y devuelve el
 * resto a la wallet del usuario. El canal queda cerrado; para seguir pagando se abre otro.
 */
export async function liquidateChannel(userId: number): Promise<Liquidation> {
  const c = getChain();
  const before = await liveChannel(userId);
  if (!before || !before.channel || before.status === 'liquidating') throw new Error('no tienes un depósito abierto');
  // Reclamar el canal: desde aquí no se anota más consumo ni entra otra liquidación.
  const claimed = (await db
    .prepare(`UPDATE pay_channels SET status = 'liquidating' WHERE id = ? AND status = ? RETURNING *`)
    .get(before.id, before.status)) as ChannelRow | undefined;
  if (!claimed) throw new Error('el depósito cambió; vuelve a intentarlo');
  const ch = num(claimed);
  let hash: string;
  try {
    hash = await c.close(ch.channel!, BigInt(ch.spent), signCommitment(ch, ch.spent));
  } catch (err) {
    await db.prepare(`UPDATE pay_channels SET status = ? WHERE id = ? AND status = 'liquidating'`).run(before.status, ch.id);
    throw new Error(String((err as Error).message).split('\n')[0]);
  }
  // Si la lectura falla, la transacción ya entró: se asume la devolución completa.
  const pending = Number((await c.read(ch.channel!).catch(() => ({ balance: 0n }))).balance);
  const paid = ch.spent - ch.settled;
  const refunded = Math.max(0, ch.deposited - ch.spent - pending);
  await db
    .prepare(`UPDATE pay_channels SET status = 'closed', settled = ?, refunded = ?, closed_at = ? WHERE id = ?`)
    .run(ch.spent, refunded, nowS(), ch.id);
  if (paid > 0) await addMove(ch.id, 'settle', paid, hash);
  await addMove(ch.id, 'close', refunded, hash);
  return { hash, paidBaseUnits: paid, refundedBaseUnits: refunded, pendingBaseUnits: pending };
}

// ─── Estado ─────────────────────────────────────────────────────────────────

export interface ChannelStatus {
  /** false si los depósitos están apagados en este gateway. */
  enabled: boolean;
  minDepositBaseUnits: number;
  /** Espera del retiro sin Kiba para canales nuevos, en ledgers (~5 s). */
  waitLedgers: number;
  latestLedger: number | null;
  channel: null | {
    address: string;
    kind: 'privy' | 'external';
    /** Contrato del canal (C...). */
    channel: string;
    state: Exclude<ChannelState, 'preparing'>;
    depositedBaseUnits: number;
    spentBaseUnits: number;
    settledBaseUnits: number;
    /** Lo que queda para gastar o retirar: depositado − consumido. */
    availableBaseUnits: number;
    waitLedgers: number;
    closeEffectiveLedger: number | null;
    /** Estimación (unix s) de cuándo se puede retirar tras pedir el retiro, a 5 s por ledger. */
    refundAt: number | null;
  };
  moves: { kind: string; amount: number; txHash: string | null; createdAt: number }[];
}

export async function getChannelStatus(userId: number): Promise<ChannelStatus> {
  const base = { enabled: enabled(), minDepositBaseUnits: CHANNEL_MIN_DEPOSIT, waitLedgers: CHANNEL_WAIT_LEDGERS };
  if (!base.enabled) return { ...base, latestLedger: null, channel: null, moves: [] };
  // El canal vivo o, si no hay, el último cerrado (para mostrar cómo terminó).
  const row = (await db
    .prepare(
      `SELECT * FROM pay_channels WHERE user_id = ? AND status <> 'preparing'
       ORDER BY (status IN ${LIVE}) DESC, id DESC LIMIT 1`,
    )
    .get(userId)) as ChannelRow | undefined;
  if (!row) return { ...base, latestLedger: null, channel: null, moves: [] };
  const ch = num(row);
  const latest = await getSpendChain().latestLedger();
  const moves = (await db
    .prepare('SELECT kind, amount, tx_hash, created_at FROM pay_channel_moves WHERE channel_id = ? ORDER BY id DESC LIMIT 20')
    .all(ch.id)) as { kind: string; amount: number; tx_hash: string | null; created_at: number }[];
  const eff = ch.close_effective_ledger;
  return {
    ...base,
    latestLedger: latest,
    channel: {
      address: ch.address,
      kind: ch.kind as 'privy' | 'external',
      channel: ch.channel!,
      state: ch.status as Exclude<ChannelState, 'preparing'>,
      depositedBaseUnits: ch.deposited,
      spentBaseUnits: ch.spent,
      settledBaseUnits: ch.settled,
      availableBaseUnits: ch.status === 'closed' ? 0 : Math.max(0, ch.deposited - ch.spent),
      waitLedgers: ch.wait_ledgers,
      closeEffectiveLedger: eff,
      refundAt: ch.status === 'closing' && eff !== null ? nowS() + Math.max(0, eff - latest) * 5 : null,
    },
    moves: moves.map((m) => ({ kind: m.kind, amount: Number(m.amount), txHash: m.tx_hash, createdAt: Number(m.created_at) })),
  };
}
