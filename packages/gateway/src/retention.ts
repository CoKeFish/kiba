/**
 * Retención de las ganancias de los publicadores, con reclamos.
 *
 * La ganancia de un publicador no se paga al servir: espera un plazo en un escrow de Trustless
 * Work, y durante ese plazo el usuario puede reclamar una llamada.
 *
 *   1. Cada llamada anota la ganancia del publicador (settlement.ts), ligada a quien la pagó.
 *   2. Al cerrar un período (una semana por defecto), lo ganado por un servicio en ese período
 *      pasa a UNA retención: un escrow de Trustless Work a nombre del publicador, con el monto
 *      exacto. Trustless Work no deja cambiar el monto de un escrow ya fondeado y al liberar
 *      paga ese monto, por eso el escrow se crea cuando el período ya cerró.
 *   3. El escrow espera el plazo del publicador, que depende de la confianza que se le tiene.
 *   4. Mientras su ganancia no se ha liberado, el usuario puede reclamar una llamada. Un
 *      administrador de Kiba lo rechaza o devuelve todo o parte; lo devuelto vuelve a donde
 *      salió (créditos o depósito).
 *   5. Vencido el plazo y sin reclamos abiertos, el escrow se libera: el contrato le paga al
 *      publicador y aparta la comisión. Si hubo devoluciones, el escrow se cierra por la vía de
 *      disputa, repartiendo: al publicador lo suyo y a la tesorería lo que Kiba ya devolvió.
 *
 * Papeles del escrow: la tesorería lo crea, lo fondea, lo libera y, si hace falta, abre la
 * disputa; una clave aparte de Kiba (el resolutor) la resuelve, porque el contrato no permite
 * que quien resuelve una disputa sea quien la abre; el publicador es quien cobra.
 *
 * Las llamadas que devuelven una licencia se siguen pagando al momento con el contrato de Kiba:
 * la licencia queda anclada a ese pago (licenses.ts) y no pasa por la retención.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Asset, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { LocalKeypairSigner, TrustlessWorkEscrowClient, resolveChainConfig } from 'kiba-sdk';
import { db, withTransaction } from './db';
import { BASE_UNITS_PER_TOKEN } from './chain';
import { enqueueChainTask } from './escrows';
import { ensureTreasuryFunded, getMasterWallet } from './wallets';
import { refundToChannel } from './channel';

const DAY_S = 86_400;
/** Duración de un período, en días. Lo ganado en un período va a una sola retención. */
export const RETENTION_PERIOD_DAYS = Number(process.env.RETENTION_PERIOD_DAYS) || 1;
/** Monto mínimo de una retención (unidades base). Lo que no llega se suma al período siguiente. */
/** Tramos que junta el escrow de un publicador antes de abrir otro. */
export const RETENTION_MAX_TRANCHES = Number(process.env.RETENTION_MAX_TRANCHES) || 40;
export const RETENTION_MIN_HOLD = Number(process.env.RETENTION_MIN_HOLD) || BASE_UNITS_PER_TOKEN;

export type Trust = 'new' | 'verified' | 'trusted';
/** Días de retención según la confianza en el publicador. */
export const RETENTION_DAYS: Record<Trust, number> = {
  new: Number(process.env.RETENTION_DAYS_NEW) || 14,
  verified: Number(process.env.RETENTION_DAYS_VERIFIED) || 3,
  trusted: Number(process.env.RETENTION_DAYS_TRUSTED) || 1,
};
const isTrust = (v: unknown): v is Trust => v === 'new' || v === 'verified' || v === 'trusted';

// ─── Escrow (inyectable en tests) ───────────────────────────────────────────

export interface HoldBackend {
  /** Deja listo lo que no depende de ninguna retención (la cuenta del resolutor). */
  ready(): Promise<void>;
  /** Guarda una retención en escrow. `engagementId` la identifica para no duplicarla. Devuelve
   *  un identificador opaco de dónde quedó (con Trustless Work: `contrato#tramo`). */
  open(a: { engagementId: string; service: string; receiver: string; amount: number }): Promise<{ escrowId: string }>;
  /** Libera la retención al publicador (el contrato aparta las comisiones). */
  release(escrowId: string): Promise<void>;
  /** Cierra la retención por disputa repartiendo su monto entre el publicador y la tesorería. */
  resolve(escrowId: string, a: { receiver: string; toReceiver: number; toTreasury: number }): Promise<void>;
}

function treasuryKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(getMasterWallet().secretKey.slice(0, 32)));
}

/** Clave de Kiba que solo resuelve disputas: derivada de la tesorería, distinta de ella. */
function resolverKeypair(): Keypair {
  const secret = process.env.RETENTION_RESOLVER_SECRET;
  if (secret) return Keypair.fromSecret(secret);
  const seed = Buffer.from(getMasterWallet().secretKey.slice(0, 32));
  return Keypair.fromRawEd25519Seed(createHash('sha256').update('kiba:hold-resolver:').update(seed).digest());
}

class TrustlessWorkHolds implements HoldBackend {
  private readonly cfg = resolveChainConfig();
  private readonly tw = this.cfg.tw!;
  private readonly treasury = treasuryKeypair();
  private readonly resolver = resolverKeypair();
  private readonly horizon = new Horizon.Server(this.cfg.horizonUrl);
  private isReady = false;

  private client(kp: Keypair, label: string): TrustlessWorkEscrowClient {
    return new TrustlessWorkEscrowClient(new LocalKeypairSigner(kp), {
      apiUrl: this.tw.apiUrl,
      apiKey: this.tw.apiKey,
      platformAddress: this.tw.platformAddress,
      platformFee: this.tw.platformFee,
      trustline: this.tw.trustline,
      feeAddress: this.tw.feeAddress,
      networkPassphrase: this.cfg.networkPassphrase,
      baseUnitsPerToken: BASE_UNITS_PER_TOKEN,
      label,
    });
  }
  private readonly asTreasury = this.client(this.treasury, 'retención');
  private readonly asResolver = this.client(this.resolver, 'retención:resolutor');

