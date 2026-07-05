/**
 * Ledger off-chain de ganancias de agentes + liquidación on-chain por lotes.
 *
 * En modo crédito, `call_agent` acredita la ganancia del agente aquí (`recordEarning`)
 * por el precio COMPLETO de la llamada y, con fund per-call activo (escrows.ts), fondea
 * esa ganancia al escrow TW del ciclo del servicio (la fila queda con `escrow_id` y el
 * usuario ve la tx consultable). La liquidación (`settleAgent`) paga el acumulado al
 * agente vía el settle clásico self-release (deploy+fund+release; TW aplica el
 * platformFee → ~95% al agente) y CIERRA los escrows del ciclo (ver nota en fase 2:
 * la API dev de TW no permite liberar por balance).
 *
 * Concurrencia: cada fase que toca la DB es atómica vía `withTransaction` (transacción Postgres).
 * El claim marca las filas con `settlement_id` ANTES del pago on-chain: llamadas concurrentes no
 * se liquidan dos veces, y un pago que falla libera las filas (`settlement_id = NULL`) para
 * reintentar sin pérdida. Además, TODO el settleAgent corre como UNA tarea de la cola de la
 * treasury (escrows.ts): ningún fund per-call puede aterrizar entre el claim y el release.
 */
import { db, withTransaction } from './db';
import { BASE_UNITS_PER_TOKEN, chainClientFor } from './chain';
import { ensureTreasuryFunded, getMasterWallet } from './wallets';
import { enqueueChainTask, warmServiceEscrow, type ServiceEscrowRow } from './escrows';

/** Monto mínimo (unidades base) para liquidar. Default 1 USDC = 1e7 stroops. */
const MIN_PAYOUT = Number(process.env.SETTLEMENT_MIN_PAYOUT) || BASE_UNITS_PER_TOKEN;

export interface SettleResult {
  service: string;
  status: 'settled' | 'skipped' | 'failed';
  amountLamports: number;
  escrowId?: string;
  reason?: string;
}

/**
 * Acredita la ganancia de un agente (precio COMPLETO de la llamada) en el ledger off-chain.
 * Devuelve el id de la fila para que el fund per-call (escrows.ts) la "upgradee" con el
 * escrow del ciclo si el fondeo on-chain confirma.
 */
export async function recordEarning(args: {
  service: string;
  payTo: string;
  lamports: number;
}): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const info = await db
    .prepare(
      `INSERT INTO agent_earnings (service, pay_to, amount_lamports, created_at)
     VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .run(args.service, args.payTo, args.lamports, now);
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

/** Servicios con acumulado pendiente (para liquidación por lotes). */
async function servicesWithAccrued(): Promise<string[]> {
  const rows = (await db
    .prepare('SELECT DISTINCT service FROM agent_earnings WHERE settlement_id IS NULL')
    .all()) as Array<{ service: string }>;
  return rows.map((r) => r.service);
}

/**
 * Liquida el acumulado de UN agente. Corre como UNA tarea de la cola de la treasury
 * (ningún fund per-call se interpone entre el claim y el pago). Claim en 3 fases:
 *  1. (atómico) reclama las filas pendientes a una `settlement` 'pending' y congela los
 *     escrows del ciclo (`active` → `releasing`: dejan de aceptar funds).
 *  2. (async) on-chain: paga el TOTAL reclamado vía `settlePayout` (deploy+fund+release
 *     clásico, ~95% al agente) — ver nota adentro sobre por qué los escrows del ciclo
 *     no se liberan por balance en la API dev de TW.
 *  3. (atómico) marca 'settled' + escrows del ciclo 'released' (cerrados), o 'failed' +
 *     des-reclama las filas para reintentar (los escrows quedan 'releasing').
 */
export async function settleAgent(service: string): Promise<SettleResult> {
  return enqueueChainTask(() => settleAgentInner(service));
}

async function settleAgentInner(service: string): Promise<SettleResult> {
  // ── Fase 1: claim atómico + congelar escrows del ciclo ──────────────────
  let settlementId = 0;
  let amount = 0;
  let payTo = '';
  let cycleEscrows: ServiceEscrowRow[] = [];
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
    // Congela los escrows activos y retoma los 'releasing' de settlements fallidos previos.
    await tx
      .prepare("UPDATE service_escrows SET status = 'releasing' WHERE service = ? AND status = 'active'")
      .run(service);
    cycleEscrows = (await tx
      .prepare("SELECT * FROM service_escrows WHERE service = ? AND status = 'releasing'")
      .all(service)) as ServiceEscrowRow[];
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

    // El payout al agente va por el settle clásico (deploy+fund+release del TOTAL
    // reclamado). Los escrows del ciclo (funds per-call) NO se liberan: el release de
    // TW paga el monto DECLARADO (no el balance) y la API dev no permite igualarlo
    // (update-escrow rechaza cualquier cambio; el flujo de disputa exige un
    // disputeResolver distinto de quien disputa) — verificado en vivo 2026-07-05.
    // En testnet el balance del ciclo queda retenido en el contrato (USDC de faucet);
    // antes de mainnet: usar updateEscrowAmount (SDK, ya implementado) cuando TW lo
    // habilite, o separar el rol disputeResolver de la treasury y liquidar por disputa.
    const escrowId = await cc.settlePayout({
      receiver: payTo,
      service,
      engagementId: `settle-${settlementId}`,
      amountBaseUnits: BigInt(amount),
    });
    for (const esc of cycleEscrows) {
      if (esc.funded_lamports > 0) {
        console.warn(
          `[settlement] ${service}: escrow de ciclo ${esc.escrow_id} cerrado con ${esc.funded_lamports} retenidos en el contrato (limitación API dev de TW)`,
        );
      }
    }

    // ── Fase 3a: éxito ─────────────────────────────────────────────────────
    const escrowIds = escrowId;
    const now = Math.floor(Date.now() / 1000);
    await withTransaction(async (tx) => {
      await tx
        .prepare(
          "UPDATE settlements SET status = 'settled', escrow_id = ?, signature = ?, settled_at = ? WHERE id = ?",
        )
        .run(escrowIds, escrowIds, now, settlementId);
      await tx
        .prepare('UPDATE agent_earnings SET settled_at = ? WHERE settlement_id = ?')
        .run(now, settlementId);
      // Todos los escrows del ciclo quedan cerrados (los de balance 0 incluidos: ya no
      // reciben funds — estaban 'releasing' — y sus filas quedaron pagadas en este lote).
      for (const esc of cycleEscrows) {
        await tx
          .prepare("UPDATE service_escrows SET status = 'released', released_at = ? WHERE id = ?")
          .run(now, esc.id);
      }
    });
    // Pre-calienta el escrow del ciclo siguiente (fire-and-forget; misma cola, sin await).
    warmServiceEscrow(service, payTo);
    return { service, status: 'settled', amountLamports: amount, escrowId: escrowIds };
  } catch (err) {
    // ── Fase 3b: fallo → des-reclamar para reintentar sin pérdida ──────────
    // Los escrows quedan 'releasing' (no vuelven a 'active'): no aceptan más funds y el
    // próximo settleAgent los retoma con un release idempotente.
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
