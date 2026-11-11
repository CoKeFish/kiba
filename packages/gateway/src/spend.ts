/**
 * Wallet del usuario: lo que Kiba hace con una wallet Stellar que NO controla.
 *
 * La wallet con la que el usuario paga es suya: una wallet de Privy cuyo dueño es él, o una
 * externa tipo Freighter. Kiba no puede firmar con ella. El usuario paga dejando un depósito en
 * un canal de pago (ver channel.ts); este módulo tiene lo común a todas sus transacciones:
 *
 *   - Activar la wallet: Kiba crea la cuenta con la reserva mínima y el usuario firma que
 *     acepta USDC (la trustline).
 *   - Enviar lo que firma el usuario: todas las transacciones las arma el gateway (tabla
 *     `spend_prepared`) y el usuario solo devuelve la firma del hash (Privy `signRawHash`) o el
 *     XDR firmado (Stellar Wallets Kit). Nada que no haya preparado el gateway se envía.
 *   - Mover USDC de la wallet a otra dirección (lo firma el usuario).
 *   - Pasar a la wallet del usuario el saldo de la wallet anterior, la que Kiba sí controlaba.
 *
 * El usuario no necesita XLM: Kiba paga las comisiones de sus transacciones con fee-bump.
 *
 * El "collector" es una cuenta de Kiba dedicada a crear cuentas, pagar fee-bumps y enviar los
 * cobros del canal. Gasta XLM y no guarda USDC. Está separada de la tesorería para no competir
 * por su número de secuencia.
 */
