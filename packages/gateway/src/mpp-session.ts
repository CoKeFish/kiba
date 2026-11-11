/**
 * MPP por sesión, lado vendedor: un agente externo que hace muchas llamadas no paga en la red
 * cada una. Abre un canal de pago hacia Kiba, deposita USDC ahí una vez y en cada llamada manda
 * solo una firma que dice «de este canal ya te debo tanto en total». Kiba cobra al canal por
 * tandas, con la última firma.
 *
 * El canal es el mismo contrato de Stellar del depósito retirable (channel.ts), abierto con la
 * fábrica de Kiba: el agente pone el dinero y su clave de firmas, y Kiba es la destinataria.
 *
 *   1. El agente abre el canal (`prepareSessionOpen` le arma la transacción) y lo registra.
 *   2. Llama a `/mpp/<servicio>` con la cabecera `X-Mpp-Channel: <canal>`. Kiba responde 402 con
 *      el reto de sesión; el agente repite la llamada con su firma y recibe el resultado.
 *   3. Kiba cobra lo acumulado al canal cada cierto tiempo (`runMppSessionJob`).
 *
 * Antes de aceptar un canal se comprueba en la red que es el contrato auténtico, que le paga a
 * la tesorería de Kiba y que guarda USDC. Sin eso, un contrato falso serviría para llamar gratis.
 */
import { randomBytes } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { Credential, MppxServer, stellarServerChannel } from '@kiba/mpp';
import { db } from './db';
import { MPP_NETWORK, mppCurrency, mppTreasury } from './mpp';
import { CHANNEL_MIN_DEPOSIT, CHANNEL_SETTLE_MAX_AGE_S, CHANNEL_SETTLE_THRESHOLD, CHANNEL_WAIT_LEDGERS, channelFactoryId, getChannelChain } from './channel';

const nowS = () => Math.floor(Date.now() / 1000);
const CHANNEL_RE = /^C[A-Z2-7]{55}$/;

/** Lo que este módulo necesita de la red. Inyectable en tests. */
export interface SessionChain {
  describe(channel: string): Promise<{
    /** ¿Es el contrato de canal auténtico (el mismo código que crea la fábrica de Kiba)? */
    genuine: boolean;
    from: string;
    to: string;
    token: string;
    /** Clave pública (G...) con la que el agente firma lo que debe. */
    commitmentKey: string;
    waitLedgers: number;
    /** Ledger en que se hace efectivo el cierre; null = nadie pidió cerrar. */
    closeEffective: number | null;
    balance: bigint;
  }>;
  buildOpen(a: { owner: string; salt: Buffer; commitmentKey: Buffer; amount: bigint; waitLedgers: number }): Promise<string>;
  openedChannel(hash: string): Promise<string>;
  settle(channel: string, amount: bigint, sig: Buffer): Promise<string>;
}
let chain: SessionChain | null = null;
/** Tests: sustituye el acceso a la red (null = el real). */
export function setMppSessionChain(c: SessionChain | null): void {
  chain = c;
}
const getChain = (): SessionChain => chain ?? (getChannelChain() as unknown as SessionChain);

/** ¿Se puede pagar por sesión? Hace falta la fábrica de canales. */
export function mppSessionsEnabled(): boolean {
  return chain !== null || channelFactoryId() !== null;
}

export interface SessionView {
  channel: string;
  funder: string;
  status: 'open' | 'closing' | 'closed';
  /** Total que el agente ha firmado que debe (unidades base). */
  cumulativeBaseUnits: number;
  /** Lo que Kiba ya cobró al canal. */
  settledBaseUnits: number;
  /** Lo que el agente todavía puede gastar: lo que queda en el canal menos lo firmado sin cobrar. */
  availableBaseUnits: number;
  createdAt: number;
}
interface Row {
  channel: string;
  funder: string;
  commitment_key: string;
  status: string;
  cumulative: number;
  signature: string | null;
  settled: number;
  balance: number;
  last_voucher_at: number | null;
  created_at: number;
}
const view = (r: Row): SessionView => ({
  channel: r.channel,
  funder: r.funder,
  status: r.status as SessionView['status'],
  cumulativeBaseUnits: Number(r.cumulative),
  settledBaseUnits: Number(r.settled),
  availableBaseUnits: Math.max(0, Number(r.balance) - (Number(r.cumulative) - Number(r.settled))),
  createdAt: Number(r.created_at),
});