  /** Trustless Work exige que TODAS las cuentas de un escrow existan y acepten el activo. */
  async ready(): Promise<void> {
    if (this.isReady) return;
    const address = this.resolver.publicKey();
    const usdc = new Asset(this.tw.trustline.symbol, this.tw.trustline.address);
    let account;
    try {
      account = await this.horizon.loadAccount(address);
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status !== 404) throw err;
      if (this.cfg.friendbotUrl) {
        await fetch(`${this.cfg.friendbotUrl}?addr=${address}`);
      } else {
        // Sin friendbot (mainnet): la crea la tesorería con la reserva de una cuenta y una trustline.
        await enqueueChainTask(async () => {
          await ensureTreasuryFunded();
          const tx = new TransactionBuilder(await this.horizon.loadAccount(this.treasury.publicKey()), {
            fee: '1000',
            networkPassphrase: this.cfg.networkPassphrase,
          })
            .addOperation(Operation.createAccount({ destination: address, startingBalance: '2' }))
            .setTimeout(60)
            .build();
          tx.sign(this.treasury);
          await this.horizon.submitTransaction(tx);
        });
      }
      account = await this.horizon.loadAccount(address);
    }
    const accepts = account.balances.some(
      (b) => 'asset_code' in b && b.asset_code === usdc.code && 'asset_issuer' in b && b.asset_issuer === usdc.issuer,
    );
    if (!accepts) {
      const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase: this.cfg.networkPassphrase })
        .addOperation(Operation.changeTrust({ asset: usdc }))
        .setTimeout(60)
        .build();
      tx.sign(this.resolver);
      await this.horizon.submitTransaction(tx);
    }
    this.isReady = true;
  }

  /**
   * El escrow vigente de un publicador: uno de larga vida al que se le agregan tramos. Cuando
   * junta RETENTION_MAX_TRANCHES se abre otro.
   */
  private async escrowOf(receiver: string): Promise<{ id: number; escrowId: string | null; engagementId: string }> {
    const row = (await db
      .prepare('SELECT id, escrow_id, engagement_id, tranches FROM publisher_escrows WHERE pay_to = ? ORDER BY id DESC LIMIT 1')
      .get(receiver)) as { id: number; escrow_id: string | null; engagement_id: string; tranches: number } | undefined;
    if (row && Number(row.tranches) < RETENTION_MAX_TRANCHES) {
      return { id: Number(row.id), escrowId: row.escrow_id, engagementId: row.engagement_id };
    }
    const engagementId = `kiba-pub-${receiver.slice(0, 12)}-${Date.now().toString(36)}`;
    const info = await db
      .prepare('INSERT INTO publisher_escrows (pay_to, engagement_id, tranches, created_at) VALUES (?, ?, 0, ?) RETURNING id')
      .run(receiver, engagementId, Math.floor(Date.now() / 1000));
    return { id: Number(info.lastInsertRowid), escrowId: null, engagementId };
  }

  /**
   * Mete una retención como un tramo del escrow de su publicador y deposita su monto. Cada paso
   * mira primero lo que ya hay en la red, así que repetirla tras un fallo no duplica nada.
   */
  open(a: { engagementId: string; service: string; receiver: string; amount: number }): Promise<{ escrowId: string }> {
    // Todo lo que firma la tesorería va por su cola: una sola transacción suya en vuelo.
    return enqueueChainTask(async () => {
      await ensureTreasuryFunded();
      const t = this.treasury.publicKey();
      const tranche = { description: a.engagementId, amountBaseUnits: BigInt(a.amount), receiver: a.receiver };
      const pe = await this.escrowOf(a.receiver);
      let escrowId = pe.escrowId;
      if (!escrowId) {
        escrowId = await this.asTreasury.deployTranches({
          engagementId: pe.engagementId,
          title: `Kiba: ganancias retenidas de ${a.receiver.slice(0, 6)}`,
          roles: {
            approver: t,
            serviceProvider: t,
            platformAddress: this.tw.platformAddress,
            releaseSigner: t,
            disputeResolver: this.resolver.publicKey(),
          },
          first: tranche,
        });
        await db.prepare('UPDATE publisher_escrows SET escrow_id = ? WHERE id = ?').run(escrowId, pe.id);
      }
      const index = await this.asTreasury.addTranche(escrowId, tranche);
      // Lo que el escrow debe tener: la suma de los tramos que siguen adentro. Se deposita solo
      // lo que falte.
      const now = await this.asTreasury.readTranches(escrowId);
      const owed = now.tranches.filter((x) => !x.released && !x.resolved).reduce((sum, x) => sum + x.amountBaseUnits, 0n);
      if (owed > now.balanceBaseUnits) await this.asTreasury.fundTranches(escrowId, owed - now.balanceBaseUnits);
      await db.prepare('UPDATE publisher_escrows SET tranches = ? WHERE id = ?').run(now.tranches.length, pe.id);
      return { escrowId: `${escrowId}#${index}` };
    });
  }

  private static part(holdEscrowId: string): { escrowId: string; index: number } {
    const [escrowId, index] = holdEscrowId.split('#');
    if (!escrowId || index === undefined || !/^\d+$/.test(index)) throw new Error(`retención sin tramo: ${holdEscrowId}`);
    return { escrowId, index: Number(index) };
  }

  release(holdEscrowId: string): Promise<void> {
    const { escrowId, index } = TrustlessWorkHolds.part(holdEscrowId);
    return enqueueChainTask(() => this.asTreasury.releaseTranche(escrowId, index));
  }

  async resolve(holdEscrowId: string, a: { receiver: string; toReceiver: number; toTreasury: number }): Promise<void> {
    const { escrowId, index } = TrustlessWorkHolds.part(holdEscrowId);
    await enqueueChainTask(() => this.asTreasury.disputeTranche(escrowId, index));
    await this.asResolver.resolveTranche(escrowId, index, [
      { address: a.receiver, amountBaseUnits: BigInt(a.toReceiver) },
      { address: this.treasury.publicKey(), amountBaseUnits: BigInt(a.toTreasury) },
    ]);
  }
}

let backend: HoldBackend | null = null;
let injected = false;
/** Tests: sustituye el escrow (null = Trustless Work). */
export function setHoldBackend(b: HoldBackend | null): void {
  backend = b;
  injected = b !== null;
}
function getBackend(): HoldBackend {
  return (backend ??= new TrustlessWorkHolds());
}

/**
 * ¿Las ganancias pasan por la retención? Requiere Trustless Work configurado; `RETENTION=0` la
 * apaga y los publicadores cobran como antes (pago por llamada o liquidación por lotes).
 */
