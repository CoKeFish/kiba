/**
 * Libro de ganancias de los publicadores y su pago por lotes.
 *
 * Cada llamada servida anota aquí lo que ganó el servicio (`recordEarning`), por el precio
 * COMPLETO de la llamada. De ahí la ganancia sigue uno de dos caminos:
 *   - Con retención (lo normal): retention.ts la mete en el escrow del publicador y la libera
 *     al vencer su plazo. Aquí no se paga nada.
 *   - Sin retención: `settleAgent` paga lo acumulado con UNA tx del contrato de pagos de Kiba.
 *
 * Nunca se paga dos veces: las ganancias se reservan a una liquidación ('pending') ANTES de
 * enviar el pago, y un pago que falla las libera para reintentar. Todo `settleAgent` corre como
 * UNA tarea de la cola de la tesorería.
 */
import { db, withTransaction } from './db';
import { BASE_UNITS_PER_TOKEN } from './chain';
import { enqueueChainTask } from './treasury-queue';
import { KIBA_PAY_REF, kibaPayEnabled, reconcileKibaPays, sendKibaPay, treasuryClient } from './kiba-pay';
import { retentionEnabled } from './retention';

/** Monto mínimo (unidades base) para liquidar. Default 1 USDC = 1e7 stroops. */
export const MIN_PAYOUT = Number(process.env.SETTLEMENT_MIN_PAYOUT) || BASE_UNITS_PER_TOKEN;

export interface SettleResult {
  service: string;
  status: 'settled' | 'skipped' | 'failed';
  amountLamports: number;
  escrowId?: string;
  reason?: string;
}

/**
 * Acredita la ganancia de un agente (precio COMPLETO de la llamada) en el ledger off-chain.
 * Devuelve el id de la fila.
 */
export async function recordEarning(args: {
  service: string;
  payTo: string;
  lamports: number;
  /** Quién pagó la llamada y cómo: permite reclamarla y devolverla por donde salió (retention.ts). */
  paidBy?: { userId: number; transactionId: number; paidWith: 'credit' | 'deposit'; channelId?: number };
}): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const p = args.paidBy;
  const info = await db
    .prepare(
      `INSERT INTO agent_earnings (service, pay_to, amount_lamports, created_at, user_id, tx_id, paid_with, channel_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(args.service, args.payTo, args.lamports, now, p?.userId ?? null, p?.transactionId ?? null, p?.paidWith ?? null, p?.channelId ?? null);
  return Number(info.lastInsertRowid);
}

/** Acumulado pendiente de liquidar de un agente, en unidades base. */
export async function getAccrued(service: string): Promise<number> {
  // SUM(bigint) en Postgres es `numeric` (llega como string): casteamos a ::bigint
  // para que el parser int8 lo devuelva como Number.
  const row = (await db
    .prepare(
      'SELECT COALESCE(SUM(amount_lamports), 0)::bigint AS total FROM agent_earnings WHERE service = ? AND settlement_id IS NULL',
    )
    .get(service)) as { total: number };
  return row.total;
}

/**
 * Servicios elegibles para la liquidación AUTOMÁTICA por lotes (cron): tienen acumulado
 * pendiente Y su owner activó el opt-in (`users.auto_settle = 1`). Los servicios de publishers
 * sin opt-in solo se liquidan bajo demanda (POST /v1/publisher/settle) — nunca por el cron.
 * Exportada para testear el gate sin cadena.
 */
export async function servicesToAutoSettle(): Promise<string[]> {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT e.service
       FROM agent_earnings e
       JOIN user_agents ua ON ua.service = e.service
       JOIN users u ON u.id = ua.user_id
       WHERE e.settlement_id IS NULL AND u.auto_settle = 1`,
    )
    .all()) as Array<{ service: string }>;
  return rows.map((r) => r.service);
}

