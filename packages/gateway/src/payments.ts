/**
 * Pagos fiat → créditos (Kibs) mediante una abstracción de "payment provider".
 *
 * Igual que `ChainClient` abstrae la cadena, `PaymentProvider` abstrae la pasarela
 * de pago. El primer provider es **Bre-B en sandbox**: reproduce fielmente el flujo
 * de un PSP colombiano (Wompi/EBANX) — crear un cobro, mostrar QR + llave Bre-B,
 * y confirmar vía webhook — pero sin cuenta de comercio real. Enchufar el PSP real
 * después = implementar esta misma interfaz.
 *
 * Flujo:
 *   1. createCharge(amountCop) → cobro `pending` + QR/llave/referencia.
 *   2. el usuario paga por su app bancaria (en sandbox: confirmCharge lo simula,
 *      representando el webhook del PSP).
 *   3. confirmCharge → acredita créditos (idempotente: solo pending→paid) y
 *      registra la transacción.
 *
 * FX: COP → USD → créditos. Tasa fija configurable (COP_USD_RATE), suficiente
 * para demo; en real se tomaría la tasa del PSP o un feed.
 */
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { usdToLamports, lamportsToUsd, getBalance } from './billing';
import { ASSET_USD_RATE, BASE_UNITS_PER_TOKEN } from './chain';

/** Pesos colombianos por 1 USD (solo para convertir recargas locales). */
export const COP_USD_RATE = Number(process.env.COP_USD_RATE) || 4000;
/** Créditos (Kibs) por USD — debe coincidir con el front (display). */
const KIBS_PER_USD = 10_000;
/** Llave Bre-B del comercio (a dónde "paga" el usuario). */
const BREB_MERCHANT_LLAVE = process.env.BREB_MERCHANT_LLAVE || '@kiba';
/** Provider activo. */
const PROVIDER = (process.env.PAYMENT_PROVIDER || 'bre-b-sandbox').toLowerCase();

export const copToUsd = (cop: number) => cop / COP_USD_RATE;

export interface Charge {
  id: string;
  userId: number;
  provider: string;
  method: string;
  reference: string;
  amountCop: number;
  amountUsd: number;
  /** Créditos (Kibs) que se acreditarán. Derivado, no se persiste. */
  kibs: number;
  status: 'pending' | 'paid' | 'expired';
  /** Datos específicos del método (QR, llave Bre-B, etc.). */
  detail: Record<string, unknown>;
  createdAt: number;
  paidAt: number | null;
}

export interface CreateChargeInput {
  userId: number;
  amountCop: number;
}

export interface PaymentProvider {
  readonly id: string;
  /** ¿el provider permite confirmar el cobro localmente (sandbox)? */
  readonly sandbox: boolean;
  createCharge(input: CreateChargeInput): Charge;
  getCharge(id: string, userId: number): Charge | null;
  /** Confirma el cobro (sandbox = simula el webhook del PSP). Idempotente. */
  confirmCharge(id: string, userId: number): { charge: Charge; newBalanceUsd: number };
}

// ─── Persistencia ──────────────────────────────────────────────

interface ChargeRow {
  id: string;
  user_id: number;
  provider: string;
  method: string;
  reference: string;
  amount_cop: number;
  amount_usd: number;
  status: 'pending' | 'paid' | 'expired';
  metadata: string | null;
  created_at: number;
  paid_at: number | null;
}

function rowToCharge(r: ChargeRow): Charge {
  return {
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    method: r.method,
    reference: r.reference,
    amountCop: r.amount_cop,
    amountUsd: r.amount_usd,
    kibs: Math.round(r.amount_usd * KIBS_PER_USD),
    status: r.status,
    detail: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {},
    createdAt: r.created_at,
    paidAt: r.paid_at,
  };
}

function loadCharge(id: string, userId: number): Charge | null {
  const r = db
    .prepare('SELECT * FROM payment_charges WHERE id = ? AND user_id = ?')
    .get(id, userId) as ChargeRow | undefined;
  return r ? rowToCharge(r) : null;
}

// ─── Bre-B sandbox provider ────────────────────────────────────

class BrebSandboxProvider implements PaymentProvider {
  readonly id = 'bre-b-sandbox';
  readonly sandbox = true;

  createCharge({ userId, amountCop }: CreateChargeInput): Charge {
    const amountUsd = copToUsd(amountCop);
    const id = `chg_${randomBytes(12).toString('hex')}`;
    const reference = `KIBA-${randomBytes(4).toString('hex').toUpperCase()}`;
    const now = Math.floor(Date.now() / 1000);
    // Payload del QR — emula un deep-link Bre-B (en real sería EMVCo/QR del PSP).
    const qrPayload =
      `BREB://pay?llave=${encodeURIComponent(BREB_MERCHANT_LLAVE)}` +
      `&ref=${reference}&amount=${amountCop}&cur=COP&mid=kiba`;
    const detail = {
      llave: BREB_MERCHANT_LLAVE,
      qrPayload,
      instructions: 'Abre tu app bancaria, escanea el QR o paga a la llave Bre-B.',
    };
    db.prepare(
      `INSERT INTO payment_charges
         (id, user_id, provider, method, reference, amount_cop, amount_usd, status, metadata, created_at)
       VALUES (?, ?, ?, 'bre-b', ?, ?, ?, 'pending', ?, ?)`,
    ).run(id, userId, this.id, reference, amountCop, amountUsd, JSON.stringify(detail), now);
    return loadCharge(id, userId)!;
  }

  getCharge(id: string, userId: number): Charge | null {
    return loadCharge(id, userId);
  }

  confirmCharge(id: string, userId: number): { charge: Charge; newBalanceUsd: number } {
    const now = Math.floor(Date.now() / 1000);
    const tx = db.transaction(() => {
      const r = db
        .prepare('SELECT * FROM payment_charges WHERE id = ? AND user_id = ?')
        .get(id, userId) as ChargeRow | undefined;
      if (!r) throw new Error('charge not found');
      if (r.status === 'paid') return; // idempotente: ya acreditado
      if (r.status !== 'pending') throw new Error(`charge is ${r.status}`);

      const lamports = usdToLamports(r.amount_usd);
      db.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(
        lamports,
        userId,
      );
      db.prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
         VALUES (?, 'topup', ?, 'bre-b', ?, ?, ?)`,
      ).run(
        userId,
        lamports,
        r.reference,
        JSON.stringify({
          provider: r.provider,
          method: 'bre-b',
          amount_cop: r.amount_cop,
          usd: r.amount_usd,
          cop_usd_rate: COP_USD_RATE,
          rate: ASSET_USD_RATE,
        }),
        now,
      );
      db.prepare('UPDATE payment_charges SET status = ?, paid_at = ? WHERE id = ?').run(
        'paid',
        now,
        id,
      );
    });
    tx();

    const charge = loadCharge(id, userId);
    if (!charge) throw new Error('charge not found');
    return { charge, newBalanceUsd: lamportsToUsd(getBalance(userId)) };
  }
}

let provider: PaymentProvider;
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    switch (PROVIDER) {
      case 'bre-b-sandbox':
      default:
        provider = new BrebSandboxProvider();
        break;
      // case 'wompi': provider = new WompiProvider(...); break;   // futuro
      // case 'ebanx': provider = new EbanxProvider(...); break;   // futuro
    }
  }
  return provider;
}

/** Conversión de display para el front: cuántos créditos da un monto en COP. */
export const copToKibs = (cop: number) => Math.round(copToUsd(cop) * KIBS_PER_USD);
