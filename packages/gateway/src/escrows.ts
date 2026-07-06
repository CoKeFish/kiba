/**
 * Escrow Trustless Work por SERVICIO y por CICLO de liquidación + cola de la treasury.
 *
 * Fund per-call (modo crédito): cada `call_agent` fondea incrementalmente el escrow
 * activo del servicio — una tx Stellar consultable por llamada (stellar.expert). La
 * liquidación por lotes (settlement.ts) LIBERA el escrow (TW aplica el platformFee) y,
 * como el release de TW es terminal, el ciclo siguiente deploya un escrow nuevo (que
 * se pre-calienta en background para sacar el deploy del camino caliente).
 *
 * TODA operación on-chain de la treasury (deploy/fund/release) pasa por una cola
 * serializada in-process: una sola tx de la treasury en vuelo (evita tx_bad_seq) y hace
 * imposible la carrera fund-vs-release — el claim del settlement corre DENTRO de su
 * tarea encolada, así que ningún fund puede aterrizar entre el claim y el release.
 *
 * Contrato de fallo: `fundForCall` NUNCA rechaza. Si algo falla (TW, Horizon, cola
 * llena), la ganancia queda como acumulado legacy (escrow_id NULL) y se liquida por
 * lotes como antes — la llamada nunca falla por la cadena.
 */
import axios from 'axios';
import type { ChainClient } from 'kiba-sdk';
import { db } from './db';
import { attachSignature } from './billing';
import { chainClientFor } from './chain';
import { ensureTreasuryFunded, getMasterWallet } from './wallets';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';
const HORIZON_URL = (process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org').replace(/\/+$/, '');
/** Monto declarado (unidades base) de un escrow pre-calentado sin llamada asociada. */
const WARM_DECLARED_AMOUNT = 1_000n; // 0.0001 USDC — mínimo para no bloquear el release
const MAX_PENDING = Number(process.env.CHAIN_QUEUE_MAX_PENDING) || 8;

export interface ServiceEscrowRow {
  id: number;
  service: string;
  pay_to: string;
  escrow_id: string;
  engagement_id: string;
  status: 'active' | 'releasing' | 'released';
  funded_lamports: number;
  created_at: number;
  released_at: number | null;
}

export interface PerCallFundResult {
  /** Hash canónico (externo) de la tx de fondeo, confirmado en Horizon. */
  txHash?: string;
  /** contractId del escrow del ciclo. */
  escrowId?: string;
}

/** ¿Fund per-call activo? Requiere TW configurado; PER_CALL_FUND=0 lo apaga (kill-switch). */
export function perCallFundEnabled(): boolean {
  return process.env.PER_CALL_FUND !== '0' && Boolean(process.env.TRUSTLESS_WORK_API_KEY);
}

// ─── Cola serializada de la treasury ─────────────────────────────────────────

let queueTail: Promise<unknown> = Promise.resolve();
let queuePending = 0;

/**
 * Encola una operación on-chain de la treasury. Las tareas corren una a la vez, en
 * orden FIFO. OJO: nunca hagas `await` de una tarea encolada DESDE DENTRO de otra
 * tarea (deadlock); encadena con `void enqueueChainTask(...)`.
 */
export function enqueueChainTask<T>(fn: () => Promise<T>): Promise<T> {
  queuePending++;
  const p = queueTail.then(fn).finally(() => {
    queuePending--;
  });
  // Un fallo no rompe la cadena: la siguiente tarea corre igual.
  queueTail = p.catch(() => {});
  return p;
}

export function chainQueuePending(): number {
  return queuePending;
}

// ─── Confirmación en Horizon ─────────────────────────────────────────────────

/**
 * Confirma que la tx de fondeo aterrizó y devuelve su hash CANÓNICO. TW fee-bumpea:
 * Horizon resuelve el hash interno, pero el record devuelto trae `hash` = hash del
 * envelope externo — ese es el que stellar.expert resuelve siempre.
 */
async function confirmTxOnHorizon(innerHash: string): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await axios.get(`${HORIZON_URL}/transactions/${innerHash}`, {
        timeout: 5_000,
        validateStatus: () => true,
      });
      if (r.status === 200 && r.data?.successful !== false) {
        return String(r.data?.hash ?? innerHash);
      }
    } catch {
      /* red — reintenta */
    }
    await new Promise((res) => setTimeout(res, 2_000));
  }
  return null;
}

