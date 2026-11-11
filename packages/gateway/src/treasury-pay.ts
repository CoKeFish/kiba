/**
 * Pagos sueltos de la tesorería (devoluciones), con reconciliación por hash.
 *
 * Mandar un pago a la red y no recibir respuesta no dice si entró: la conexión pudo cortarse, la
 * red pudo tardar o el proceso pudo reiniciarse. Reenviarlo a ciegas puede pagar dos veces; no
 * hacer nada puede dejar a alguien sin cobrar. Aquí cada pago:
 *
 *   1. Se anota en `treasury_payments` con una referencia única (`kind` + `ref`): pedir dos veces
 *      el mismo pago nunca crea dos.
 *   2. Se arma y se firma. Su hash (la huella de la transacción, que se calcula antes de enviarla)
 *      y su vencimiento se guardan ANTES de mandarlo.
 *   3. Se manda. Si la respuesta se pierde, no se reenvía: `runTreasuryPayments` le pregunta a la
 *      red por ese hash. Entró → pagado. Falló → se puede armar otro. No aparece y ya venció →
 *      nunca va a entrar, se puede armar otro. No aparece y no ha vencido → se sigue esperando.
 *
 * Quien pide el pago registra con `onTreasuryPaid` qué hacer cuando queda pagado.
 */
import { Keypair, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { db, type Tx } from './db';
import { getSpendChain } from './spend';
import { enqueueChainTask } from './treasury-queue';
import { getMasterWallet } from './wallets';

const nowS = () => Math.floor(Date.now() / 1000);
const MAX_ATTEMPTS = Number(process.env.TREASURY_PAY_MAX_ATTEMPTS) || 5;
/** Margen (s) después del vencimiento de una transacción para darla por no entrada. */
const EXPIRY_MARGIN_S = 30;
/** Un pago que se quedó a medio armar (el proceso cayó antes de guardar su hash) se suelta tras esto. */
const SENDING_STALE_S = 120;

export type TreasuryPaymentStatus = 'new' | 'sending' | 'sent' | 'done' | 'failed' | 'stuck';
export interface TreasuryPayment {
  id: number;
  kind: string;
  ref: string;
  to: string;
  amount: number;
  status: TreasuryPaymentStatus;
  /** Hash de la transacción firmada por la tesorería: con él se le pregunta a la red. */
  hash: string | null;
  /** Hash con el que quedó en la red (el de la transacción que paga la comisión). */
  txHash: string | null;
  attempts: number;
  error: string | null;
}
interface Row {
  id: number;
  kind: string;
  ref: string;
  to_address: string;
  amount: number;
  status: string;
  hash: string | null;
  tx_hash: string | null;
  expires_at: number | null;
  attempts: number;
  applied: boolean;
  error: string | null;
  updated_at: number;
}
const view = (r: Row): TreasuryPayment => ({
  id: Number(r.id),
  kind: r.kind,
  ref: r.ref,
  to: r.to_address,
  amount: Number(r.amount),
  status: r.status as TreasuryPaymentStatus,
  hash: r.hash,
  txHash: r.tx_hash,
  attempts: Number(r.attempts),
  error: r.error,
});
const load = async (id: number) => (await db.prepare('SELECT * FROM treasury_payments WHERE id = ?').get(id)) as Row | undefined;

function treasury(): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(getMasterWallet().secretKey.slice(0, 32)));
}

type PaidHandler = (p: TreasuryPayment) => Promise<void>;
const handlers = new Map<string, PaidHandler>();
/** Qué hacer cuando un pago de este tipo queda pagado (se llama una sola vez por pago). */
export function onTreasuryPaid(kind: string, fn: PaidHandler): void {
  handlers.set(kind, fn);
}

/**
 * Anota un pago por hacer. `kind` + `ref` lo identifican: anotarlo otra vez devuelve el mismo.
 * Con `tx` queda dentro de la transacción de base de datos de quien lo pide.
 */
export async function queueTreasuryPayment(q: { kind: string; ref: string; to: string; amount: number }, tx?: Tx): Promise<number> {
  if (!Number.isInteger(q.amount) || q.amount <= 0) throw new Error('monto de pago inválido');
  const d = tx ?? db;
  const now = nowS();
  const made = (await d
    .prepare(
      `INSERT INTO treasury_payments (kind, ref, to_address, amount, status, attempts, applied, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'new', 0, FALSE, ?, ?) ON CONFLICT (kind, ref) DO NOTHING RETURNING id`,
    )
    .get(q.kind, q.ref, q.to, q.amount, now, now)) as { id: number } | undefined;
  if (made) return Number(made.id);
  const existing = (await d.prepare('SELECT id FROM treasury_payments WHERE kind = ? AND ref = ?').get(q.kind, q.ref)) as { id: number };
  return Number(existing.id);
}

/** Avisa a quien pidió un pago ya confirmado. Una sola vez, aunque dos procesos lleguen a la vez. */
async function apply(id: number): Promise<void> {
  // Se toma antes de avisar: solo uno de los que lleguen lo consigue.
  const row = (await db
    .prepare(`UPDATE treasury_payments SET applied = TRUE WHERE id = ? AND status = 'done' AND applied = FALSE RETURNING *`)
    .get(id)) as Row | undefined;
  if (!row) return;
  const fn = handlers.get(row.kind);
  if (!fn) return;
  try {
    await fn(view(row));
  } catch (err) {
    // El aviso falló: queda por hacer y lo repite el trabajo periódico.
    await db.prepare('UPDATE treasury_payments SET applied = FALSE WHERE id = ?').run(id);
    throw err;
  }
}
async function markDone(id: number, txHash: string): Promise<void> {
  await db.prepare(`UPDATE treasury_payments SET status = 'done', tx_hash = ?, error = NULL, updated_at = ? WHERE id = ? AND status <> 'done'`).run(txHash, nowS(), id);
  await apply(id).catch((err) => console.error(`[tesorería] aplicar el pago ${id}:`, (err as Error).message));
}

