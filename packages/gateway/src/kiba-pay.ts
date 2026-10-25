/**
 * Pagos a servicios con el contrato de pagos de Kiba (packages/contracts-payments).
 *
 * Reemplaza a los escrows de Trustless Work en el modo crédito: cada pago es UNA tx `pay`
 * (treasury → servicio; el contrato aplica el split 95/5), sin deploy, fondeo ni release.
 *   - Por llamada: tras servir una llamada con crédito se le paga al servicio su parte (igual
 *     que el fondeo por llamada de TW, sin depender del opt-in de liquidación automática).
 *   - Por lotes: settlement.ts paga lo acumulado con una sola tx.
 *
 * Nunca se paga dos veces: el pago se reserva en `settlements` ('pending', escrow_id =
 * KIBA_PAY_REF) y su hash se guarda ANTES de enviar. Si la red no confirma ni rechaza, la
 * fila queda pendiente y `reconcileKibaPays` decide más tarde por el hash; nunca se reenvía.
 */
import { PaymentPendingError, type ChainClient } from 'kiba-sdk';
import { db, withTransaction } from './db';
import { attachSignature } from './billing';
import { chainClientFor } from './chain';
import { ensureTreasuryFunded, getMasterWallet } from './wallets';
import {
  enqueueChainTask,
  chainQueuePending,
  fundForCall,
  perCallFundEnabled,
  type PerCallFundResult,
} from './escrows';

/** Marca en settlements.escrow_id de los pagos hechos con el contrato de Kiba. */
export const KIBA_PAY_REF = 'kiba-pay';
const MAX_PENDING = Number(process.env.CHAIN_QUEUE_MAX_PENDING) || 8;
/** Edad mínima (s) de un pago pendiente para reconciliarlo: su tx ya caducó (30 s + margen). */
const RECONCILE_AFTER_S = 90;

let client: ChainClient | null | undefined;
/** Cliente on-chain de la treasury para los pagos del contrato de Kiba. */
export function treasuryClient(): ChainClient | null {
  return (client ??= chainClientFor(getMasterWallet(), 'treasury'));
}
/** Tests: sustituye el cliente on-chain de la treasury (undefined = el real). */
export function setKibaPayClient(c: ChainClient | null | undefined): void {
  client = c;
}

/** ¿Pagos con el contrato de Kiba? KIBA_PAY=0 vuelve a Trustless Work (kill-switch). */
export function kibaPayEnabled(): boolean {
  return process.env.KIBA_PAY !== '0' && Boolean(treasuryClient()?.paymentsContractId);
}

/** Pago por llamada activo (PER_CALL_FUND=0 lo apaga, igual que el fondeo de TW). */
export function kibaPayPerCallEnabled(): boolean {
  return process.env.PER_CALL_FUND !== '0' && kibaPayEnabled();
}

async function markSettled(settlementId: number, hash: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await withTransaction(async (tx) => {
    await tx
      .prepare("UPDATE settlements SET status = 'settled', signature = ?, settled_at = ? WHERE id = ?")
      .run(hash, now, settlementId);
    await tx.prepare('UPDATE agent_earnings SET settled_at = ? WHERE settlement_id = ?').run(now, settlementId);
  });
}

/** El pago no entró: la liquidación falla y sus ganancias vuelven a quedar pendientes. */
async function markFailed(settlementId: number): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.prepare("UPDATE settlements SET status = 'failed' WHERE id = ?").run(settlementId);
    await tx.prepare('UPDATE agent_earnings SET settlement_id = NULL WHERE settlement_id = ?').run(settlementId);
  });
}

/**
 * Envía el pago de una liquidación ya reservada ('pending'). Debe correr dentro de la cola de
 * la treasury. 'pending' = no se supo si entró (lo resuelve reconcileKibaPays).
 * `reference` va en el evento `paid` del contrato: por defecto el id de la liquidación; en un
 * pago por llamada con licencia, la huella del documento de licencia (licenses.ts).
 */
export async function sendKibaPay(
  cc: ChainClient,
  settlementId: number,
  payTo: string,
  amount: number,
  reference?: bigint,
): Promise<{ status: 'settled' | 'pending' | 'failed'; hash?: string; error?: string }> {
  try {
    await ensureTreasuryFunded();
    const hash = await cc.payService!(
      { receiver: payTo, amountBaseUnits: BigInt(amount), reference: reference ?? BigInt(settlementId) },
      async (h) => {
        await db
          .prepare('UPDATE settlements SET signature = ?, escrow_id = ? WHERE id = ?')
          .run(h, KIBA_PAY_REF, settlementId);
      },
    );
    await markSettled(settlementId, hash);
    return { status: 'settled', hash };
  } catch (err) {
    if (err instanceof PaymentPendingError) {
      console.warn(`[kiba-pay] liquidación ${settlementId} sin confirmación (${err.txHash}); se reconcilia luego`);
      return { status: 'pending', hash: err.txHash };
    }
    await markFailed(settlementId);
    return { status: 'failed', error: (err as Error).message };
  }
}