export function retentionEnabled(): boolean {
  if (process.env.RETENTION === '0') return false;
  return injected || Boolean(process.env.TRUSTLESS_WORK_API_KEY);
}

// ─── Confianza ──────────────────────────────────────────────────────────────

/** Confianza en el publicador de un servicio. Sin cuenta en Kiba cuenta como nuevo. */
export async function trustOfService(service: string): Promise<Trust> {
  const row = (await db
    .prepare(
      `SELECT u.publisher_trust AS trust FROM user_agents ua JOIN users u ON u.id = ua.user_id
       WHERE ua.service = ? LIMIT 1`,
    )
    .get(service)) as { trust: string | null } | undefined;
  return isTrust(row?.trust) ? row.trust : 'new';
}

export async function setPublisherTrust(userId: number, trust: Trust): Promise<void> {
  if (!isTrust(trust)) throw new Error('nivel de confianza inválido');
  const r = await db.prepare('UPDATE users SET publisher_trust = ? WHERE id = ?').run(trust, userId);
  if (r.changes === 0) throw new Error('usuario no encontrado');
}

/** Igual que `setPublisherTrust`, buscando al publicador por su correo. */
export async function setPublisherTrustByEmail(email: string, trust: Trust): Promise<void> {
  const user = (await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim())) as { id: number } | undefined;
  if (!user) throw new Error('usuario no encontrado');
  await setPublisherTrust(Number(user.id), trust);
}

// ─── Retenciones ────────────────────────────────────────────────────────────

export type HoldStatus = 'funding' | 'held' | 'releasing' | 'released' | 'resolved' | 'void';

interface HoldRow {
  id: number;
  service: string;
  pay_to: string;
  engagement_id: string;
  amount: number;
  refund_due: number;
  trust: string | null;
  retention_days: number | null;
  status: HoldStatus;
  escrow_id: string | null;
  period_end: number;
  release_at: number | null;
  created_at: number;
  funded_at: number | null;
  released_at: number | null;
  settlement_id: number | null;
  error: string | null;
}

const nowS = () => Math.floor(Date.now() / 1000);
const n = (v: unknown) => (v == null ? null : Number(v));
const hold = (r: HoldRow): HoldRow => ({
  ...r,
  id: Number(r.id),
  amount: Number(r.amount),
  refund_due: Number(r.refund_due),
  retention_days: n(r.retention_days),
  period_end: Number(r.period_end),
  release_at: n(r.release_at),
  created_at: Number(r.created_at),
  funded_at: n(r.funded_at),
  released_at: n(r.released_at),
  settlement_id: n(r.settlement_id),
});

/** Inicio del período en curso: lo ganado antes de este momento ya se puede retener. */
export function periodCutoff(now = nowS()): number {
  const period = RETENTION_PERIOD_DAYS * DAY_S;
  return Math.floor(now / period) * period;
}

/**
 * Cierra los períodos vencidos: por cada servicio, lo ganado antes del corte que aún no está en
 * una retención pasa a una nueva. Lo que no llega al mínimo espera al período siguiente.
 * Devuelve cuántas retenciones creó.
 */
export async function closePeriods(now = nowS()): Promise<number> {
  const cutoff = periodCutoff(now);
  const groups = (await db
    .prepare(
      `SELECT service, pay_to, SUM(amount_lamports - refunded)::bigint AS total
       FROM agent_earnings
       WHERE settlement_id IS NULL AND hold_id IS NULL AND escrow_id IS NULL AND created_at < ?
       GROUP BY service, pay_to
       HAVING SUM(amount_lamports - refunded) >= ?`,
    )
    .all(cutoff, RETENTION_MIN_HOLD)) as Array<{ service: string; pay_to: string; total: number }>;
  let created = 0;
  for (const g of groups) {
    await withTransaction(async (tx) => {
      const info = await tx
        .prepare(
          `INSERT INTO earning_holds (service, pay_to, engagement_id, amount, status, period_end, created_at)
           VALUES (?, ?, ?, 0, 'funding', ?, ?) RETURNING id`,
        )
        .run(g.service, g.pay_to, `kiba-hold-${randomBytes(8).toString('hex')}`, cutoff, nowS());
      const id = Number(info.lastInsertRowid);
      await tx
        .prepare(
          `UPDATE agent_earnings SET hold_id = ?
           WHERE service = ? AND pay_to = ? AND settlement_id IS NULL AND hold_id IS NULL AND escrow_id IS NULL AND created_at < ?`,
        )
        .run(id, g.service, g.pay_to, cutoff);
    });
    created++;
  }
  return created;
}