/** Datos que un agente necesita para abrir un canal hacia Kiba. */
export function sessionInfo(): Record<string, unknown> {
  return {
    network: MPP_NETWORK,
    currency: mppCurrency(),
    recipient: mppTreasury().publicKey(),
    factory: channelFactoryId(),
    refundWaitLedgers: CHANNEL_WAIT_LEDGERS,
    minDepositBaseUnits: CHANNEL_MIN_DEPOSIT,
    header: 'X-Mpp-Channel',
  };
}

/** Clave de firmas en bytes, desde una dirección G... o 64 caracteres hexadecimales. */
function commitmentKeyBytes(raw: string): Buffer {
  const v = String(raw ?? '').trim();
  if (StrKey.isValidEd25519PublicKey(v)) return Buffer.from(StrKey.decodeEd25519PublicKey(v));
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  throw new Error('commitmentKey debe ser una dirección G... o 64 caracteres hexadecimales');
}

/**
 * Arma la transacción con la que un agente abre su canal hacia Kiba. El agente la firma con su
 * cuenta y la envía a la red; después registra el canal con el hash de esa transacción.
 */
export async function prepareSessionOpen(a: { owner: string; commitmentKey: string; amount: number }): Promise<{ xdr: string; network: string }> {
  if (!StrKey.isValidEd25519PublicKey(String(a.owner ?? ''))) throw new Error('owner debe ser una dirección Stellar (G...)');
  if (!Number.isInteger(a.amount) || a.amount < CHANNEL_MIN_DEPOSIT) throw new Error(`el depósito mínimo es ${CHANNEL_MIN_DEPOSIT / 1e7} USDC`);
  const xdr = await getChain().buildOpen({
    owner: a.owner,
    salt: randomBytes(32),
    commitmentKey: commitmentKeyBytes(a.commitmentKey),
    amount: BigInt(a.amount),
    waitLedgers: CHANNEL_WAIT_LEDGERS,
  });
  return { xdr, network: MPP_NETWORK };
}

/**
 * Registra un canal ya abierto, por su dirección o por el hash de la transacción que lo abrió.
 * Solo se acepta el contrato auténtico, con Kiba de destinataria, con USDC y sin cierre pedido.
 */
export async function registerSession(a: { channel?: string; openTx?: string }): Promise<SessionView> {
  const c = getChain();
  const channel = a.channel ? String(a.channel).trim() : a.openTx ? await c.openedChannel(String(a.openTx).trim()) : '';
  if (!CHANNEL_RE.test(channel)) throw new Error('indica el canal (C...) o el hash de la transacción que lo abrió');
  const existing = (await db.prepare('SELECT * FROM mpp_sessions WHERE channel = ?').get(channel)) as Row | undefined;
  if (existing) return view(existing);

  const d = await c.describe(channel);
  if (!d.genuine) throw new Error('ese contrato no es un canal de pago de los que acepta Kiba');
  if (d.to !== mppTreasury().publicKey()) throw new Error('ese canal no le paga a Kiba');
  if (d.token !== mppCurrency()) throw new Error('ese canal no guarda USDC');
  if (d.closeEffective !== null) throw new Error('ese canal ya tiene el cierre pedido');
  if (d.balance <= 0n) throw new Error('ese canal no tiene saldo');
  await db
    .prepare(
      `INSERT INTO mpp_sessions (channel, funder, commitment_key, wait_ledgers, status, cumulative, settled, balance, created_at)
       VALUES (?, ?, ?, ?, 'open', 0, 0, ?, ?) ON CONFLICT (channel) DO NOTHING`,
    )
    .run(channel, d.from, d.commitmentKey, d.waitLedgers, d.balance.toString(), nowS());
  return view((await db.prepare('SELECT * FROM mpp_sessions WHERE channel = ?').get(channel)) as Row);
}

export async function getSession(channel: string): Promise<SessionView | null> {
  const row = (await db.prepare('SELECT * FROM mpp_sessions WHERE channel = ?').get(channel)) as Row | undefined;
  return row ? view(row) : null;
}

// ─── Cobro por sesión ───────────────────────────────────────────────────────