/** Un pago enviado sin respuesta: se le pregunta a la red por su hash. */
async function reconcile(row: Row): Promise<void> {
  if (row.status !== 'sent' || !row.hash) return;
  const st = await getSpendChain().txStatus(row.hash);
  if (st.status === 'success') {
    await markDone(Number(row.id), st.hash ?? row.hash);
  } else if (st.status === 'failed') {
    await db.prepare(`UPDATE treasury_payments SET status = 'failed', error = 'la red la rechazó', updated_at = ? WHERE id = ? AND status = 'sent'`).run(nowS(), row.id);
  } else if (row.expires_at != null && nowS() > Number(row.expires_at) + EXPIRY_MARGIN_S) {
    // No está en la red y ya venció: no puede entrar más. Se puede armar otro sin duplicar.
    await db.prepare(`UPDATE treasury_payments SET status = 'failed', error = 'venció sin entrar', updated_at = ? WHERE id = ? AND status = 'sent'`).run(nowS(), row.id);
  }
}

/**
 * Hace (o termina de hacer) un pago anotado. Devuelve cómo quedó:
 * `done` = pagado; `sent` = enviado sin respuesta, se resuelve solo; `failed` = no entró, se reintenta.
 */
export async function sendTreasuryPayment(id: number): Promise<TreasuryPayment> {
  let row = await load(id);
  if (!row) throw new Error(`pago ${id} no existe`);
  if (row.status === 'sent') {
    await reconcile(row);
    row = (await load(id))!;
  }
  if (row.status !== 'new' && row.status !== 'failed') return view(row);
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    await db.prepare(`UPDATE treasury_payments SET status = 'stuck', updated_at = ? WHERE id = ? AND status IN ('new', 'failed')`).run(nowS(), id);
    console.error(`[tesorería] el pago ${id} (${row.kind} ${row.ref}) no entra tras ${row.attempts} intentos; hay que revisarlo a mano`);
    return view((await load(id))!);
  }
  // Tomarlo: dos procesos a la vez no arman dos transacciones para el mismo pago.
  const taken = await db
    .prepare(`UPDATE treasury_payments SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status IN ('new', 'failed') RETURNING id`)
    .get(nowS(), id);
  if (!taken) return view((await load(id))!);

  let stored = false;
  try {
    const txHash = await enqueueChainTask(async () => {
      const sc = getSpendChain();
      const k = treasury();
      const tx = TransactionBuilder.fromXDR(await sc.buildPayment(k.publicKey(), row!.to_address, BigInt(row!.amount)), sc.passphrase()) as Transaction;
      tx.sign(k);
      const hash = tx.hash().toString('hex');
      const expiresAt = Number(tx.timeBounds?.maxTime ?? 0) || nowS() + 600;
      // El hash queda guardado ANTES de enviar: si la respuesta se pierde, hay con qué preguntar.
      await db.prepare(`UPDATE treasury_payments SET status = 'sent', hash = ?, expires_at = ?, updated_at = ? WHERE id = ?`).run(hash, expiresAt, nowS(), id);
      stored = true;
      return sc.submitSponsored(tx.toXDR());
    });
    await markDone(id, txHash);
  } catch (err) {
    const msg = String((err as Error).message).split('\n')[0].slice(0, 300);
    if (stored) {
      // Enviado sin confirmación: NO se reenvía. Lo decide la red, por el hash.
      await db.prepare('UPDATE treasury_payments SET error = ?, updated_at = ? WHERE id = ?').run(msg, nowS(), id);
      await reconcile((await load(id))!).catch(() => undefined);
    } else {
      // No llegó a firmarse ni a enviarse: no hay nada en la red.
      await db.prepare(`UPDATE treasury_payments SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'sending'`).run(msg, nowS(), id);
    }
  }
  return view((await load(id))!);
}

/** Anota un pago y lo intenta ya. Pedirlo otra vez con la misma referencia no lo repite. */
export async function payFromTreasury(q: { kind: string; ref: string; to: string; amount: number }): Promise<TreasuryPayment> {
  return sendTreasuryPayment(await queueTreasuryPayment(q));
}

let running = false;
/** Trabajo periódico: resuelve los pagos sin respuesta, reintenta los que no entraron y avisa de los pagados. */
export async function runTreasuryPayments(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Un pago a medio armar de un proceso que cayó: no se envió nada (el hash se guarda antes).
    await db
      .prepare(`UPDATE treasury_payments SET status = 'failed', error = 'quedó a medio armar', updated_at = ? WHERE status = 'sending' AND updated_at < ?`)
      .run(nowS(), nowS() - SENDING_STALE_S);
    const rows = (await db
      .prepare(`SELECT * FROM treasury_payments WHERE status IN ('sent', 'new', 'failed') OR (status = 'done' AND applied = FALSE) ORDER BY id LIMIT 200`)
      .all()) as Row[];
    for (const r of rows) {
      try {
        if (r.status === 'done') await apply(Number(r.id));
        else await sendTreasuryPayment(Number(r.id));
      } catch (err) {
        console.error(`[tesorería] pago ${r.id}:`, (err as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

export async function getTreasuryPayment(kind: string, ref: string): Promise<TreasuryPayment | null> {
  const row = (await db.prepare('SELECT * FROM treasury_payments WHERE kind = ? AND ref = ?').get(kind, ref)) as Row | undefined;
  return row ? view(row) : null;
}