/** Lo que una retención debe guardar hoy: sus ganancias menos lo ya devuelto. */
async function netOf(holdId: number): Promise<number> {
  const r = (await db
    .prepare('SELECT COALESCE(SUM(amount_lamports - refunded), 0)::bigint AS total FROM agent_earnings WHERE hold_id = ?')
    .get(holdId)) as { total: number };
  return Number(r.total);
}

/** Crea y fondea el escrow de cada retención pendiente. Devuelve cuántas quedaron retenidas. */
export async function fundHolds(): Promise<number> {
  const rows = ((await db.prepare(`SELECT * FROM earning_holds WHERE status = 'funding' ORDER BY id`).all()) as HoldRow[]).map(hold);
  let funded = 0;
  for (const h of rows) {
    try {
      const amount = await netOf(h.id);
      if (amount <= 0) {
        // Todo lo del período se devolvió antes de retenerlo: no hay nada que guardar.
        await db.prepare(`UPDATE earning_holds SET status = 'void', amount = 0, released_at = ? WHERE id = ?`).run(nowS(), h.id);
        await db.prepare('UPDATE agent_earnings SET settled_at = ? WHERE hold_id = ?').run(nowS(), h.id);
        continue;
      }
      const { escrowId } = await getBackend().open({
        engagementId: h.engagement_id,
        service: h.service,
        receiver: h.pay_to,
        amount,
      });
      const trust = await trustOfService(h.service);
      const days = RETENTION_DAYS[trust];
      const at = nowS();
      await db
        .prepare(
          `UPDATE earning_holds SET status = 'held', escrow_id = ?, amount = ?, trust = ?, retention_days = ?,
                  funded_at = ?, release_at = ?, error = NULL
           WHERE id = ? AND status = 'funding'`,
        )
        .run(escrowId, amount, trust, days, at, at + days * DAY_S, h.id);
      funded++;
    } catch (err) {
      const msg = String((err as Error).message).split('\n')[0];
      console.error(`[retención] fondear retención ${h.id} (${h.service}):`, msg);
      await db.prepare('UPDATE earning_holds SET error = ? WHERE id = ?').run(msg.slice(0, 300), h.id);
    }
  }
  return funded;
}

/**
 * Libera las retenciones cuyo plazo venció y no tienen reclamos abiertos. Sin devoluciones se
 * libera normal; con devoluciones se cierra por disputa, repartiendo. Devuelve cuántas liberó.
 */
export async function releaseDue(now = nowS()): Promise<number> {
  const rows = (
    (await db
      .prepare(
        `SELECT h.* FROM earning_holds h
         WHERE h.status = 'held' AND h.release_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM claims c JOIN agent_earnings e ON e.id = c.earning_id
             WHERE e.hold_id = h.id AND c.status = 'open')
         ORDER BY h.id`,
      )
      .all(now)) as HoldRow[]
  ).map(hold);
  let released = 0;
  for (const h of rows) {
    // Reclamar la retención: desde aquí no entra otra liberación ni un reclamo nuevo.
    const claimed = await db.prepare(`UPDATE earning_holds SET status = 'releasing' WHERE id = ? AND status = 'held' RETURNING id`).get(h.id);
    if (!claimed) continue;
    const toTreasury = Math.min(h.refund_due, h.amount);
    const toReceiver = h.amount - toTreasury;
    try {
      if (toTreasury > 0) await getBackend().resolve(h.escrow_id!, { receiver: h.pay_to, toReceiver, toTreasury });
      else await getBackend().release(h.escrow_id!);
    } catch (err) {
      const msg = String((err as Error).message).split('\n')[0];
      console.error(`[retención] liberar retención ${h.id} (${h.service}):`, msg);
      await db.prepare(`UPDATE earning_holds SET status = 'held', error = ? WHERE id = ? AND status = 'releasing'`).run(msg.slice(0, 300), h.id);
      continue;
    }
    await withTransaction(async (tx) => {
      const at = nowS();
      const info = await tx
        .prepare(
          `INSERT INTO settlements (service, pay_to, amount_lamports, escrow_id, status, created_at, settled_at)
           VALUES (?, ?, ?, ?, 'settled', ?, ?) RETURNING id`,
        )
        .run(h.service, h.pay_to, toReceiver, h.escrow_id, at, at);
      const settlementId = Number(info.lastInsertRowid);
      await tx.prepare('UPDATE agent_earnings SET settlement_id = ?, settled_at = ? WHERE hold_id = ?').run(settlementId, at, h.id);
      await tx
        .prepare(`UPDATE earning_holds SET status = ?, released_at = ?, settlement_id = ?, error = NULL WHERE id = ?`)
        .run(toTreasury > 0 ? 'resolved' : 'released', at, settlementId, h.id);
    });
    released++;
  }
  return released;
}