/**
 * Paga al servicio UNA llamada ya servida con crédito. Mismo contrato que `fundForCall`:
 * devuelve el hash, o `{}` si no se pudo o no tocaba (la ganancia queda acumulada). NUNCA rechaza.
 */
export function payForCall(args: {
  service: string;
  payTo: string;
  lamports: number;
  earningId: number;
  transactionId?: number;
  /** Huella de la licencia (licenses.ts): viaja en el pago en vez del id de la liquidación. */
  reference?: bigint;
}): Promise<PerCallFundResult> {
  if (!kibaPayPerCallEnabled()) return Promise.resolve({});
  if (chainQueuePending() >= MAX_PENDING) {
    console.warn(`[kiba-pay] cola llena (${chainQueuePending()}); ${args.service} queda como acumulado`);
    return Promise.resolve({});
  }
  return enqueueChainTask(async (): Promise<PerCallFundResult> => {
    try {
      const cc = treasuryClient();
      if (!cc?.payService) return {};
      const now = Math.floor(Date.now() / 1000);
      // Reserva: la ganancia pasa a esta liquidación antes de enviar nada (si ya la tomó un
      // lote, no se paga aquí).
      const settlementId = await withTransaction(async (tx): Promise<number | null> => {
        const info = await tx
          .prepare(
            `INSERT INTO settlements (service, pay_to, amount_lamports, escrow_id, status, created_at)
             VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id`,
          )
          .run(args.service, args.payTo, args.lamports, KIBA_PAY_REF, now);
        const id = Number(info.lastInsertRowid);
        const claimed = await tx
          .prepare('UPDATE agent_earnings SET settlement_id = ? WHERE id = ? AND settlement_id IS NULL')
          .run(id, args.earningId);
        if (claimed.changes === 0) throw new Error('ganancia ya liquidada');
        return id;
      }).catch(() => null);
      if (settlementId == null) return {};

      const r = await sendKibaPay(cc, settlementId, args.payTo, args.lamports, args.reference);
      if (r.status !== 'settled' || !r.hash) return {};
      if (args.transactionId != null) await attachSignature(args.transactionId, r.hash);
      return { txHash: r.hash };
    } catch (err) {
      console.warn(`[kiba-pay] pago por llamada de ${args.service} falló: ${(err as Error).message}`);
      return {};
    }
  });
}

/** Pago por llamada en modo crédito: contrato de Kiba si está, si no el fondeo de TW. */
export function payOrFundForCall(args: Parameters<typeof payForCall>[0]): Promise<PerCallFundResult> {
  return kibaPayEnabled() ? payForCall(args) : fundForCall(args);
}

export function perCallPaymentEnabled(): boolean {
  return kibaPayEnabled() ? kibaPayPerCallEnabled() : perCallFundEnabled();
}

/**
 * Resuelve los pagos del contrato de Kiba que quedaron 'pending' (sin confirmación o caída del
 * proceso) consultando su hash: entró → liquidado; no entró → falla y la ganancia vuelve a
 * quedar pendiente. Sin hash (caída antes de firmar) = nunca se envió.
 */
export async function reconcileKibaPays(): Promise<number> {
  const cc = treasuryClient();
  if (!cc?.transactionStatus) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - RECONCILE_AFTER_S;
  const rows = (await db
    .prepare(
      `SELECT id, signature FROM settlements
       WHERE escrow_id = ? AND status = 'pending' AND created_at < ? ORDER BY id`,
    )
    .all(KIBA_PAY_REF, cutoff)) as Array<{ id: number; signature: string | null }>;
  let resolved = 0;
  for (const r of rows) {
    try {
      const st = r.signature ? await cc.transactionStatus(r.signature) : 'not_found';
      if (st === 'success') await markSettled(Number(r.id), r.signature!);
      else await markFailed(Number(r.id));
      resolved++;
    } catch (err) {
      console.warn(`[kiba-pay] no se pudo reconciliar la liquidación ${r.id}: ${(err as Error).message}`);
    }
  }
  return resolved;
}