type ChargeResult = { status: 402; challenge: Response } | { status: 200; withReceipt: (response: Response) => Response };
export interface SessionCharger {
  charge(options: { amount: string; description?: string; meta?: Record<string, string> }): (request: Request) => Promise<ChargeResult>;
}
type ChargerFactory = (session: { channel: string; commitmentKey: string }) => SessionCharger;
let chargerFactory: ChargerFactory | null = null;
/** Tests: sustituye la comprobación de firmas (null = la real, con la librería de MPP). */
export function setMppSessionChargerFactory(f: ChargerFactory | null): void {
  chargerFactory = f;
  chargers.clear();
}
const chargers = new Map<string, SessionCharger>();

/** Quien comprueba las firmas de un canal. `deps` trae el secreto de los retos y el almacén. */
export async function sessionCharger(channel: string, deps: { secretKey: string; realm: string; store: unknown }): Promise<SessionCharger> {
  const cached = chargers.get(channel);
  if (cached) return cached;
  const row = (await db.prepare('SELECT * FROM mpp_sessions WHERE channel = ?').get(channel)) as Row | undefined;
  if (!row) throw new Error('canal no registrado');
  let made: SessionCharger;
  if (chargerFactory) {
    made = chargerFactory({ channel, commitmentKey: row.commitment_key });
  } else {
    const server = MppxServer.create({
      secretKey: deps.secretKey,
      realm: deps.realm,
      methods: [
        stellarServerChannel({
          channel,
          commitmentKey: row.commitment_key,
          recipient: mppTreasury().publicKey(),
          currency: mppCurrency(),
          network: MPP_NETWORK,
          store: deps.store as never,
          // La librería lee el estado del canal con una llamada del SDK de Stellar 15 que falla en
          // la red actual ("unknown StellarValueType member"). Lo que esa lectura protegía lo hace
          // este módulo: el saldo se comprueba en cada llamada (`voucherFits`) y el cierre pedido
          // lo detecta el trabajo periódico, que cobra antes de que el agente pueda retirar.
          checkOnChainState: process.env.MPP_SESSION_ONCHAIN_CHECK === '1',
          ...(process.env.STELLAR_RPC_URL ? { rpcUrl: process.env.STELLAR_RPC_URL } : {}),
        }),
      ],
    }) as unknown as { channel: SessionCharger['charge'] };
    made = { charge: (options) => server.channel(options) };
  }
  chargers.set(channel, made);
  return made;
}

/** Total firmado y firma de una prueba de pago por sesión; null si no se puede leer. */
export function parseVoucher(authorization: string | undefined): { amount: bigint; signature: string } | null {
  if (!authorization) return null;
  try {
    const p = (Credential.deserialize(authorization) as { payload?: { amount?: string; signature?: string } }).payload ?? {};
    if (!p.amount || !/^\d+$/.test(p.amount) || !p.signature || !/^[0-9a-f]+$/i.test(p.signature)) return null;
    return { amount: BigInt(p.amount), signature: p.signature };
  } catch {
    return null;
  }
}

/** ¿Cabe ese total firmado en lo que queda dentro del canal? Lo ya cobrado no cuenta. */
export async function voucherFits(channel: string, amount: bigint): Promise<boolean> {
  const r = (await db.prepare('SELECT settled, balance FROM mpp_sessions WHERE channel = ?').get(channel)) as { settled: number; balance: number } | undefined;
  return r !== undefined && amount - BigInt(r.settled) <= BigInt(r.balance);
}

/**
 * Anota la firma de una llamada ya aceptada: el total que el agente reconoce deber. Se guarda
 * solo si supera lo anterior; con ella Kiba cobra después al canal.
 */
export async function noteVoucher(channel: string, v: { amount: bigint; signature: string }): Promise<number> {
  await db
    .prepare('UPDATE mpp_sessions SET cumulative = ?, signature = ?, last_voucher_at = ? WHERE channel = ? AND cumulative < ?')
    .run(v.amount.toString(), v.signature, nowS(), channel, v.amount.toString());
  return Number(v.amount);
}

// ─── Cobro al canal, por tandas ─────────────────────────────────────────────

const SETTLE_THRESHOLD = Number(process.env.MPP_SESSION_SETTLE_THRESHOLD) || CHANNEL_SETTLE_THRESHOLD;
const SETTLE_MAX_AGE_S = Number(process.env.MPP_SESSION_SETTLE_MAX_AGE_S) || CHANNEL_SETTLE_MAX_AGE_S;

