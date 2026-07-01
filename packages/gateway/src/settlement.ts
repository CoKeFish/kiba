/**
 * Ledger off-chain de ganancias de agentes + liquidación on-chain por lotes.
 *
 * En modo crédito, `call_agent` NO toca la cadena: acredita la ganancia del agente aquí
 * (`recordEarning`) por el precio COMPLETO de la llamada. La liquidación (`settleAgent`) paga
 * por lotes el acumulado al wallet del agente vía un escrow SELF-RELEASE de Trustless Work (la
 * treasury fondea y libera; TW aplica el platformFee → ~95% al agente, ~5% de vuelta a la
 * treasury). Esto saca el deploy+fund+release por llamada del camino caliente.
 *
 * Concurrencia: cada fase que toca la DB es atómica vía `withTransaction` (transacción Postgres).
 * El claim marca las filas con `settlement_id` ANTES del pago on-chain: llamadas concurrentes no
 * se liquidan dos veces, y un pago que falla libera las filas (`settlement_id = NULL`) para
 * reintentar sin pérdida.
 */
import { db, withTransaction } from './db';
import { BASE_UNITS_PER_TOKEN, chainClientFor } from './chain';
import { ensureTreasuryFunded, getMasterWallet } from './wallets';

/** Monto mínimo (unidades base) para liquidar. Default 1 USDC = 1e7 stroops. */
const MIN_PAYOUT = Number(process.env.SETTLEMENT_MIN_PAYOUT) || BASE_UNITS_PER_TOKEN;

export interface SettleResult {
  service: string;
  status: 'settled' | 'skipped' | 'failed';
  amountLamports: number;
  escrowId?: string;
  reason?: string;
}

/** Acredita la ganancia de un agente (precio COMPLETO de la llamada) en el ledger off-chain. */
export async function recordEarning(args: {
  service: string;
  payTo: string;
  lamports: number;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO agent_earnings (service, pay_to, amount_lamports, created_at)
     VALUES (?, ?, ?, ?)`,
    )
    .run(args.service, args.payTo, args.lamports, now);
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

/** Servicios con acumulado pendiente (para liquidación por lotes). */
async function servicesWithAccrued(): Promise<string[]> {
  const rows = (await db
    .prepare('SELECT DISTINCT service FROM agent_earnings WHERE settlement_id IS NULL')
    .all()) as Array<{ service: string }>;
  return rows.map((r) => r.service);
}

/**
 * Liquida el acumulado de UN agente. Claim en 3 fases:
 *  1. (atómico) reclama las filas pendientes a una `settlement` 'pending'.
 *  2. (async) paga on-chain vía `settlePayout` (treasury → agente, self-release TW).
 *  3. (atómico) marca 'settled', o 'failed' + des-reclama las filas para reintentar.
 */
export async function settleAgent(service: string): Promise<SettleResult> {
  // ── Fase 1: claim atómico ────────────────────────────────────────────────
  let settlementId = 0;
  let amount = 0;
  let payTo = '';
  const claimed = await withTransaction(async (tx): Promise<{ ok: boolean; total: number }> => {
    const rows = (await tx
      .prepare(
        'SELECT id, amount_lamports, pay_to FROM agent_earnings WHERE service = ? AND settlement_id IS NULL',
      )
      .all(service)) as Array<{ id: number; amount_lamports: number; pay_to: string }>;
    const total = rows.reduce((s, r) => s + r.amount_lamports, 0);
    if (total < MIN_PAYOUT) return { ok: false, total };
    payTo = rows[0].pay_to;
    const now = Math.floor(Date.now() / 1000);
    const info = await tx
      .prepare(
        `INSERT INTO settlements (service, pay_to, amount_lamports, status, created_at)
         VALUES (?, ?, ?, 'pending', ?) RETURNING id`,
      )
      .run(service, payTo, total, now);
    settlementId = Number(info.lastInsertRowid);
    await tx
      .prepare(
        'UPDATE agent_earnings SET settlement_id = ? WHERE service = ? AND settlement_id IS NULL',
      )
      .run(settlementId, service);
    amount = total;
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

  // ── Fase 2: pago on-chain (sin transacción DB) ───────────────────────────
  try {
    await ensureTreasuryFunded();
    const cc = chainClientFor(getMasterWallet(), 'treasury');
    if (!cc) throw new Error('treasury chain client no disponible');
    const escrowId = await cc.settlePayout({
      receiver: payTo,
      service,
      engagementId: `settle-${settlementId}`,
      amountBaseUnits: BigInt(amount),
    });

    // ── Fase 3a: éxito ─────────────────────────────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    await withTransaction(async (tx) => {
      await tx
        .prepare(
          "UPDATE settlements SET status = 'settled', escrow_id = ?, signature = ?, settled_at = ? WHERE id = ?",
        )
        .run(escrowId, escrowId, now, settlementId);
      await tx
        .prepare('UPDATE agent_earnings SET settled_at = ? WHERE settlement_id = ?')
        .run(now, settlementId);
    });
    return { service, status: 'settled', amountLamports: amount, escrowId };
  } catch (err) {
    // ── Fase 3b: fallo → des-reclamar para reintentar sin pérdida ──────────
    await withTransaction(async (tx) => {
      await tx.prepare("UPDATE settlements SET status = 'failed' WHERE id = ?").run(settlementId);
      await tx
        .prepare('UPDATE agent_earnings SET settlement_id = NULL WHERE settlement_id = ?')
        .run(settlementId);
    });
    return { service, status: 'failed', amountLamports: amount, reason: (err as Error).message };
  }
}

let settling = false;

/** Liquida todos los agentes con acumulado >= mínimo. Guard de solapamiento (single-instance). */
export async function settleAllDue(): Promise<SettleResult[]> {
  if (settling) return [];
  settling = true;
  try {
    const results: SettleResult[] = [];
    for (const service of await servicesWithAccrued()) {
      results.push(await settleAgent(service));
    }
    return results;
  } finally {
    settling = false;
  }
}