/** Paga lo acumulado de UN servicio (solo sin retención). Corre en la cola de la tesorería. */
export async function settleAgent(service: string): Promise<SettleResult> {
  return enqueueChainTask(() => settleAgentInner(service));
}

async function settleAgentInner(service: string): Promise<SettleResult> {
  // Con retención, las ganancias no se liquidan a pedido: se liberan solas al vencer su plazo.
  if (retentionEnabled()) {
    return {
      service,
      status: 'skipped',
      amountLamports: await getAccrued(service),
      reason: 'las ganancias se liberan al vencer su plazo de retención',
    };
  }
  if (!kibaPayEnabled()) {
    return {
      service,
      status: 'skipped',
      amountLamports: await getAccrued(service),
      reason: 'no hay forma de pago configurada: falta la retención o el contrato de pagos',
    };
  }
  await reconcileKibaPays();
  return settleWithKibaPay(service);
}

/**
 * Paga con el contrato de Kiba las ganancias pendientes del servicio: reserva atómica en una liquidación 'pending' + UNA tx `pay`. Corre dentro
 * de la cola de la treasury (desde settleAgentInner).
 */
async function settleWithKibaPay(service: string): Promise<SettleResult> {
  let settlementId = 0;
  let payTo = '';
  const claimed = await withTransaction(async (tx): Promise<{ ok: boolean; total: number }> => {
    const rows = (await tx
      .prepare(
        `SELECT amount_lamports, pay_to FROM agent_earnings
         WHERE service = ? AND settlement_id IS NULL AND escrow_id IS NULL`,
      )
      .all(service)) as Array<{ amount_lamports: number; pay_to: string }>;
    const total = rows.reduce((s, r) => s + Number(r.amount_lamports), 0);
    if (total < MIN_PAYOUT) return { ok: false, total };
    payTo = rows[0].pay_to;
    const info = await tx
      .prepare(
        `INSERT INTO settlements (service, pay_to, amount_lamports, escrow_id, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id`,
      )
      .run(service, payTo, total, KIBA_PAY_REF, Math.floor(Date.now() / 1000));
    settlementId = Number(info.lastInsertRowid);
    await tx
      .prepare(
        'UPDATE agent_earnings SET settlement_id = ? WHERE service = ? AND settlement_id IS NULL AND escrow_id IS NULL',
      )
      .run(settlementId, service);
    return { ok: true, total };
  });
  if (!claimed.ok) {
    return {
      service,
      status: 'skipped',
      amountLamports: claimed.total,
      reason: `acumulado ${claimed.total} < mínimo ${MIN_PAYOUT}`,
    };
  }
  const cc = treasuryClient();
  if (!cc?.payService) {
    await db.prepare("UPDATE settlements SET status = 'failed' WHERE id = ?").run(settlementId);
    await db.prepare('UPDATE agent_earnings SET settlement_id = NULL WHERE settlement_id = ?').run(settlementId);
    return { service, status: 'failed', amountLamports: claimed.total, reason: 'treasury chain client no disponible' };
  }
  const r = await sendKibaPay(cc, settlementId, payTo, claimed.total);
  if (r.status === 'settled') {
    return { service, status: 'settled', amountLamports: claimed.total, escrowId: r.hash };
  }
  return {
    service,
    status: 'failed',
    amountLamports: claimed.total,
    reason: r.status === 'pending' ? `pago sin confirmación (${r.hash}); se reconcilia` : r.error,
  };
}

let settling = false;

/**
 * Liquida (cron) los agentes de publishers con opt-in a auto-liquidación y acumulado >= mínimo.
 * Guard de solapamiento (single-instance).
 */
export async function settleAllDue(): Promise<SettleResult[]> {
  if (settling) return [];
  settling = true;
  try {
    const results: SettleResult[] = [];
    for (const service of await servicesToAutoSettle()) {
      results.push(await settleAgent(service));
    }
    return results;
  } finally {
    settling = false;
  }
}