let running = false;
/** Trabajo periódico: cierra períodos, fondea las retenciones nuevas y libera las vencidas. */
export async function runRetentionJob(): Promise<void> {
  if (!retentionEnabled() || running) return;
  running = true;
  try {
    await getBackend().ready();
    await closePeriods();
    await fundHolds();
    await releaseDue();
  } finally {
    running = false;
  }
}

export interface HoldView {
  id: number;
  service: string;
  status: HoldStatus;
  amountBaseUnits: number;
  /** Lo devuelto a usuarios por reclamos aceptados, que se descuenta al liberar. */
  refundedBaseUnits: number;
  trust: Trust | null;
  retentionDays: number | null;
  escrowId: string | null;
  periodEnd: number;
  /** Cuándo se libera (unix s); null mientras el escrow no esté fondeado. */
  releaseAt: number | null;
  releasedAt: number | null;
}

/** Retenciones de los servicios de un publicador, las más recientes primero. */
export async function listHoldsOfPublisher(userId: number, limit = 50): Promise<HoldView[]> {
  const rows = (
    (await db
      .prepare(
        `SELECT h.* FROM earning_holds h
         WHERE h.service IN (SELECT service FROM user_agents WHERE user_id = ?)
         ORDER BY h.id DESC LIMIT ?`,
      )
      .all(userId, limit)) as HoldRow[]
  ).map(hold);
  return rows.map((h) => ({
    id: h.id,
    service: h.service,
    status: h.status,
    amountBaseUnits: h.amount,
    refundedBaseUnits: h.refund_due,
    trust: isTrust(h.trust) ? h.trust : null,
    retentionDays: h.retention_days,
    // Con Trustless Work la retención es un tramo (`contrato#tramo`): aquí va solo el contrato.
    escrowId: h.escrow_id ? h.escrow_id.split("#")[0] : null,
    periodEnd: h.period_end,
    releaseAt: h.release_at,
    releasedAt: h.released_at,
  }));
}

// ─── Reclamos ───────────────────────────────────────────────────────────────

export type ClaimStatus = 'open' | 'rejected' | 'refunded';

interface ClaimRow {
  id: number;
  user_id: number;
  earning_id: number;
  tx_id: number;
  service: string;
  amount: number;
  reason: string;
  status: ClaimStatus;
  refund_amount: number;
  note: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: number | null;
}

export interface ClaimView {
  id: number;
  transactionId: number;
  service: string;
  amountBaseUnits: number;
  reason: string;
  status: ClaimStatus;
  refundedBaseUnits: number;
  note: string | null;
  createdAt: number;
  resolvedAt: number | null;
  /** Solo en la cola de administración. */
  userEmail?: string;
}

const claimView = (c: ClaimRow & { email?: string }): ClaimView => ({
  id: Number(c.id),
  transactionId: Number(c.tx_id),
  service: c.service,
  amountBaseUnits: Number(c.amount),
  reason: c.reason,
  status: c.status,
  refundedBaseUnits: Number(c.refund_amount),
  note: c.note,
  createdAt: Number(c.created_at),
  resolvedAt: n(c.resolved_at),
  ...(c.email ? { userEmail: c.email } : {}),
});

interface EarningRow {
  id: number;
  service: string;
  amount_lamports: number;
  refunded: number;
  user_id: number | null;
  tx_id: number | null;
  paid_with: string | null;
  channel_id: number | null;
  hold_id: number | null;
  settled_at: number | null;
}

