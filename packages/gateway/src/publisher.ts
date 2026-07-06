/**
 * Capa de datos del publisher: lee la VERDAD del dinero desde el ledger Postgres
 * (agent_earnings + settlements), no de los contadores del contrato registro Soroban
 * (que nunca se incrementan → siempre 0).
 *
 * Todo lo que ve el publisher es NETO: el ledger guarda el GROSS (precio completo de la
 * llamada); el contrato TW aplica el 95/5 on-chain al liquidar. Aquí calculamos el neto
 * con `netBaseUnits` para que la UI muestre lo que el agente realmente cobra.
 *
 * Es un módulo SOLO-DB (no toca la cadena): funciona en modo degradado (tests/CI sin
 * STELLAR_CONTRACT_ID) y es testeable con INSERTs directos.
 */
import { PLATFORM_FEE_BPS, BPS_DENOMINATOR } from 'kiba-sdk';
import { db } from './db';
import { BASE_UNITS_PER_TOKEN } from './chain';
import { lamportsToUsd } from './billing';

/** GROSS → neto del publisher (95% con fee 500 bps), en unidades base (floor, como el contrato). */
export function netBaseUnits(gross: number): number {
  return gross - Math.floor((gross * PLATFORM_FEE_BPS) / BPS_DENOMINATOR);
}

export interface ServiceLedgerStats {
  /** # de llamadas exitosas en modo crédito (1 fila de agent_earnings por llamada). */
  calls: number;
  /** GROSS lifetime en unidades base (todas las earnings del servicio). */
  grossLifetime: number;
  /** GROSS ya confirmado on-chain (settled_at IS NOT NULL). */
  grossSettled: number;
  /** GROSS aún no confirmado on-chain (settled_at IS NULL, incluye lotes en vuelo). */
  grossPending: number;
}

/**
 * Stats de ledger por servicio en UNA query (no N+1). "Pending" = todo lo no confirmado
 * on-chain (incluye earnings ya reclamadas por un settlement en vuelo) ⇒ settled + pending
 * = lifetime siempre.
 */
export async function getServiceLedgerStats(
  services: string[],
): Promise<Map<string, ServiceLedgerStats>> {
  const out = new Map<string, ServiceLedgerStats>();
  if (services.length === 0) return out;
  // SUM(bigint) en pg es `numeric` (llega como string): ::bigint para que el parser int8
  // (db.ts) lo devuelva como Number. `service = ANY(?)`: pg serializa el array JS como array
  // Postgres cuando es el parámetro único.
  const rows = (await db
    .prepare(
      `SELECT service,
              COUNT(*)::int AS calls,
              COALESCE(SUM(amount_lamports), 0)::bigint AS gross_lifetime,
              COALESCE(SUM(amount_lamports) FILTER (WHERE settled_at IS NOT NULL), 0)::bigint AS gross_settled,
              COALESCE(SUM(amount_lamports) FILTER (WHERE settled_at IS NULL), 0)::bigint AS gross_pending
       FROM agent_earnings
       WHERE service = ANY(?)
       GROUP BY service`,
    )
    .all(services)) as Array<{
    service: string;
    calls: number;
    gross_lifetime: number;
    gross_settled: number;
    gross_pending: number;
  }>;
  for (const r of rows) {
    out.set(r.service, {
      calls: r.calls,
      grossLifetime: r.gross_lifetime,
      grossSettled: r.gross_settled,
      grossPending: r.gross_pending,
    });
  }
  return out;
}

export type SettlementRefKind = 'tx' | 'contract' | 'opaque';
export interface SettlementRef {
  ref: string;
  kind: SettlementRefKind;
}

/**
 * CSV de refs on-chain → refs tipadas. El settle guarda en `signature`/`escrow_id` un CSV que
 * mezcla: tx hashes (64 hex, vía sweep) y contract ids (C + 55 base32, vía settle clásico), o
 * un fallback opaco (`settle-{id}`). El dashboard usa el kind para armar el link correcto.
 */
export function parseSettlementRefs(raw: string | null): SettlementRef[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((ref) => {
      if (/^[0-9a-f]{64}$/i.test(ref)) return { ref, kind: 'tx' as const };
      if (/^C[A-Z2-7]{55}$/.test(ref)) return { ref, kind: 'contract' as const };
      return { ref, kind: 'opaque' as const };
    });
}

export interface PublisherSettlementJson {
  id: number;
  service: string;
  pay_to: string;
  amount_base_units: number; // GROSS reclamado en el lote
  amount_asset: number;
  net_base_units: number; // neto ≈ lo que recibió/recibirá el agente
  net_asset: number;
  net_usd: number;
  status: 'pending' | 'settled' | 'failed';
  created_at: number;
  settled_at: number | null;
  refs: SettlementRef[];
}

/** Settlements de los servicios del user (JOIN user_agents), más recientes primero. */
export async function listUserSettlements(
  userId: number,
  limit = 50,
): Promise<PublisherSettlementJson[]> {
  const rows = (await db
    .prepare(
      `SELECT s.id, s.service, s.pay_to, s.amount_lamports, s.escrow_id, s.signature,
              s.status, s.created_at, s.settled_at
       FROM settlements s
       JOIN user_agents ua ON ua.service = s.service
       WHERE ua.user_id = ?
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ?`,
    )
    .all(userId, limit)) as Array<{
    id: number;
    service: string;
    pay_to: string;
    amount_lamports: number;
    escrow_id: string | null;
    signature: string | null;
    status: 'pending' | 'settled' | 'failed';
    created_at: number;
    settled_at: number | null;
  }>;
  return rows.map((r) => {
    const gross = r.amount_lamports;
    const net = netBaseUnits(gross);
    return {
      id: r.id,
      service: r.service,
      pay_to: r.pay_to,
      amount_base_units: gross,
      amount_asset: gross / BASE_UNITS_PER_TOKEN,
      net_base_units: net,
      net_asset: net / BASE_UNITS_PER_TOKEN,
      net_usd: lamportsToUsd(net),
      status: r.status,
      created_at: r.created_at,
      settled_at: r.settled_at,
      refs: parseSettlementRefs(r.signature ?? r.escrow_id),
    };
  });
}

export interface DailyPoint {
  day: string; // 'YYYY-MM-DD' UTC
  calls: number;
  earnedBaseUnits: number; // NETO del día
}

/**
 * Serie por día UTC de los últimos `days` días (zero-fill) de los servicios del user, desde
 * agent_earnings. Devuelve SIEMPRE `days` puntos ascendentes.
 */
export async function getDailySeries(userId: number, days = 30): Promise<DailyPoint[]> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = (await db
    .prepare(
      `SELECT to_char(to_timestamp(e.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS calls,
              COALESCE(SUM(e.amount_lamports), 0)::bigint AS gross
       FROM agent_earnings e
       JOIN user_agents ua ON ua.service = e.service
       WHERE ua.user_id = ? AND e.created_at >= ?
       GROUP BY 1
       ORDER BY 1`,
    )
    .all(userId, cutoff)) as Array<{ day: string; calls: number; gross: number }>;
  const byDay = new Map(rows.map((r) => [r.day, r]));

  // Zero-fill: genera las claves de los últimos `days` días UTC (más antiguo → hoy).
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const hit = byDay.get(day);
    out.push({
      day,
      calls: hit?.calls ?? 0,
      earnedBaseUnits: hit ? netBaseUnits(hit.gross) : 0,
    });
  }
  return out;
}