type Refunder = (to: string, lamports: number) => Promise<string>;
let running = false;
/**
 * Trabajo periódico: cobra a cada canal lo que el agente ya firmó y Kiba no ha cobrado. Cobra
 * cuando lo pendiente pasa del umbral, cuando la última firma lleva un rato, o de inmediato si
 * el agente pidió cerrar el canal. Después devuelve lo de las llamadas que fallaron.
 */
export async function runMppSessionJob(refund: Refunder, opts: { force?: boolean } = {}): Promise<number> {
  if (!mppSessionsEnabled() || running) return 0;
  running = true;
  let settledCount = 0;
  try {
    const c = getChain();
    const rows = (await db.prepare(`SELECT * FROM mpp_sessions WHERE status IN ('open', 'closing') ORDER BY created_at`).all()) as Row[];
    for (const r of rows) {
      try {
        // ¿El agente pidió cerrar por su cuenta? Entonces hay que cobrar antes de que retire.
        let status = r.status;
        if (status === 'open') {
          const d = await c.describe(r.channel);
          await db.prepare('UPDATE mpp_sessions SET balance = ? WHERE channel = ?').run(d.balance.toString(), r.channel);
          if (d.closeEffective !== null) {
            status = 'closing';
            await db.prepare(`UPDATE mpp_sessions SET status = 'closing' WHERE channel = ?`).run(r.channel);
            chargers.delete(r.channel);
          }
        }
        const pending = Number(r.cumulative) - Number(r.settled);
        const old = r.last_voucher_at != null && nowS() - Number(r.last_voucher_at) >= SETTLE_MAX_AGE_S;
        if (pending > 0 && r.signature && (opts.force || status === 'closing' || pending >= SETTLE_THRESHOLD || old)) {
          const hash = await c.settle(r.channel, BigInt(r.cumulative), Buffer.from(r.signature, 'hex'));
          await db
            .prepare('UPDATE mpp_sessions SET settled = ?, balance = GREATEST(balance - ?, 0) WHERE channel = ? AND settled < ?')
            .run(r.cumulative, pending, r.channel, r.cumulative);
          console.log(`[mpp] canal ${r.channel.slice(0, 8)}…: cobrados ${pending / 1e7} USDC (${hash})`);
          settledCount++;
        }
        // Un canal con el cierre pedido y nada por cobrar ya no sirve para más llamadas.
        if (status === 'closing') {
          const fresh = (await db.prepare('SELECT cumulative, settled FROM mpp_sessions WHERE channel = ?').get(r.channel)) as { cumulative: number; settled: number };
          if (Number(fresh.cumulative) <= Number(fresh.settled)) await db.prepare(`UPDATE mpp_sessions SET status = 'closed' WHERE channel = ?`).run(r.channel);
        }
      } catch (err) {
        console.error(`[mpp] cobro del canal ${r.channel}:`, (err as Error).message);
      }
    }
    // Devoluciones de llamadas que fallaron después de la firma: solo de lo que Kiba ya cobró.
    const due = (await db
      .prepare(
        `SELECT p.id, p.amount, p.voucher, s.funder FROM mpp_payments p JOIN mpp_sessions s ON s.channel = p.channel
         WHERE p.status = 'refund_pending' AND p.channel IS NOT NULL AND p.voucher <= s.settled ORDER BY p.id`,
      )
      .all()) as Array<{ id: number; amount: number; voucher: number; funder: string }>;
    for (const p of due) {
      // Apartar antes de pagar: dos pasadas a la vez no devuelven dos veces.
      const taken = await db.prepare(`UPDATE mpp_payments SET status = 'refunding' WHERE id = ? AND status = 'refund_pending' RETURNING id`).get(p.id);
      if (!taken) continue;
      try {
        const tx = await refund(p.funder, Number(p.amount));
        await db.prepare(`UPDATE mpp_payments SET status = 'refunded', refund_tx = ? WHERE id = ?`).run(tx, p.id);
      } catch (err) {
        await db.prepare(`UPDATE mpp_payments SET status = 'refund_pending' WHERE id = ?`).run(p.id);
        console.error(`[mpp] devolución del pago ${p.id}:`, (err as Error).message);
      }
    }
  } finally {
    running = false;
  }
  return settledCount;
}