/** ¿Hasta cuándo se puede reclamar una llamada? null = ya no (su ganancia se liberó) o nunca. */
async function claimableUntil(e: EarningRow): Promise<{ ok: boolean; until: number | null }> {
  if (e.settled_at != null) return { ok: false, until: null };
  if (e.hold_id == null) return { ok: true, until: null };
  const h = (await db.prepare('SELECT status, release_at FROM earning_holds WHERE id = ?').get(e.hold_id)) as
    | { status: HoldStatus; release_at: number | null }
    | undefined;
  if (!h || (h.status !== 'funding' && h.status !== 'held')) return { ok: false, until: null };
  return { ok: true, until: n(h.release_at) };
}

/**
 * El usuario reclama una llamada de su historial. Solo mientras la ganancia de esa llamada no
 * se haya liberado al publicador: después ya no hay de dónde devolver.
 */
export async function createClaim(userId: number, transactionId: number, reason: string): Promise<ClaimView> {
  const text = reason.trim();
  if (text.length < 10) throw new Error('cuenta qué pasó (al menos 10 caracteres)');
  const e = (await db
    .prepare('SELECT * FROM agent_earnings WHERE tx_id = ? AND user_id = ?')
    .get(transactionId, userId)) as EarningRow | undefined;
  if (!e) throw new Error('esa llamada no se puede reclamar');
  if (Number(e.amount_lamports) - Number(e.refunded) <= 0) throw new Error('esa llamada ya se devolvió');
  if (!(await claimableUntil(e)).ok) throw new Error('el plazo para reclamar esta llamada ya pasó');
  if (await db.prepare('SELECT 1 FROM claims WHERE earning_id = ?').get(e.id)) throw new Error('ya reclamaste esta llamada');
  const row = (await db
    .prepare(
      `INSERT INTO claims (user_id, earning_id, tx_id, service, amount, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?) RETURNING *`,
    )
    .get(userId, e.id, transactionId, e.service, Number(e.amount_lamports) - Number(e.refunded), text.slice(0, 2000), nowS())) as ClaimRow;
  return claimView(row);
}

/**
 * Estado de reclamo de las llamadas de un usuario, por id de transacción: si aún se puede
 * reclamar y hasta cuándo, o el reclamo que ya hizo. Solo incluye llamadas con ganancia anotada.
 */
export async function claimInfoForTransactions(
  userId: number,
  transactionIds: number[],
): Promise<Record<number, { claimable: boolean; until: number | null; claim: ClaimView | null }>> {
  const out: Record<number, { claimable: boolean; until: number | null; claim: ClaimView | null }> = {};
  if (transactionIds.length === 0) return out;
  const marks = transactionIds.map(() => '?').join(',');
  const earnings = (await db
    .prepare(`SELECT * FROM agent_earnings WHERE user_id = ? AND tx_id IN (${marks})`)
    .all(userId, ...transactionIds)) as EarningRow[];
  const claims = (await db
    .prepare(`SELECT * FROM claims WHERE user_id = ? AND tx_id IN (${marks})`)
    .all(userId, ...transactionIds)) as ClaimRow[];
  const byTx = new Map(claims.map((c) => [Number(c.tx_id), c]));
  for (const e of earnings) {
    const tx = Number(e.tx_id);
    const claim = byTx.get(tx);
    const w = await claimableUntil(e);
    out[tx] = {
      claimable: !claim && w.ok && Number(e.amount_lamports) - Number(e.refunded) > 0,
      until: w.until,
      claim: claim ? claimView(claim) : null,
    };
  }
  return out;
}

