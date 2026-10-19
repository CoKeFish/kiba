/**
 * Wallet de pagos: el usuario paga desde SU wallet Stellar sin entregarle la clave a Kiba.
 *
 * Modelo: una wallet dedicada a pagar en Kiba (Privy con dueño = el usuario, o una externa tipo
 * Freighter). El usuario firma una vez `approve(owner, collector, tope, vencimiento)` sobre el
 * contrato de USDC (SAC, SEP-41) — normalmente sin tope: el límite real es lo que él deposite.
 * Desde ahí el agente gasta libremente sin pedir firma por transacción; el usuario recarga o
 * retira cuando quiera (retirar lo firma él). El contrato impone el permiso: Kiba no puede mover
 * más de lo autorizado, ni después del vencimiento, ni si el usuario lo revoca.
 *
 * Cada llamada se ANOTA al instante como deuda (off-chain, ~0.1 s con la lectura on-chain) y se
 * cobra por lotes con `transfer_from(collector, owner, treasury, deuda)`. Riesgo acotado:
 *   - antes de anotar se lee saldo + permiso on-chain y la deuda nunca supera min(saldo, permiso);
 *   - la deuda total (incluida la que se está cobrando) nunca supera SPEND_DEBT_CAP: se cobra al
 *     llegar a la mitad y, si una llamada lo superaría, espera al cobro en vuelo o se rechaza;
 *   - si un cobro falla por fondos, la cuenta queda bloqueada hasta que alcance para la deuda;
 *   - un cobro guarda su hash ANTES de enviarse y los pendientes se resuelven por su estado
 *     on-chain (arranque + job): una deuda ya cobrada nunca se cobra dos veces.
 *
 * El usuario no necesita XLM: Kiba crea su cuenta con la reserva mínima y paga las comisiones de
 * sus transacciones con fee-bump. Todas las transacciones que firma el usuario las arma el gateway
 * (tabla `spend_prepared`) y el usuario solo devuelve la firma del hash (Privy `signRawHash`) o el
 * XDR firmado (Stellar Wallets Kit): nada que no haya preparado el gateway se envía.
 *
 * El "collector" es una cuenta dedicada a firmar los `transfer_from`, crear cuentas y pagar
 * fee-bumps (gasta XLM, no guarda USDC: el cobro va directo a la treasury). Separada de la
 * treasury para no competir por su número de secuencia con la cola de Trustless Work.
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
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from '@stellar/stellar-sdk';
import { resolveChainConfig } from 'kiba-sdk';
import { db, withTransaction } from './db';
import { getMasterWallet } from './wallets';
import { PrivyStellarSigner } from './privy';

/** Deuda máxima por usuario (unidades base). Default 1 USDC. */
export const SPEND_DEBT_CAP = Number(process.env.SPEND_DEBT_CAP) || 10_000_000;
/** Cuánto espera una llamada a que termine el cobro en vuelo cuando la deuda está en el tope. */
const CAP_WAIT_MS = 30_000;
/** Duración máxima de un permiso que acepta la red (~6 meses de ledgers de 5 s). */
export const MAX_PERMIT_LEDGERS = 3_100_000;
const LEDGERS_PER_DAY = 17_280;
/** Permiso "sin tope": el límite real es el saldo de la wallet. Cabe exacto en un Number. */
export const UNLIMITED_ALLOWANCE = 9_000_000_000_000_000;
/** Validez de una transacción preparada para que el usuario la firme. */
const PREPARED_TTL_S = 600;

// ─── Acceso a la cadena (inyectable en tests) ───────────────────────────────

export interface SpendChain {
  /** Dirección del collector (el `spender` del permiso). */
  spender(): string;
  /** Saldo USDC y permiso vigente (owner → spender), en unidades base. */
  read(owner: string): Promise<{ balance: bigint; allowance: bigint }>;
  /** Si la cuenta existe y si tiene trustline de USDC. */
  accountState(owner: string): Promise<{ exists: boolean; trustline: boolean }>;
  /** Crea la cuenta del usuario con la reserva mínima (la firma y paga el collector). */
  createAccount(owner: string): Promise<string>;
  /**
   * Cobra `amount` del owner a la treasury con transfer_from. Devuelve el hash. `onHash` recibe
   * el hash ANTES de enviar, para poder reconciliar si el proceso muere con el cobro en vuelo.
   */
  pull(owner: string, amount: bigint, onHash?: (hash: string) => Promise<void>): Promise<string>;
  /** Estado final de una transacción enviada: 'success', 'failed' o 'unknown' (aún no visible). */
  txStatus(hash: string): Promise<'success' | 'failed' | 'unknown'>;
  latestLedger(): Promise<number>;
  /** Transacciones que firma el usuario (fuente = owner), sin firmar, en XDR. */
  buildTrustline(owner: string): Promise<string>;
  buildApprove(owner: string, amount: bigint, expirationLedger: number): Promise<string>;
  buildPayment(from: string, to: string, amount: bigint): Promise<string>;
  /** Envía una transacción ya firmada por su fuente, con las comisiones a cargo del collector. */
  submitSponsored(signedXdr: string): Promise<string>;
  passphrase(): string;
  tokenContract(): string;
}

