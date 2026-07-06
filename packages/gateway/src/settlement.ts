/**
 * Ledger off-chain de ganancias de agentes + liquidación on-chain por lotes.
 *
 * En modo crédito, `call_agent` acredita la ganancia del agente aquí (`recordEarning`)
 * por el precio COMPLETO de la llamada y, con fund per-call activo (escrows.ts), fondea
 * esa ganancia al escrow TW del ciclo del servicio (la fila queda con `escrow_id` y el
 * usuario ve la tx consultable).
 *
 * La liquidación (`settleAgent`) paga el acumulado al agente BARRIENDO los escrows del
 * ciclo (vía SWEEP): `release` paga el monto declarado y deja el escrow "procesado";
 * `withdraw_remaining_funds` (invocación directa al contrato — la API REST de TW no lo
 * expone) reparte el balance restante al agente con el 95/5 aplicado por el contrato.
 * Así el dinero fondeado per-call ES el dinero que cobra el agente (antes el settle
 * pagaba OTRA VEZ desde la treasury y el balance del ciclo quedaba atrapado — ~195% de
 * salida por dólar facturado). Las earnings que nunca se fondearon (cola llena, TW
 * caído) se pagan por el settle clásico (deploy+fund+release) SOLO por el residual.
 *
 * Kill-switch: SETTLE_SWEEP=0 vuelve al settle clásico puro. OJO: no apagarlo tras un
 * sweep parcial fallido — el settle clásico pagaría el total y duplicaría lo ya barrido.
 *
 * Concurrencia: cada fase que toca la DB es atómica vía `withTransaction` (transacción Postgres).
 * El claim marca las filas con `settlement_id` ANTES del pago on-chain: llamadas concurrentes no
 * se liquidan dos veces, y un pago que falla libera las filas (`settlement_id = NULL`) para
 * reintentar sin pérdida. Además, TODO el settleAgent corre como UNA tarea de la cola de la
 * treasury (escrows.ts): ningún fund per-call puede aterrizar entre el claim y el release.
 * El sweep es re-entrante: `release` de TW es idempotente y el withdraw relee el balance
 * on-chain, así que un retry tras fallo parcial no puede pagar dos veces.
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
  // Suma reclamada por escrow del ciclo ('' = earnings nunca fondeadas → vía clásica).
  const coveredByEscrow = new Map<string, number>();
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
    // Desglose por escrow: cuánto del total quedó fondeado en cada escrow del ciclo.
    const cov = (await tx
      .prepare(
        `SELECT COALESCE(escrow_id, '') AS escrow_id, SUM(amount_lamports)::bigint AS amt
         FROM agent_earnings WHERE settlement_id = ? GROUP BY 1`,
      )
      .all(settlementId)) as Array<{ escrow_id: string; amt: number }>;
    for (const c of cov) coveredByEscrow.set(c.escrow_id, Number(c.amt));
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

    const onChainRefs: string[] = [];
    let sweptCovered = 0; // unidades base del claim cubiertas por escrows barridos

    // Vía principal — SWEEP de los escrows del ciclo: release (paga el declarado y
    // deja el escrow "procesado") + withdraw_remaining_funds (reparte el balance
    // restante al agente; el contrato aplica el 95/5). El dinero fondeado per-call ES
    // el payout — nada queda atrapado y la treasury no paga dos veces.
    // Re-entrante: release es idempotente y el withdraw relee el balance on-chain, así
    // que un retry tras fallo parcial nunca duplica. Un escrow ya barrido en un intento
    // fallido anterior queda con balance 0 pero su parte cuenta como cubierta (sus
    // earnings ya se pagaron on-chain en ese intento).
    const sweepEnabled =
      process.env.SETTLE_SWEEP !== '0' && !!cc.escrowChainBalance && !!cc.withdrawEscrowRemaining;
    if (sweepEnabled) {
      for (const esc of cycleEscrows) {
        const balance = await cc.escrowChainBalance!(esc.escrow_id);
        if (balance > 0n) {
          await cc.claimPayment({ escrowId: esc.escrow_id });
          const remaining = await cc.escrowChainBalance!(esc.escrow_id);
          if (remaining > 0n) {
            const h = await cc.withdrawEscrowRemaining!({
              escrowId: esc.escrow_id,
              // pay_to del ESCROW (no del claim): si el owner rotó a mitad de ciclo,
              // cada escrow paga a su dueño de entonces.
              distributions: [{ address: esc.pay_to, amountBaseUnits: remaining }],
            });
            onChainRefs.push(h);
            console.log(
              `[settlement] ${service}: sweep de ${esc.escrow_id} → ${remaining} al agente (${h})`,
            );
          }
        }
        sweptCovered += coveredByEscrow.get(esc.escrow_id) ?? 0;
      }
    }

    // Residual — earnings nunca fondeadas (escrow_id NULL: cola llena/TW caído) van por
    // el settle clásico (deploy+fund+release de un escrow nuevo con el declarado
    // correcto desde el día uno — sin excedente atrapado).
    const legacyAmount = amount - sweptCovered;
    if (legacyAmount > 0) {
      const legacyEscrowId = await cc.settlePayout({
        receiver: payTo,
        service,
        engagementId: `settle-${settlementId}`,
        amountBaseUnits: BigInt(legacyAmount),
      });
      onChainRefs.push(legacyEscrowId);
    }

    // ── Fase 3a: éxito ─────────────────────────────────────────────────────
    const escrowIds = onChainRefs.join(',') || `settle-${settlementId}`;
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