export async function listClaimsOfUser(userId: number, limit = 50): Promise<ClaimView[]> {
  const rows = (await db.prepare('SELECT * FROM claims WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit)) as ClaimRow[];
  return rows.map(claimView);
}

/** Cola de administración: primero los abiertos, del más antiguo al más nuevo. */
export async function listClaimsForAdmin(limit = 100): Promise<ClaimView[]> {
  const rows = (await db
    .prepare(
      `SELECT c.*, u.email FROM claims c JOIN users u ON u.id = c.user_id
       ORDER BY (c.status = 'open') DESC, CASE WHEN c.status = 'open' THEN c.id END ASC, c.id DESC LIMIT ?`,
    )
    .all(limit)) as Array<ClaimRow & { email: string }>;
  return rows.map(claimView);
}

/** Devuelve `amount` al usuario por donde pagó: a su depósito si pagó con él, si no a sus créditos. */
async function refundToOrigin(e: EarningRow, amount: number, claimId: number): Promise<'deposit' | 'credit'> {
  const userId = Number(e.user_id);
  if (e.paid_with === 'deposit' && e.channel_id != null) {
    await refundToChannel(Number(e.channel_id), amount);
    await db
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
         VALUES (?, 'refund', ?, ?, ?, ?)`,
      )
      .run(userId, amount, e.service, JSON.stringify({ reason: 'reclamo aceptado', claimId, to: 'deposit' }), nowS());
    return 'deposit';
  }
  await withTransaction(async (tx) => {
    await tx.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(amount, userId);
    await tx
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
         VALUES (?, 'refund', ?, ?, ?, ?)`,
      )
      .run(userId, amount, e.service, JSON.stringify({ reason: 'reclamo aceptado', claimId, to: 'credit' }), nowS());
  });
  return 'credit';
}

/**
 * Un administrador resuelve un reclamo: lo rechaza, o devuelve todo o parte (`amount` en
 * unidades base; sin `amount` = todo lo reclamado). Lo devuelto sale de la ganancia del
 * publicador: si su escrow ya está fondeado, se recupera de ahí al liberar.
 */
export async function resolveClaim(
  adminId: number,
  claimId: number,
  args: { decision: 'reject' | 'refund'; amount?: number; note?: string },
): Promise<ClaimView> {
  const note = args.note?.trim().slice(0, 2000) || null;
  if (args.decision === 'reject') {
    const row = (await db
      .prepare(`UPDATE claims SET status = 'rejected', note = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open' RETURNING *`)
      .get(note, nowS(), adminId, claimId)) as ClaimRow | undefined;
    if (!row) throw new Error('el reclamo no está abierto');
    return claimView(row);
  }

  const result = await withTransaction(async (tx): Promise<{ claim: ClaimRow; earning: EarningRow; amount: number }> => {
    // Reclamar el reclamo primero: dos resoluciones a la vez no devuelven dos veces.
    const claim = (await tx
      .prepare(`UPDATE claims SET status = 'refunded', note = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open' RETURNING *`)
      .get(note, nowS(), adminId, claimId)) as ClaimRow | undefined;
    if (!claim) throw new Error('el reclamo no está abierto');
    const e = (await tx.prepare('SELECT * FROM agent_earnings WHERE id = ?').get(claim.earning_id)) as EarningRow;
    const left = Number(e.amount_lamports) - Number(e.refunded);
    const amount = args.amount === undefined ? Math.min(Number(claim.amount), left) : args.amount;
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('monto inválido');
    if (amount > left) throw new Error('el monto supera lo que queda de esa llamada');
    if (e.settled_at != null) throw new Error('la ganancia de esa llamada ya se liberó');
    if (e.hold_id != null) {
      const h = (await tx.prepare('SELECT status FROM earning_holds WHERE id = ?').get(e.hold_id)) as { status: HoldStatus } | undefined;
      if (!h || (h.status !== 'funding' && h.status !== 'held')) throw new Error('la ganancia de esa llamada ya se liberó');
      // Con el escrow ya fondeado, lo devuelto se recupera de ahí al liberar.
      if (h.status === 'held') await tx.prepare('UPDATE earning_holds SET refund_due = refund_due + ? WHERE id = ?').run(amount, e.hold_id);
    }
    await tx.prepare('UPDATE agent_earnings SET refunded = refunded + ? WHERE id = ?').run(amount, e.id);
    await tx.prepare('UPDATE claims SET refund_amount = ? WHERE id = ?').run(amount, claimId);
    return { claim: { ...claim, refund_amount: amount }, earning: e, amount };
  });
  await refundToOrigin(result.earning, result.amount, claimId);
  return claimView(result.claim);
}

// ─── Administradores ────────────────────────────────────────────────────────

/** Los administradores son las cuentas cuyo correo está en ADMIN_EMAILS (separados por coma). */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