/** Dirección Stellar (G...) de la treasury, derivada del seed (no depende del contrato registro). */
function treasuryAddress(): string {
  return Keypair.fromRawEd25519Seed(Buffer.from(getMasterWallet().secretKey.slice(0, 32))).publicKey();
}

function collectorKeypair(): Keypair {
  const secret = process.env.SPEND_COLLECTOR_SECRET;
  if (secret) return Keypair.fromSecret(secret);
  // Derivada del seed de la treasury con separación de dominio: estable entre reinicios sin
  // exigir un secreto nuevo, y distinta de la treasury (otra cuenta, otra secuencia).
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return Keypair.fromRawEd25519Seed(
    createHash('sha256').update('kiba:spend-collector:').update(seed).digest(),
  );
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
  /** Lo que usa la secuencia del collector va en serie para no chocar. */
  private queue: Promise<unknown> = Promise.resolve();
  private funded = false;

  spender(): string {
    return this.collector.publicKey();
  }
  passphrase(): string {
    return this.cfg.networkPassphrase;
  }
  tokenContract(): string {
    return this.token.contractId();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  private async view(fn: string, args: xdr.ScVal[]): Promise<bigint> {
    // Lectura por simulación: no firma ni paga. La cuenta fuente no necesita existir on-chain.
    const tx = new TransactionBuilder(new Account(this.collector.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(this.token.call(fn, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      // Sin cuenta o sin trustline de USDC el SAC falla al leer el saldo: para nosotros es 0.
      if (fn === 'balance') return 0n;
      throw new Error(`[spend] ${fn}: ${sim.error}`);
    }
    return BigInt(scValToNative(sim.result!.retval) as bigint);
  }

  async read(owner: string): Promise<{ balance: bigint; allowance: bigint }> {
    const o = new Address(owner).toScVal();
    const [balance, allowance] = await Promise.all([
      this.view('balance', [o]),
      this.view('allowance', [o, new Address(this.spender()).toScVal()]),
    ]);
    return { balance, allowance };
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
    return (await this.server.getLatestLedger()).sequence;
  }

  private async ensureCollectorFunded(): Promise<void> {
    if (this.funded) return;
    try {
      await this.server.getAccount(this.spender());
    } catch {
      if (!this.cfg.friendbotUrl) throw new Error(`[spend] collector ${this.spender()} sin fondos (XLM)`);
      await fetch(`${this.cfg.friendbotUrl}?addr=${this.spender()}`);
    }
    this.funded = true;
  }

  private async sendAndWait(tx: Transaction | FeeBumpTransaction): Promise<string> {
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === 'ERROR') {
      const code = sent.errorResult?.result().switch().name ?? 'ERROR';
      throw new Error(`[spend] rechazada al enviar: ${code}`);
    }
    const res = await this.server.pollTransaction(sent.hash, { attempts: 60 });
    if (res.status !== 'SUCCESS') throw new Error(`[spend] tx ${sent.hash} ${res.status}`);
    return sent.hash;
  }

  async txStatus(hash: string): Promise<'success' | 'failed' | 'unknown'> {
    const r = await this.server.getTransaction(hash);
    if (r.status === 'SUCCESS') return 'success';
    if (r.status === 'FAILED') return 'failed';
    return 'unknown';
  }

  createAccount(owner: string): Promise<string> {
    return this.serial(async () => {
      await this.ensureCollectorFunded();
      const tx = new TransactionBuilder(await this.horizon.loadAccount(this.spender()), {
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

  pull(owner: string, amount: bigint, onHash?: (hash: string) => Promise<void>): Promise<string> {
    return this.serial(async () => {
      await this.ensureCollectorFunded();
      const acc = await this.server.getAccount(this.spender());
      let tx = new TransactionBuilder(acc, { fee: '100000', networkPassphrase: this.cfg.networkPassphrase })
        .addOperation(
          this.token.call(
            'transfer_from',
            new Address(this.spender()).toScVal(),
            new Address(owner).toScVal(),
            new Address(treasuryAddress()).toScVal(),
            nativeToScVal(amount, { type: 'i128' }),
          ),
        )
        .setTimeout(60)
        .build();
      tx = await this.server.prepareTransaction(tx);
      tx.sign(this.collector);
      await onHash?.(tx.hash().toString('hex'));
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

  async buildApprove(owner: string, amount: bigint, expirationLedger: number): Promise<string> {
    const acc = await this.server.getAccount(owner);
    const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: this.cfg.networkPassphrase })
      .addOperation(
        this.token.call(
          'approve',
          new Address(owner).toScVal(),
          new Address(this.spender()).toScVal(),
          nativeToScVal(amount, { type: 'i128' }),
          nativeToScVal(expirationLedger, { type: 'u32' }),
        ),
      )
      .setTimeout(PREPARED_TTL_S)
      .build();
    return (await this.server.prepareTransaction(tx)).toXDR();
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
/** Tests: sustituye el acceso a la cadena y reinicia el estado en memoria (reintentos). */
export function setSpendChain(c: SpendChain | null): void {
  chain = c;
  retryAfter.clear();
  lastRead.clear();
}

// ─── Verificación del approve firmado ───────────────────────────────────────

export interface ParsedApprove {
  owner: string;
  amount: bigint;
  expirationLedger: number;
}

/**
 * Comprueba que un XDR firmado sea exactamente un approve de USDC del owner al collector,
 * con la cuenta fuente = owner y firmado por él. Así vincular una dirección prueba que el
 * usuario la controla (nadie puede usar como suya la wallet de otro).
 */
export function parseSignedApprove(
  signedXdr: string,
  expect: { passphrase: string; tokenContract: string; spender: string },
): ParsedApprove {
  let tx: Transaction;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, expect.passphrase) as Transaction;
  } catch {
    throw new Error('transacción inválida');
  }
  if (!('operations' in tx) || tx.operations.length !== 1) throw new Error('se esperaba una sola operación');
  const op = tx.operations[0];
  if (op.type !== 'invokeHostFunction') throw new Error('no es una invocación de contrato');
  const fn = op.func;
  if (fn.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw new Error('no es una invocación de contrato');
  }
  const call = fn.invokeContract();
  const contract = Address.fromScAddress(call.contractAddress()).toString();
  if (contract !== expect.tokenContract) throw new Error('el contrato no es el de USDC');
  if (call.functionName().toString() !== 'approve') throw new Error('la función no es approve');
  const args = call.args();
  if (args.length !== 4) throw new Error('argumentos inválidos');
  const owner = Address.fromScVal(args[0]).toString();
  const spender = Address.fromScVal(args[1]).toString();
  if (spender !== expect.spender) throw new Error('el permiso no es para Kiba');
  if ((op.source ?? tx.source) !== owner) throw new Error('la cuenta que firma no es la dueña');
  if (!signedBy(tx, owner)) throw new Error('falta la firma de la dueña');
  return {
    owner,
    amount: BigInt(scValToNative(args[2]) as bigint),
    expirationLedger: Number(scValToNative(args[3])),
  };
}

function signedBy(tx: Transaction, address: string): boolean {
  const kp = Keypair.fromPublicKey(address);
  const hash = tx.hash();
  return tx.signatures.some((s) => s.hint().equals(kp.signatureHint()) && kp.verify(hash, s.signature()));
}

// ─── Estado por usuario ─────────────────────────────────────────────────────

interface SpendUserRow {
  spend_address: string | null;
  spend_kind: string | null;
  spend_debt: number;
  spend_blocked: number;
  spend_expires_ledger: number | null;
}

async function loadUser(userId: number): Promise<SpendUserRow | undefined> {
  return (await db
    .prepare('SELECT spend_address, spend_kind, spend_debt, spend_blocked, spend_expires_ledger FROM users WHERE id = ?')
    .get(userId)) as SpendUserRow | undefined;
}

/** true si el usuario tiene una wallet vinculada con permiso de gasto. */
export async function hasSpendWallet(userId: number): Promise<boolean> {
  return Boolean((await loadUser(userId))?.spend_address);
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const nowS = () => Math.floor(Date.now() / 1000);
const inflight = new Map<number, Promise<void>>();

/** Un retiro preparado y aún sin enviar congela el gasto (si no, el saldo a retirar quedaría corto). */
async function withdrawalPending(userId: number): Promise<boolean> {
  return Boolean(
    await db
      .prepare(`SELECT 1 FROM spend_prepared WHERE user_id = ? AND kind = 'withdraw' AND used = 0 AND created_at > ?`)
      .get(userId, nowS() - PREPARED_TTL_S),
  );
}

/** `left`: lo que queda para gastar tras anotar (min(saldo, permiso) − deuda), sin releer la cadena. */
export type ReserveResult = { ok: true; left: number } | { ok: false; reason: string };

/**
 * Lectura de saldo + permiso para anotar una llamada. El RPC de Soroban responde en ~0.1 s pero
 * ~5% de las lecturas tarda >2 s (medido: hasta 12 s): si tarda más de READ_WAIT_MS se usa el
 * último valor conocido (≤ READ_MAX_AGE_MS). Es seguro: aunque el saldo real fuera menor, la
 * deuda nunca supera SPEND_DEBT_CAP, que es el riesgo que ya se acepta.
 *
 * El último valor vive en memoria y en `spend_reads`, para que tras un reinicio o un rato sin
 * uso la primera llamada tampoco dependa de un pico del RPC.
 */
const READ_WAIT_MS = 2_500;
const READ_MAX_AGE_MS = 24 * 3_600_000;
type CachedRead = { balance: bigint; allowance: bigint; at: number };
const lastRead = new Map<string, CachedRead>();

async function cachedRead(owner: string): Promise<CachedRead | undefined> {
  const mem = lastRead.get(owner);
  if (mem) return mem;
  const row = (await db
    .prepare('SELECT balance, allowance, read_at FROM spend_reads WHERE address = ?')
    .get(owner)) as { balance: number | string; allowance: number | string; read_at: number | string } | undefined;
  if (!row) return undefined;
  const c = { balance: BigInt(row.balance), allowance: BigInt(row.allowance), at: Number(row.read_at) };
  lastRead.set(owner, c);
  return c;
}

function rememberRead(owner: string, r: { balance: bigint; allowance: bigint }): void {
  const at = Date.now();
  lastRead.set(owner, { ...r, at });
  void db
    .prepare(
      `INSERT INTO spend_reads (address, balance, allowance, read_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (address) DO UPDATE SET balance = excluded.balance, allowance = excluded.allowance, read_at = excluded.read_at`,
    )
    .run(owner, r.balance.toString(), r.allowance.toString(), at)
    .catch((err: Error) => console.warn('[spend] no se pudo guardar la lectura:', err.message));
}

/** Saldo o permiso cambiaron por una tx del usuario: la próxima llamada debe leer la cadena. */
async function forgetRead(owner: string): Promise<void> {
  lastRead.delete(owner);
  await db.prepare('DELETE FROM spend_reads WHERE address = ?').run(owner);
}

async function readForReserve(owner: string): Promise<{ balance: bigint; allowance: bigint }> {
  const fresh = getChain()
    .read(owner)
    .then((r) => {
      rememberRead(owner, r);
      return r;
    });
  const cached = await cachedRead(owner);
  if (!cached || Date.now() - cached.at > READ_MAX_AGE_MS) return fresh;
  fresh.catch(() => {});
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), READ_WAIT_MS).unref());
  return (await Promise.race([fresh, timeout])) ?? cached;
}

/** Tras un cobro, el último saldo conocido baja en lo cobrado (sin esperar a releer). */
async function afterPull(owner: string, amount: bigint): Promise<void> {
  const c = lastRead.get(owner);
  if (c) lastRead.set(owner, { balance: c.balance - amount, allowance: c.allowance - amount, at: c.at });
  // El cobro ya está aplicado: un fallo aquí solo deja la caché algo alta (acotado por el tope).
  await db
    .prepare('UPDATE spend_reads SET balance = balance - ?, allowance = allowance - ? WHERE address = ?')
    .run(amount.toString(), amount.toString(), owner)
    .catch((err: Error) => console.warn('[spend] no se pudo actualizar la lectura:', err.message));
}

/**
 * Anota `amount` como deuda si cabe en min(saldo, permiso) on-chain y en el tope de deuda.
 * Atómico frente a llamadas concurrentes (el UPDATE re-chequea las dos cotas).
 */
export async function reserveSpend(userId: number, amount: number): Promise<ReserveResult> {
  let u = await loadUser(userId);
  if (!u?.spend_address) return { ok: false, reason: 'sin wallet de pagos' };
  const address = u.spend_address;
  if (await withdrawalPending(userId)) return { ok: false, reason: 'hay un retiro en curso' };
  if (u.spend_blocked) {
    await retryBlocked(userId);
    u = (await loadUser(userId))!;
    if (u.spend_blocked) return { ok: false, reason: 'cobro pendiente fallido: recarga tu wallet de pagos' };
  }
  if (u.spend_debt + amount > SPEND_DEBT_CAP) {
    // Deuda en el tope: espera al cobro en vuelo (o lo dispara) antes de decidir.
    await Promise.race([settleSpend(userId), new Promise((r) => setTimeout(r, CAP_WAIT_MS).unref())]);
    u = (await loadUser(userId))!;
    if (u.spend_debt + amount > SPEND_DEBT_CAP) return { ok: false, reason: 'deuda en el tope, cobro en curso' };
  }
  const { balance, allowance } = await readForReserve(address);
  const available = min(balance, allowance);
  const row = await db
    .prepare(
      `UPDATE users SET spend_debt = spend_debt + ?
       WHERE id = ? AND spend_blocked = 0 AND spend_debt + ? <= ? AND spend_debt + ? <= ?
       RETURNING spend_debt`,
    )
    .get(amount, userId, amount, SPEND_DEBT_CAP, amount, Number(available)) as { spend_debt: number } | undefined;
  if (!row) {
    return Number(available) < u.spend_debt + amount
      ? { ok: false, reason: 'saldo insuficiente en tu wallet de pagos' }
      : { ok: false, reason: 'deuda en el tope, cobro en curso' };
  }
  if (row.spend_debt * 2 >= SPEND_DEBT_CAP) void settleSpend(userId);
  return { ok: true, left: Number(available) - row.spend_debt };
}

/** Devuelve una reserva (la llamada al servicio falló). La deuda puede quedar negativa = a favor. */
export async function releaseSpend(userId: number, amount: number): Promise<void> {
  await db.prepare('UPDATE users SET spend_debt = spend_debt - ? WHERE id = ?').run(amount, userId);
}

/** Tras un fallo que no es por fondos, cuánto esperar antes de volver a intentar el cobro. */
const RETRY_BACKOFF_MS = 30_000;
const retryAfter = new Map<number, number>();
/** Un cobro cuyo resultado no se ve tras este tiempo ya no puede entrar (la tx vence a los 60 s). */
const PENDING_EXPIRY_S = 300;

/** Marca un cobro como hecho y descuenta la deuda, una sola vez (solo si seguía pendiente). */
async function applySettled(chargeId: number, userId: number, amount: number, hash: string): Promise<void> {
  await withTransaction(async (tx) => {
    const upd = await tx
      .prepare(`UPDATE spend_charges SET status = 'settled', tx_hash = ?, settled_at = ? WHERE id = ? AND status = 'pending' RETURNING id`)
      .get(hash, nowS(), chargeId);
    if (upd) {
      await tx.prepare('UPDATE users SET spend_debt = spend_debt - ?, spend_blocked = 0 WHERE id = ?').run(amount, userId);
    }
  });
}

/**
 * Resuelve los cobros que quedaron pendientes (el proceso murió o se perdió la confirmación con la
 * tx ya enviada): consulta su hash on-chain. Así una deuda ya cobrada nunca se vuelve a cobrar.
 * Devuelve cuántos siguen sin resolver.
 */
export async function reconcilePendingSpend(userId?: number): Promise<number> {
  const rows = (await db
    .prepare(
      `SELECT id, user_id, amount, tx_hash, created_at FROM spend_charges
       WHERE status = 'pending' ${userId === undefined ? '' : 'AND user_id = ?'}`,
    )
    .all(...(userId === undefined ? [] : [userId]))) as {
    id: number;
    user_id: number;
    amount: number;
    tx_hash: string | null;
    created_at: number;
  }[];
  let unresolved = 0;
  for (const r of rows) {
    const old = nowS() - r.created_at > PENDING_EXPIRY_S;
    // Sin hash aún: otro proceso puede estar a punto de enviarlo; solo se da por fallido si es viejo.
    const status = r.tx_hash
      ? await getChain().txStatus(r.tx_hash).catch(() => 'unknown' as const)
      : 'unknown';
    if (status === 'success') {
      await applySettled(r.id, r.user_id, r.amount, r.tx_hash!);
    } else if (status === 'failed' || old) {
      await db
        .prepare(`UPDATE spend_charges SET status = 'failed', error = ?, settled_at = ? WHERE id = ? AND status = 'pending'`)
        .run('no llegó a la cadena', nowS(), r.id);
    } else {
      unresolved++;
    }
  }
  return unresolved;
}

/**
 * Cobra on-chain toda la deuda del usuario (una sola transferencia). Una sola en vuelo por
 * usuario. Si falla por fondos (saldo o permiso por debajo de la deuda), bloquea la cuenta.
 */
export function settleSpend(userId: number): Promise<void> {
  const running = inflight.get(userId);
  if (running) return running;
  const task = (async () => {
    if (Date.now() < (retryAfter.get(userId) ?? 0)) return;
    // Un cobro anterior sin resolver puede haber entrado: no cobrar de nuevo hasta saberlo.
    if ((await reconcilePendingSpend(userId)) > 0) return;
    const u = await loadUser(userId);
    if (!u?.spend_address || u.spend_debt <= 0) return;
    const amount = u.spend_debt;
    // El índice único de "un pendiente por usuario" hace de candado entre procesos.
    const charge = (await db
      .prepare(
        `INSERT INTO spend_charges (user_id, address, amount, status, created_at)
         VALUES (?, ?, ?, 'pending', ?) ON CONFLICT DO NOTHING RETURNING id`,
      )
      .get(userId, u.spend_address, amount, nowS())) as { id: number } | undefined;
    if (!charge) return;
    const chargeId = Number(charge.id);
    let sentHash: string | null = null;
    try {
      const hash = await getChain().pull(u.spend_address, BigInt(amount), async (h) => {
        sentHash = h;
        await db.prepare('UPDATE spend_charges SET tx_hash = ? WHERE id = ?').run(h, chargeId);
      });
      await applySettled(chargeId, userId, amount, hash);
      await afterPull(u.spend_address, BigInt(amount));
      retryAfter.delete(userId);
    } catch (err) {
      // Con la tx ya enviada el error puede ser solo de confirmación: la cadena decide.
      if (sentHash) {
        const status = await getChain().txStatus(sentHash).catch(() => 'unknown' as const);
        if (status === 'success') {
          await applySettled(chargeId, userId, amount, sentHash);
          return;
        }
        if (status === 'unknown') return; // queda pendiente; lo resuelve reconcilePendingSpend
      }
      // Los HostError de Soroban traen todo el log de eventos: basta la primera línea.
      const msg = (err as Error).message.split('\n')[0];
      let shortOfFunds = true;
      try {
        const { balance, allowance } = await getChain().read(u.spend_address);
        shortOfFunds = min(balance, allowance) < BigInt(amount);
      } catch {
        // Sin poder leer la cadena no sabemos la causa: bloqueamos por prudencia.
      }
      await db
        .prepare(`UPDATE spend_charges SET status = 'failed', error = ?, settled_at = ? WHERE id = ?`)
        .run(msg.slice(0, 500), nowS(), chargeId);
      if (shortOfFunds) {
        await db.prepare('UPDATE users SET spend_blocked = 1 WHERE id = ?').run(userId);
        console.warn(`[spend] user ${userId} bloqueado: cobro de ${amount} falló (${msg})`);
      } else {
        retryAfter.set(userId, Date.now() + RETRY_BACKOFF_MS);
        console.warn(`[spend] cobro de user ${userId} falló sin falta de fondos, se reintentará: ${msg}`);
      }
    }
  })().finally(() => inflight.delete(userId));
  inflight.set(userId, task);
  return task;
}

/** Cuenta bloqueada: si la wallet ya cubre la deuda, reintenta el cobro (lo desbloquea al cobrar). */
async function retryBlocked(userId: number): Promise<void> {
  const u = await loadUser(userId);
  if (!u?.spend_address || !u.spend_blocked) return;
  const { balance, allowance } = await getChain().read(u.spend_address);
  if (min(balance, allowance) >= BigInt(Math.max(u.spend_debt, 0))) {
    if (u.spend_debt <= 0) {
      await db.prepare('UPDATE users SET spend_blocked = 0 WHERE id = ?').run(userId);
      return;
    }
    await settleSpend(userId);
  }
}

/** Job periódico: cobra la deuda de todos y reintenta los bloqueados que ya tienen fondos. */
export async function settleAllSpend(): Promise<void> {
  await reconcilePendingSpend();
  const rows = (await db
    .prepare('SELECT id, spend_blocked FROM users WHERE spend_address IS NOT NULL AND spend_debt > 0')
    .all()) as { id: number; spend_blocked: number }[];
  for (const r of rows) {
    try {
      await (r.spend_blocked ? retryBlocked(r.id) : settleSpend(r.id));
    } catch (err) {
      console.warn(`[spend] settle user ${r.id}:`, (err as Error).message);
    }
  }
}

// ─── Transacciones que firma el usuario ─────────────────────────────────────

export type PreparedKind = 'trustline' | 'approve' | 'withdraw';

export interface PreparedTx {
  kind: PreparedKind;
  /** Hash (hex) que firma el usuario: con Privy `signRawHash({ hash: '0x' + hash })`. */
  hash: string;
  /** XDR sin firmar, para wallets que firman transacciones completas (Stellar Wallets Kit). */
  xdr: string;
  networkPassphrase: string;
}

const ADDRESS_RE = /^G[A-Z2-7]{55}$/;

async function storePrepared(userId: number, kind: PreparedKind, address: string, txXdr: string, meta: object = {}): Promise<PreparedTx> {
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

/** Una dirección solo puede ser la wallet de pagos de una cuenta de Kiba. */
async function assertAddressFree(userId: number, address: string): Promise<void> {
  const taken = await db.prepare('SELECT id FROM users WHERE spend_address = ? AND id <> ?').get(address, userId);
  if (taken) throw new Error('esa wallet ya está vinculada a otra cuenta');
}

/**
 * Primer paso para activar una wallet de pagos. Si la cuenta no existe, Kiba la crea con la
 * reserva mínima. Si le falta la trustline de USDC, devuelve la transacción para que la firme
 * el usuario (Kiba paga la comisión). `null` = ya está lista para firmar el permiso.
 */
export async function prepareActivation(userId: number, address: string): Promise<PreparedTx | null> {
  if (!ADDRESS_RE.test(address)) throw new Error('dirección Stellar inválida');
  await assertAddressFree(userId, address);
  const c = getChain();
  let state = await c.accountState(address);
  if (!state.exists) {
    // Solo para wallets que aún no son de nadie en Kiba; una por cuenta.
    const u = await loadUser(userId);
    if (u?.spend_address && u.spend_address !== address) throw new Error('ya tienes una wallet de pagos');
    await c.createAccount(address);
    state = await c.accountState(address);
  }
  if (state.trustline) return null;
  return storePrepared(userId, 'trustline', address, await c.buildTrustline(address));
}

/**
 * Prepara el permiso de gasto. Sin `amount` = sin tope (el límite es el saldo de la wallet).
 * `amount` 0 = revocar. `days` se acota al máximo que acepta la red (~6 meses).
 */
export async function prepareApprove(
  userId: number,
  args: { address: string; amount?: number; days?: number; kind?: 'privy' | 'external' },
): Promise<PreparedTx & { expirationLedger: number; spender: string }> {
  const c = getChain();
  if (!ADDRESS_RE.test(args.address)) throw new Error('dirección Stellar inválida');
  await assertAddressFree(userId, args.address);
  const amount = args.amount ?? UNLIMITED_ALLOWANCE;
  if (!(amount >= 0) || amount > UNLIMITED_ALLOWANCE) throw new Error('monto inválido');
  const state = await c.accountState(args.address);
  if (!state.exists || !state.trustline) throw new Error('activa la wallet de pagos primero');
  const latest = await c.latestLedger();
  const ledgers = Math.min(Math.max(1, Math.round((args.days ?? 180) * LEDGERS_PER_DAY)), MAX_PERMIT_LEDGERS);
  // Revocar (monto 0) no necesita vencimiento futuro.
  const expirationLedger = amount === 0 ? latest : latest + ledgers;
  const built = await c.buildApprove(args.address, BigInt(amount), expirationLedger);
  const p = await storePrepared(userId, 'approve', args.address, built, { kind: args.kind ?? 'external' });
  return { ...p, expirationLedger, spender: c.spender() };
}

/**
 * Prepara un retiro de USDC desde la wallet de pagos. Antes cobra la deuda pendiente: lo que se
 * retira es lo que queda. Mientras el retiro esté preparado no se anota más consumo.
 */
export async function prepareWithdraw(
  userId: number,
  args: { to: string; amount?: number },
): Promise<PreparedTx & { amountBaseUnits: number }> {
  const u = await loadUser(userId);
  if (!u?.spend_address) throw new Error('no tienes wallet de pagos');
  if (!ADDRESS_RE.test(args.to)) throw new Error('dirección de destino inválida');
  if (args.to === u.spend_address) throw new Error('el destino es la misma wallet');
  const dest = await getChain().accountState(args.to);
  if (!dest.exists) throw new Error('la wallet de destino no existe en la red');
  if (!dest.trustline) throw new Error('la wallet de destino no acepta USDC (le falta la línea de confianza de USDC)');
  // Si ya había un cobro en vuelo (p.ej. el del job), settleSpend devuelve ESE: lo anotado después
  // necesita otra vuelta.
  let after = (await loadUser(userId))!;
  for (let i = 0; i < 3 && after.spend_debt > 0; i++) {
    await settleSpend(userId);
    after = (await loadUser(userId))!;
  }
  if (after.spend_debt > 0) throw new Error('hay consumo pendiente de cobrar; inténtalo en un minuto');
  const { balance } = await getChain().read(u.spend_address);
  const max = Number(balance);
  const amount = args.amount === undefined ? max : args.amount;
  if (!(amount > 0)) throw new Error('no hay saldo para retirar');
  if (amount > max) throw new Error('el monto supera el saldo de la wallet de pagos');
  const built = await getChain().buildPayment(u.spend_address, args.to, BigInt(amount));
  const p = await storePrepared(userId, 'withdraw', u.spend_address, built, { to: args.to, amount });
  return { ...p, amountBaseUnits: amount };
}

/**
 * Recibe la firma del usuario sobre una transacción que preparó el gateway, la envía con las
 * comisiones a cargo de Kiba y aplica su efecto (vincular la wallet, revocar, retirar).
 * Acepta la firma del hash (hex, Privy) o el XDR firmado (Stellar Wallets Kit).
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
  if (row.kind === 'approve') {
    parseSignedApprove(tx.toXDR(), { passphrase: c.passphrase(), tokenContract: c.tokenContract(), spender: c.spender() });
  }

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

  // Revocar o retirar cambia saldo/permiso: la próxima llamada debe leer la cadena, no la caché.
  await forgetRead(row.address);
  const meta = JSON.parse(row.meta || '{}') as { kind?: string; to?: string; amount?: number };
  if (row.kind === 'approve') {
    const parsed = parseSignedApprove(tx.toXDR(), {
      passphrase: c.passphrase(),
      tokenContract: c.tokenContract(),
      spender: c.spender(),
    });
    const u = await loadUser(userId);
    if (u?.spend_address && u.spend_address !== row.address && u.spend_debt > 0) {
      // No debería pasar (se cobra antes), pero no se pierde la deuda de la wallet anterior.
      await settleSpend(userId);
    }
    await db
      .prepare('UPDATE users SET spend_address = ?, spend_kind = ?, spend_expires_ledger = ? WHERE id = ?')
      .run(row.address, meta.kind ?? 'external', parsed.amount > 0n ? parsed.expirationLedger : null, userId);
  } else if (row.kind === 'withdraw') {
    await db
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
         VALUES (?, 'withdraw', ?, 'pay-wallet', ?, ?, ?)`,
      )
      .run(userId, -(meta.amount ?? 0), sent, JSON.stringify({ to: meta.to }), nowS());
  }
  return { kind: row.kind, hash: sent, address: row.address };
}

// ─── Estado ─────────────────────────────────────────────────────────────────

export interface SpendStatus {
  address: string | null;
  kind: 'privy' | 'external' | null;
  spender: string;
  balanceBaseUnits: number;
  allowanceBaseUnits: number;
  /** true si el permiso es "sin tope" (el límite es el saldo). */
  unlimited: boolean;
  debtBaseUnits: number;
  debtCapBaseUnits: number;
  blocked: boolean;
  expiresLedger: number | null;
  latestLedger: number;
  /** Estimación de la fecha de vencimiento del permiso (unix s), a 5 s por ledger. */
  expiresAt: number | null;
  charges: { amount: number; status: string; txHash: string | null; createdAt: number }[];
}

export async function getSpendStatus(userId: number): Promise<SpendStatus> {
  const c = getChain();
  const u = await loadUser(userId);
  const latest = await c.latestLedger();
  const onchain = u?.spend_address ? await c.read(u.spend_address) : { balance: 0n, allowance: 0n };
  const charges = (await db
    .prepare(
      'SELECT amount, status, tx_hash, created_at FROM spend_charges WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20',
    )
    .all(userId)) as { amount: number; status: string; tx_hash: string | null; created_at: number }[];
  const exp = u?.spend_expires_ledger ?? null;
  return {
    address: u?.spend_address ?? null,
    kind: (u?.spend_kind as SpendStatus['kind']) ?? null,
    spender: c.spender(),
    balanceBaseUnits: Number(onchain.balance),
    allowanceBaseUnits: Number(onchain.allowance),
    // Medio permiso "sin tope" ya gastado sigue siendo sin tope a efectos prácticos.
    unlimited: Number(onchain.allowance) > UNLIMITED_ALLOWANCE / 2,
    debtBaseUnits: u?.spend_debt ?? 0,
    debtCapBaseUnits: SPEND_DEBT_CAP,
    blocked: Boolean(u?.spend_blocked),
    expiresLedger: exp,
    latestLedger: latest,
    expiresAt: exp && exp > latest ? nowS() + (exp - latest) * 5 : null,
    charges: charges.map((r) => ({ amount: r.amount, status: r.status, txHash: r.tx_hash, createdAt: r.created_at })),
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
 * Pasa todo el USDC de la wallet anterior a la wallet de pagos del usuario. Lo pide el usuario
 * (botón); Kiba firma con la wallet anterior (es la última vez) y paga la comisión.
 */
export async function migrateLegacyWallet(userId: number): Promise<{ hash: string; amountBaseUnits: number }> {
  const u = await loadUser(userId);
  if (!u?.spend_address) throw new Error('activa tu wallet de pagos primero');
  const s = await legacySignerFor(userId);
  if (!s) throw new Error('no tienes una wallet anterior');
  if (s.publicKey() === u.spend_address) throw new Error('la wallet anterior ya es tu wallet de pagos');
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