import { createHash } from 'node:crypto';
import {
  Account,
  Address,
  Asset,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from '@stellar/stellar-sdk';
import { resolveChainConfig } from 'kiba-sdk';
import { db } from './db';
import { getMasterWallet } from './wallets';
import { PrivyStellarSigner } from './privy';

/** Validez de una transacción preparada para que el usuario la firme. */
const PREPARED_TTL_S = 600;

// ─── Acceso a la cadena (inyectable en tests) ───────────────────────────────

export interface SpendChain {
  /** Saldo USDC de una cuenta, en unidades base. */
  read(owner: string): Promise<{ balance: bigint }>;
  /** Si la cuenta existe y si tiene trustline de USDC. */
  accountState(owner: string): Promise<{ exists: boolean; trustline: boolean }>;
  /** Crea la cuenta del usuario con la reserva mínima (la firma y paga el collector). */
  createAccount(owner: string): Promise<string>;
  latestLedger(): Promise<number>;
  /** Transacciones que firma el usuario (fuente = owner), sin firmar, en XDR. */
  buildTrustline(owner: string): Promise<string>;
  buildPayment(from: string, to: string, amount: bigint): Promise<string>;
  /** Envía una transacción ya firmada por su fuente, con las comisiones a cargo del collector. */
  submitSponsored(signedXdr: string): Promise<string>;
  /**
   * Qué fue de una transacción, por su hash. Sirve también el hash de la transacción de dentro
   * cuando otra cuenta pagó la comisión; `hash` es entonces el de la que quedó en la red.
   */
  txStatus(hash: string): Promise<{ status: 'success' | 'failed' | 'not_found'; hash?: string }>;
  passphrase(): string;
  tokenContract(): string;
}

export function collectorKeypair(): Keypair {
  const secret = process.env.SPEND_COLLECTOR_SECRET;
  if (secret) return Keypair.fromSecret(secret);
  // Derivada del seed de la treasury con separación de dominio: estable entre reinicios sin
  // exigir un secreto nuevo, y distinta de la treasury (otra cuenta, otra secuencia).
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return Keypair.fromRawEd25519Seed(
    createHash('sha256').update('kiba:spend-collector:').update(seed).digest(),
  );
}

/** Todo lo que usa la secuencia del collector va en serie (también los cobros del canal). */
let collectorQueue: Promise<unknown> = Promise.resolve();
export function serialCollector<T>(fn: () => Promise<T>): Promise<T> {
  const p = collectorQueue.then(fn, fn);
  collectorQueue = p.catch(() => {});
  return p;
}

/** Reserva con la que Kiba crea la cuenta del usuario: 2 reservas base + 1 trustline (+ margen). */
const NEW_ACCOUNT_XLM = '1.6';

class StellarSpendChain implements SpendChain {
  private readonly cfg = resolveChainConfig();
  private readonly server = new rpc.Server(this.cfg.rpcUrl);
  private readonly horizon = new Horizon.Server(this.cfg.horizonUrl);
  private readonly usdc = new Asset('USDC', this.cfg.assetIssuer!);
  private readonly token = new Contract(this.usdc.contractId(this.cfg.networkPassphrase));
  private readonly collector = collectorKeypair();
  private funded = false;

  passphrase(): string {
    return this.cfg.networkPassphrase;
  }
  tokenContract(): string {
    return this.token.contractId();
  }

  async read(owner: string): Promise<{ balance: bigint }> {
    // Lectura por simulación: no firma ni paga. La cuenta fuente no necesita existir on-chain.
    const tx = new TransactionBuilder(new Account(this.collector.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(this.token.call('balance', new Address(owner).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    // Sin cuenta o sin trustline de USDC el SAC falla al leer el saldo: para nosotros es 0.
    if (rpc.Api.isSimulationError(sim)) return { balance: 0n };
    return { balance: BigInt(scValToNative(sim.result!.retval) as bigint) };
  }

  async accountState(owner: string): Promise<{ exists: boolean; trustline: boolean }> {
    try {
      const acc = await this.horizon.loadAccount(owner);
      const trustline = acc.balances.some(
        (b) => 'asset_code' in b && b.asset_code === this.usdc.code && 'asset_issuer' in b && b.asset_issuer === this.usdc.issuer,
      );
      return { exists: true, trustline };
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status === 404) return { exists: false, trustline: false };
      throw err;
    }
  }

  async latestLedger(): Promise<number> {
    // getHealth da el número sin decodificar la cabecera del ledger: getLatestLedger falla cuando
    // la red sube de protocolo y esta versión del SDK no conoce el formato nuevo.
    return (await this.server.getHealth()).latestLedger;
  }

  private async ensureCollectorFunded(): Promise<void> {
    if (this.funded) return;
    try {
      await this.server.getAccount(this.collector.publicKey());
    } catch {
      if (!this.cfg.friendbotUrl) throw new Error(`[wallet] collector ${this.collector.publicKey()} sin fondos (XLM)`);
      await fetch(`${this.cfg.friendbotUrl}?addr=${this.collector.publicKey()}`);
    }
    this.funded = true;
  }

  private async sendAndWait(tx: Transaction | FeeBumpTransaction): Promise<string> {
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === 'ERROR') {
      const code = sent.errorResult?.result().switch().name ?? 'ERROR';
      throw new Error(`[wallet] rechazada al enviar: ${code}`);
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 60 });
    if (res.status !== 'SUCCESS') throw new Error(`[wallet] tx ${sent.hash} ${res.status}`);
    return sent.hash;
  }

  createAccount(owner: string): Promise<string> {
    return serialCollector(async () => {
      await this.ensureCollectorFunded();
      const tx = new TransactionBuilder(await this.horizon.loadAccount(this.collector.publicKey()), {
        fee: '1000',
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(Operation.createAccount({ destination: owner, startingBalance: NEW_ACCOUNT_XLM }))
        .setTimeout(60)
        .build();
      tx.sign(this.collector);
      return this.sendAndWait(tx);
    });
  }

  private async classic(source: string, op: xdr.Operation): Promise<string> {
    // Comisión mínima: la paga el collector con fee-bump al enviarla.
    return new TransactionBuilder(await this.horizon.loadAccount(source), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(PREPARED_TTL_S)
      .build()
      .toXDR();
  }

  buildTrustline(owner: string): Promise<string> {
    return this.classic(owner, Operation.changeTrust({ asset: this.usdc }));
  }

  buildPayment(from: string, to: string, amount: bigint): Promise<string> {
    const units = amount.toString().padStart(8, '0');
    const asString = `${units.slice(0, -7)}.${units.slice(-7)}`;
    return this.classic(from, Operation.payment({ destination: to, asset: this.usdc, amount: asString }));
  }

  async txStatus(hash: string): Promise<{ status: 'success' | 'failed' | 'not_found'; hash?: string }> {
    try {
      const r = await this.horizon.transactions().transaction(hash).call();
      // Si otra cuenta pagó la comisión, la que quedó en la red es la de fuera.
      const outer = (r as unknown as { fee_bump_transaction?: { hash?: string } }).fee_bump_transaction?.hash;
      return { status: r.successful ? 'success' : 'failed', hash: outer ?? r.hash };
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status === 404) return { status: 'not_found' };
      throw err;
    }
  }

  async submitSponsored(signedXdr: string): Promise<string> {
    await this.ensureCollectorFunded();
    const inner = TransactionBuilder.fromXDR(signedXdr, this.cfg.networkPassphrase) as Transaction;
    // El fee-bump no usa la secuencia del collector: no hace falta ponerlo en la cola.
    const bump = TransactionBuilder.buildFeeBumpTransaction(this.collector, '10000', inner, this.cfg.networkPassphrase);
    bump.sign(this.collector);
    return this.sendAndWait(bump);
  }
}

let chain: SpendChain | null = null;
function getChain(): SpendChain {
  return (chain ??= new StellarSpendChain());
}
/** Acceso a la cadena compartido con el canal de pago (cuenta, saldo, envío con comisión de Kiba). */
export const getSpendChain = getChain;
/** Tests: sustituye el acceso a la cadena. */
export function setSpendChain(c: SpendChain | null): void {
  chain = c;
}

function signedBy(tx: Transaction, address: string): boolean {
  const kp = Keypair.fromPublicKey(address);
  const hash = tx.hash();
  return tx.signatures.some((s) => s.hint().equals(kp.signatureHint()) && kp.verify(hash, s.signature()));
}

// ─── Wallet vinculada a la cuenta ───────────────────────────────────────────

export type WalletKind = 'privy' | 'external';

interface WalletRow {
  spend_address: string | null;
  spend_kind: string | null;
}

async function loadUser(userId: number): Promise<WalletRow | undefined> {
  return (await db.prepare('SELECT spend_address, spend_kind FROM users WHERE id = ?').get(userId)) as WalletRow | undefined;
}

const nowS = () => Math.floor(Date.now() / 1000);

/** Una dirección solo puede ser la wallet de una cuenta de Kiba. */
async function assertAddressFree(userId: number, address: string): Promise<void> {
  const taken = await db.prepare('SELECT id FROM users WHERE spend_address = ? AND id <> ?').get(address, userId);
  if (taken) throw new Error('esa wallet ya está vinculada a otra cuenta');
}

/**
 * Deja `address` como la wallet del usuario. Solo se llama después de que el usuario firmó algo
 * con ella (aceptar USDC o abrir un depósito): eso prueba que la controla.
 */
export async function linkWallet(userId: number, address: string, kind: WalletKind): Promise<void> {
  await assertAddressFree(userId, address);
  await db.prepare('UPDATE users SET spend_address = ?, spend_kind = ? WHERE id = ?').run(address, kind, userId);
}

// ─── Transacciones que firma el usuario ─────────────────────────────────────

export type PreparedKind =
  | 'trustline'
  | 'withdraw'
  | 'channel_open'
  | 'channel_topup'
  | 'channel_close_start'
  | 'channel_refund';

/** Lo que pasa después de enviar una transacción preparada de otro módulo (p. ej. el canal). */
export type PreparedEffect = (a: { userId: number; address: string; meta: Record<string, unknown>; hash: string }) => Promise<void>;
const preparedEffects = new Map<PreparedKind, PreparedEffect>();
export function onPreparedSent(kind: PreparedKind, fn: PreparedEffect): void {
  preparedEffects.set(kind, fn);
}

export interface PreparedTx {
  kind: PreparedKind;
  /** Hash (hex) que firma el usuario: con Privy `signRawHash({ hash: '0x' + hash })`. */
  hash: string;
  /** XDR sin firmar, para wallets que firman transacciones completas (Stellar Wallets Kit). */
  xdr: string;
  networkPassphrase: string;
}

export const ADDRESS_RE = /^G[A-Z2-7]{55}$/;

export async function storePrepared(userId: number, kind: PreparedKind, address: string, txXdr: string, meta: object = {}): Promise<PreparedTx> {
  const c = getChain();
  const tx = TransactionBuilder.fromXDR(txXdr, c.passphrase()) as Transaction;
  const hash = tx.hash().toString('hex');
  await db
    .prepare(
      `INSERT INTO spend_prepared (hash, user_id, kind, address, xdr, meta, created_at, used)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(hash, userId, kind, address, txXdr, JSON.stringify(meta), nowS());
  return { kind, hash, xdr: txXdr, networkPassphrase: c.passphrase() };
}

/**
 * Deja una wallet lista para depositar. Si la cuenta no existe, Kiba la crea con la reserva
 * mínima. Si le falta la trustline de USDC, devuelve la transacción para que la firme el usuario
 * (Kiba paga la comisión). `null` = ya está lista.
 */
export async function prepareActivation(userId: number, address: string, kind: WalletKind = 'external'): Promise<PreparedTx | null> {
  if (!ADDRESS_RE.test(address)) throw new Error('dirección Stellar inválida');
  await assertAddressFree(userId, address);
  const c = getChain();
  let state = await c.accountState(address);
  if (!state.exists) {
    // Solo para wallets que aún no son de nadie en Kiba; una por cuenta.
    const u = await loadUser(userId);
    if (u?.spend_address && u.spend_address !== address) throw new Error('ya tienes una wallet vinculada');
    await c.createAccount(address);
    state = await c.accountState(address);
  }
  if (state.trustline) return null;
  return storePrepared(userId, 'trustline', address, await c.buildTrustline(address), { kind });
}

/** Prepara el envío de USDC desde la wallet del usuario a otra dirección. Sin `amount` = todo. */
export async function prepareWithdraw(
  userId: number,
  args: { to: string; amount?: number },
): Promise<PreparedTx & { amountBaseUnits: number }> {
  const u = await loadUser(userId);
  if (!u?.spend_address) throw new Error('no tienes una wallet vinculada');
  if (!ADDRESS_RE.test(args.to)) throw new Error('dirección de destino inválida');
  if (args.to === u.spend_address) throw new Error('el destino es la misma wallet');
  const dest = await getChain().accountState(args.to);
  if (!dest.exists) throw new Error('la wallet de destino no existe en la red');
  if (!dest.trustline) throw new Error('la wallet de destino no acepta USDC (le falta la línea de confianza de USDC)');
  const { balance } = await getChain().read(u.spend_address);
  const max = Number(balance);
  const amount = args.amount === undefined ? max : args.amount;
  if (!(amount > 0)) throw new Error('no hay saldo para enviar');
  if (amount > max) throw new Error('el monto supera el saldo de la wallet');
  const built = await getChain().buildPayment(u.spend_address, args.to, BigInt(amount));
  const p = await storePrepared(userId, 'withdraw', u.spend_address, built, { to: args.to, amount });
  return { ...p, amountBaseUnits: amount };
}

/**
 * Recibe la firma del usuario sobre una transacción que preparó el gateway, la envía con las
 * comisiones a cargo de Kiba y aplica su efecto. Acepta la firma del hash (hex, Privy) o el XDR
 * firmado (Stellar Wallets Kit).
 */
export async function submitPrepared(
  userId: number,
  args: { hash?: string; signature?: string; signedXdr?: string },
): Promise<{ kind: PreparedKind; hash: string; address: string }> {
  const c = getChain();
  let tx: Transaction;
  let hash: string;
  if (args.signedXdr) {
    try {
      tx = TransactionBuilder.fromXDR(args.signedXdr, c.passphrase()) as Transaction;
    } catch {
      throw new Error('transacción inválida');
    }
    hash = tx.hash().toString('hex');
  } else if (args.hash && args.signature) {
    hash = args.hash.replace(/^0x/, '').toLowerCase();
    tx = undefined as unknown as Transaction;
  } else {
    throw new Error('falta la firma');
  }
  const row = (await db
    .prepare(
      `SELECT kind, address, xdr, meta, created_at, used FROM spend_prepared WHERE hash = ? AND user_id = ?`,
    )
    .get(hash, userId)) as
    | { kind: PreparedKind; address: string; xdr: string; meta: string; created_at: number; used: number }
    | undefined;
  if (!row) throw new Error('transacción no preparada por Kiba');
  if (row.used) throw new Error('transacción ya enviada');
  if (nowS() - row.created_at > PREPARED_TTL_S) throw new Error('la transacción venció; vuelve a intentarlo');

  if (!args.signedXdr) {
    tx = TransactionBuilder.fromXDR(row.xdr, c.passphrase()) as Transaction;
    const sig = Buffer.from(args.signature!.replace(/^0x/, ''), 'hex');
    try {
      tx.addSignature(row.address, sig.toString('base64'));
    } catch {
      throw new Error('la firma no corresponde a la wallet');
    }
  }
  if (!signedBy(tx, row.address)) throw new Error('la firma no corresponde a la wallet');

  // Marcar antes de enviar: un doble clic no manda dos veces la misma firma.
  const claimed = await db.prepare('UPDATE spend_prepared SET used = 1 WHERE hash = ? AND used = 0 RETURNING hash').get(hash);
  if (!claimed) throw new Error('transacción ya enviada');
  let sent: string;
  try {
    sent = await c.submitSponsored(tx.toXDR());
  } catch (err) {
    await db.prepare('UPDATE spend_prepared SET used = 0 WHERE hash = ?').run(hash);
    throw new Error(String((err as Error).message).split('\n')[0]);
  }

  const meta = JSON.parse(row.meta || '{}') as { kind?: string; to?: string; amount?: number };
  if (row.kind === 'trustline') {
    // Firmó con ella: es suya. Queda como la wallet de la cuenta.
    await linkWallet(userId, row.address, meta.kind === 'privy' ? 'privy' : 'external');
  } else if (row.kind === 'withdraw') {
    await db
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
         VALUES (?, 'withdraw', ?, 'pay-wallet', ?, ?, ?)`,
      )
      .run(userId, -(meta.amount ?? 0), sent, JSON.stringify({ to: meta.to }), nowS());
  }
  const effect = preparedEffects.get(row.kind);
  if (effect) await effect({ userId, address: row.address, meta: meta as Record<string, unknown>, hash: sent });
  return { kind: row.kind, hash: sent, address: row.address };
}

// ─── Estado ─────────────────────────────────────────────────────────────────

export interface SpendStatus {
  /** Wallet vinculada (G...), o null si el usuario aún no firmó nada con una. */
  address: string | null;
  kind: WalletKind | null;
  /** USDC que tiene la wallet (fuera del depósito), en unidades base. */
  balanceBaseUnits: number;
}

export async function getSpendStatus(userId: number): Promise<SpendStatus> {
  const u = await loadUser(userId);
  const balance = u?.spend_address ? (await getChain().read(u.spend_address)).balance : 0n;
  return {
    address: u?.spend_address ?? null,
    kind: (u?.spend_kind as WalletKind | null) ?? null,
    balanceBaseUnits: Number(balance),
  };
}

// ─── Migración de la wallet anterior (controlada por Kiba) ──────────────────

interface LegacySigner {
  publicKey(): string;
  signTransaction(tx: Transaction): Promise<void>;
}

/**
 * Wallet anterior del usuario (Privy app-owned o custodial local): la que Kiba PUEDE firmar.
 * null si el usuario nunca tuvo una. No crea wallets (a diferencia de loadUserSigner).
 */
async function legacySigner(userId: number): Promise<LegacySigner | null> {
  const row = (await db
    .prepare('SELECT custodial_wallet_secret, privy_wallet_id, stellar_address FROM users WHERE id = ?')
    .get(userId)) as
    | { custodial_wallet_secret: string | null; privy_wallet_id: string | null; stellar_address: string | null }
    | undefined;
  if (!row) return null;
  // Directo, sin loadUserSigner: ese provisiona una wallet nueva de Privy y BORRA la clave local,
  // lo que dejaría atrapado el saldo de la wallet local que queremos migrar.
  if (row.privy_wallet_id && row.stellar_address) {
    return new PrivyStellarSigner(row.privy_wallet_id, row.stellar_address) as unknown as LegacySigner;
  }
  if (!row.custodial_wallet_secret || row.custodial_wallet_secret === '[]') return null;
  const seed = Uint8Array.from(JSON.parse(row.custodial_wallet_secret) as number[]).slice(0, 32);
  const kp = Keypair.fromRawEd25519Seed(Buffer.from(seed));
  return {
    publicKey: () => kp.publicKey(),
    signTransaction: async (tx: Transaction) => tx.sign(kp),
  };
}
let legacySignerFor: (userId: number) => Promise<LegacySigner | null> = legacySigner;
/** Tests: sustituye la carga del firmante de la wallet anterior. */
export function setLegacySignerLoader(fn: ((userId: number) => Promise<LegacySigner | null>) | null): void {
  legacySignerFor = fn ?? legacySigner;
}

export async function legacyWallet(userId: number): Promise<{ address: string; balanceBaseUnits: number } | null> {
  const s = await legacySignerFor(userId);
  if (!s) return null;
  const { balance } = await getChain().read(s.publicKey());
  return { address: s.publicKey(), balanceBaseUnits: Number(balance) };
}

/**
 * Pasa todo el USDC de la wallet anterior a la wallet del usuario. Lo pide el usuario (botón);
 * Kiba firma con la wallet anterior (es la última vez) y paga la comisión.
 */
export async function migrateLegacyWallet(userId: number): Promise<{ hash: string; amountBaseUnits: number }> {
  const u = await loadUser(userId);
  if (!u?.spend_address) throw new Error('vincula tu wallet primero');
  const s = await legacySignerFor(userId);
  if (!s) throw new Error('no tienes una wallet anterior');
  if (s.publicKey() === u.spend_address) throw new Error('la wallet anterior ya es tu wallet');
  const c = getChain();
  const { balance } = await c.read(s.publicKey());
  if (balance <= 0n) throw new Error('la wallet anterior no tiene USDC');
  const tx = TransactionBuilder.fromXDR(await c.buildPayment(s.publicKey(), u.spend_address, balance), c.passphrase()) as Transaction;
  await s.signTransaction(tx);
  const hash = await c.submitSponsored(tx.toXDR());
  await db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
       VALUES (?, 'migrate', ?, 'pay-wallet', ?, ?, ?)`,
    )
    .run(userId, Number(balance), hash, JSON.stringify({ from: s.publicKey(), to: u.spend_address }), nowS());
  return { hash, amountBaseUnits: Number(balance) };
}