// ─── Escrow activo por servicio ──────────────────────────────────────────────

function treasuryClient(): ChainClient | null {
  return chainClientFor(getMasterWallet(), 'treasury');
}

async function activeEscrowRow(service: string): Promise<ServiceEscrowRow | undefined> {
  return (await db
    .prepare("SELECT * FROM service_escrows WHERE service = ? AND status = 'active'")
    .get(service)) as ServiceEscrowRow | undefined;
}

/**
 * Devuelve el escrow activo del servicio, deployándolo si no existe. SOLO puede
 * llamarse desde dentro de una tarea de la cola (no serializa por sí misma).
 *
 * `firstAmount`: monto (unidades base) del fondeo inicial que hace el propio deploy.
 * Cuando el deploy lo dispara una llamada, es el precio de ESA llamada (el fund del
 * deploy ES el fund de la llamada → se devuelve su fundTxHash); en warm es un mínimo.
 * El monto declarado del escrow queda en `firstAmount` — el release de TW v1 exige
 * balance ≥ declarado, y el balance siempre será ≥ el primer fondeo.
 */
async function ensureActiveEscrow(
  cc: ChainClient,
  service: string,
  payTo: string,
  firstAmount: bigint,
): Promise<{ row: ServiceEscrowRow; deployFundTxHash?: string }> {
  const existing = await activeEscrowRow(service);
  if (existing && existing.pay_to === payTo) return { row: existing };
  if (existing) {
    // El owner del agente cambió: el escrow viejo queda 'releasing' (sus fondos van al
    // pay_to viejo en el próximo settlement) y se deploya uno nuevo para el nuevo owner.
    console.warn(
      `[escrows] ${service}: pay_to cambió (${existing.pay_to} → ${payTo}); rotando escrow`,
    );
    await db
      .prepare("UPDATE service_escrows SET status = 'releasing' WHERE id = ?")
      .run(existing.id);
  }
  if (!cc.openSettlementEscrow) throw new Error('chain client sin openSettlementEscrow');

  // engagementId determinista por estado: si el deploy aterriza pero el INSERT falla,
  // el reintento recalcula el MISMO engagementId → TW lo recupera (no acuña huérfanos).
  const countRow = (await db
    .prepare('SELECT COUNT(*)::int AS n FROM service_escrows WHERE service = ?')
    .get(service)) as { n: number };
  const engagementId = `kiba-${service}-c${countRow.n + 1}`;

  await ensureTreasuryFunded();
  const opened = await cc.openSettlementEscrow({
    receiver: payTo,
    service,
    engagementId,
    amountBaseUnits: firstAmount,
  });
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO service_escrows (service, pay_to, escrow_id, engagement_id, status, funded_lamports, created_at)
       VALUES (?, ?, ?, ?, 'active', 0, ?)
       ON CONFLICT (engagement_id) DO NOTHING`,
    )
    .run(service, payTo, opened.escrowId, engagementId, now);
  const row = await activeEscrowRow(service);
  if (!row) throw new Error(`escrow activo de ${service} no persistido`);
  console.log(`[escrows] ${service}: escrow ciclo nuevo ${opened.escrowId} (${engagementId})`);
  return { row, deployFundTxHash: opened.fundTxHash };
}

// ─── Fund per-call ───────────────────────────────────────────────────────────

/**
 * Fondea el escrow del servicio con el monto de UNA llamada ya servida y "upgradea" su
 * earning (escrow_id + hash on-chain en la transacción del usuario). Devuelve el hash
 * canónico y el escrowId, o `{}` si no se pudo (la earning queda legacy). NUNCA rechaza.
 */
export function fundForCall(args: {
  service: string;
  payTo: string;
  lamports: number;
  earningId: number;
  /** Opcional: sin transacción de usuario (p.ej. fondeo demo) se omite el attach del hash. */
  transactionId?: number;
}): Promise<PerCallFundResult> {
  if (!perCallFundEnabled()) return Promise.resolve({});
  if (queuePending >= MAX_PENDING) {
    console.warn(`[escrows] cola llena (${queuePending}); ${args.service} queda como acumulado`);
    return Promise.resolve({});
  }
  return enqueueChainTask(async (): Promise<PerCallFundResult> => {
    try {
      // Guard: si un settlement que iba antes en la cola ya reclamó la fila, no fondear
      // (sus fondos saldrán por el payout legacy de ese settlement).
      const earning = (await db
        .prepare('SELECT settlement_id FROM agent_earnings WHERE id = ?')
        .get(args.earningId)) as { settlement_id: number | null } | undefined;
      if (!earning || earning.settlement_id !== null) return {};

      const cc = treasuryClient();
      if (!cc?.fundEscrow || !cc.openSettlementEscrow) return {};

      const amount = BigInt(args.lamports);
      const { row, deployFundTxHash } = await ensureActiveEscrow(
        cc,
        args.service,
        args.payTo,
        amount,
      );
      // Si el deploy lo disparó ESTA llamada, su fondeo inicial ya es el de la llamada.
      const innerHash =
        deployFundTxHash ?? (await cc.fundEscrow({ escrowId: row.escrow_id, amountBaseUnits: amount }));
      if (!innerHash) return {};

      const canonical = await confirmTxOnHorizon(innerHash);
      if (!canonical) {
        console.warn(`[escrows] fund de ${args.service} sin confirmación Horizon (${innerHash})`);
        return {};
      }

      await db
        .prepare('UPDATE agent_earnings SET escrow_id = ? WHERE id = ? AND settlement_id IS NULL')
        .run(row.escrow_id, args.earningId);
      await db
        .prepare('UPDATE service_escrows SET funded_lamports = funded_lamports + ? WHERE id = ?')
        .run(args.lamports, row.id);
      if (args.transactionId != null) await attachSignature(args.transactionId, canonical);
      return { txHash: canonical, escrowId: row.escrow_id };
    } catch (err) {
      console.warn(`[escrows] fund per-call de ${args.service} falló: ${(err as Error).message}`);
      return {};
    }
  });
}

// ─── Warm (pre-deploy del escrow del ciclo) ──────────────────────────────────

/**
 * Encola el pre-deploy del escrow de un servicio (para que la primera llamada del ciclo
 * pague solo el fund, no el deploy). Fire-and-forget; seguro llamarlo desde dentro de
 * una tarea de la cola (no espera el resultado).
 */
export function warmServiceEscrow(service: string, payTo: string): void {
  if (!perCallFundEnabled()) return;
  void enqueueChainTask(async () => {
    try {
      const cc = treasuryClient();
      if (!cc?.openSettlementEscrow) return;
      await ensureActiveEscrow(cc, service, payTo, WARM_DECLARED_AMOUNT);
    } catch (err) {
      console.warn(`[escrows] warm de ${service} falló: ${(err as Error).message}`);
    }
  });
}

/**
 * Pre-calienta los escrows de WARM_ESCROW_SERVICES (csv) al boot, resolviendo el owner
 * de cada servicio en el backend (sin quote). Best-effort: un fallo solo se loguea.
 */
export function warmEscrows(): void {
  if (!perCallFundEnabled()) return;
  const services = (process.env.WARM_ESCROW_SERVICES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const service of services) {
    void (async () => {
      try {
        const r = await axios.get(`${BACKEND_URL}/agents/${encodeURIComponent(service)}`, {
          timeout: 15_000,
        });
        const owner = (r.data as { ownerWallet?: string })?.ownerWallet;
        if (!owner) {
          console.warn(`[escrows] warm: ${service} sin ownerWallet en el backend`);
          return;
        }
        warmServiceEscrow(service, owner);
      } catch (err) {
        console.warn(`[escrows] warm de ${service} falló: ${(err as Error).message}`);
      }
    })();
  }
}
