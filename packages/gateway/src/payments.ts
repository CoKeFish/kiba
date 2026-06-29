/**
 * Pagos fiat → créditos (Kibs) mediante una abstracción de "payment provider".
 *
 * Igual que `ChainClient` abstrae la cadena, `PaymentProvider` abstrae la pasarela.
 * Hay dos implementaciones:
 *   - `bre-b-sandbox`  → demo sin cuenta de comercio: QR/llave Bre-B + confirmación manual.
 *   - `wompi`          → PSP real (Bancolombia). Web Checkout + verificación por API +
 *                        webhook firmado. Soporta Bre-B, PSE, Nequi, tarjeta, etc.
 *
 * Selección por env `PAYMENT_PROVIDER` (default `bre-b-sandbox`). Si se pide `wompi`
 * pero faltan llaves, cae a sandbox con un warning (no rompe el arranque).
 *
 * FX: COP → USD → créditos. Tasa fija configurable (COP_USD_RATE).
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { usdToLamports, lamportsToUsd, getBalance } from './billing';
import { ASSET_USD_RATE } from './chain';

/** Pesos colombianos por 1 USD (solo para convertir recargas locales). */
export const COP_USD_RATE = Number(process.env.COP_USD_RATE) || 4000;
/** Créditos (Kibs) por USD — debe coincidir con el front (display). */
const KIBS_PER_USD = 10_000;
/** Llave Bre-B del comercio (sandbox). */
const BREB_MERCHANT_LLAVE = process.env.BREB_MERCHANT_LLAVE || '@kiba';
/** Provider activo. */
const PROVIDER = (process.env.PAYMENT_PROVIDER || 'bre-b-sandbox').toLowerCase();

// ── Wompi ──
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || '';
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET || '';
const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET || '';
const WOMPI_API_URL = (process.env.WOMPI_API_URL || 'https://sandbox.wompi.co/v1').replace(/\/+$/, '');
const WOMPI_CHECKOUT_URL = (process.env.WOMPI_CHECKOUT_URL || 'https://checkout.wompi.co/p/').replace(
  /\/+$/,
  '/',
);
const DEFAULT_REDIRECT = `${(process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3020').replace(
  /\/+$/,
  '',
)}/app/billing`;

export const copToUsd = (cop: number) => cop / COP_USD_RATE;
export const copToKibs = (cop: number) => Math.round(copToUsd(cop) * KIBS_PER_USD);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function wompiConfigured(): boolean {
  return Boolean(WOMPI_PUBLIC_KEY && WOMPI_INTEGRITY_SECRET);
}

export interface Charge {
  id: string;
  userId: number;
  provider: string;
  method: string;
  reference: string;
  amountCop: number;
  amountUsd: number;
  kibs: number;
  status: 'pending' | 'paid' | 'expired';
  detail: Record<string, unknown>;
  createdAt: number;
  paidAt: number | null;
}

export interface CreateChargeInput {
  userId: number;
  amountCop: number;
  /** URL de retorno tras el checkout (redirect providers). */
  redirectUrl?: string;
}

export interface VerifyResult {
  charge: Charge;
  newBalanceUsd: number;
  status: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly sandbox: boolean;
  /** 'qr' = se paga dentro de la app; 'redirect' = se va al checkout del PSP. */
  readonly mode: 'qr' | 'redirect';
  createCharge(input: CreateChargeInput): Charge;
  getCharge(id: string, userId: number): Charge | null;
  /** Sandbox: simula el webhook del PSP. */
  confirmCharge?(id: string, userId: number): { charge: Charge; newBalanceUsd: number };
  /** Redirect providers: verifica una transacción devuelta (?id=) y acredita si está aprobada. */
  verifyCharge?(args: {
    chargeId: string;
    userId: number;
    providerTxId: string;
  }): Promise<VerifyResult>;
  /** Webhook firmado del PSP. */
  handleWebhook?(body: unknown, headerChecksum?: string): Promise<{ ok: boolean; credited: boolean }>;
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

function loadChargeByReference(reference: string): ChargeRow | null {
  return (
    (db.prepare('SELECT * FROM payment_charges WHERE reference = ?').get(reference) as
      | ChargeRow
      | undefined) ?? null
  );
}

/**
 * Acredita un cobro pendiente: pending→paid + suma al saldo + registra la transacción.
 * Idempotente y atómico: si ya está `paid`, no hace nada. Devuelve el resultado.
 */
function applyCredit(id: string): 'credited' | 'already' | 'notfound' {
  let outcome: 'credited' | 'already' | 'notfound' = 'notfound';
  const tx = db.transaction(() => {
    const r = db.prepare('SELECT * FROM payment_charges WHERE id = ?').get(id) as ChargeRow | undefined;
    if (!r) return;
    if (r.status === 'paid') {
      outcome = 'already';
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const lamports = usdToLamports(r.amount_usd);
    db.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(
      lamports,
      r.user_id,
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
       VALUES (?, 'topup', ?, ?, ?, ?, ?)`,
    ).run(
      r.user_id,
      lamports,
      r.method,
      r.reference,
      JSON.stringify({
        provider: r.provider,
        method: r.method,
        amount_cop: r.amount_cop,
        usd: r.amount_usd,
        cop_usd_rate: COP_USD_RATE,
        rate: ASSET_USD_RATE,
      }),
      now,
    );
    db.prepare('UPDATE payment_charges SET status = ?, paid_at = ? WHERE id = ?').run('paid', now, id);
    outcome = 'credited';
  });
  tx();
  return outcome;
}

function insertCharge(args: {
  userId: number;
  provider: string;
  method: string;
  reference: string;
  amountCop: number;
  amountUsd: number;
  detail: Record<string, unknown>;
}): Charge {
  const id = `chg_${randomBytes(12).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO payment_charges
       (id, user_id, provider, method, reference, amount_cop, amount_usd, status, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    id,
    args.userId,
    args.provider,
    args.method,
    args.reference,
    args.amountCop,
    args.amountUsd,
    JSON.stringify(args.detail),
    now,
  );
  return loadCharge(id, args.userId)!;
}

// ─── Bre-B sandbox provider ────────────────────────────────────

class BrebSandboxProvider implements PaymentProvider {
  readonly id = 'bre-b-sandbox';
  readonly sandbox = true;
  readonly mode = 'qr' as const;

  createCharge({ userId, amountCop }: CreateChargeInput): Charge {
    const reference = `KIBA-${randomBytes(4).toString('hex').toUpperCase()}`;
    const qrPayload =
      `BREB://pay?llave=${encodeURIComponent(BREB_MERCHANT_LLAVE)}` +
      `&ref=${reference}&amount=${amountCop}&cur=COP&mid=kiba`;
    return insertCharge({
      userId,
      provider: this.id,
      method: 'bre-b',
      reference,
      amountCop,
      amountUsd: copToUsd(amountCop),
      detail: {
        llave: BREB_MERCHANT_LLAVE,
        qrPayload,
        instructions: 'Abre tu app bancaria, escanea el QR o paga a la llave Bre-B.',
      },
    });
  }

  getCharge(id: string, userId: number): Charge | null {
    return loadCharge(id, userId);
  }

  confirmCharge(id: string, userId: number): { charge: Charge; newBalanceUsd: number } {
    const existing = loadCharge(id, userId);
    if (!existing) throw new Error('charge not found');
    if (existing.status === 'pending') applyCredit(id);
    else if (existing.status !== 'paid') throw new Error(`charge is ${existing.status}`);
    return { charge: loadCharge(id, userId)!, newBalanceUsd: lamportsToUsd(getBalance(userId)) };
  }
}

// ─── Wompi provider (PSP real) ─────────────────────────────────

interface WompiTransaction {
  id: string;
  status: 'APPROVED' | 'DECLINED' | 'VOIDED' | 'PENDING' | 'ERROR';
  reference: string;
  amount_in_cents: number;
  payment_method_type?: string;
}

class WompiProvider implements PaymentProvider {
  readonly id = 'wompi';
  readonly sandbox = WOMPI_API_URL.includes('sandbox');
  readonly mode = 'redirect' as const;

  createCharge({ userId, amountCop, redirectUrl }: CreateChargeInput): Charge {
    // Wompi opera en centavos. COP no tiene decimales en la práctica → *100.
    const amountInCents = Math.round(amountCop * 100);
    const reference = `KIBA-${randomBytes(8).toString('hex').toUpperCase()}`;
    const currency = 'COP';
    const signature = sha256(`${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_SECRET}`);
    const redirect = redirectUrl || DEFAULT_REDIRECT;
    const params = new URLSearchParams({
      'public-key': WOMPI_PUBLIC_KEY,
      currency,
      'amount-in-cents': String(amountInCents),
      reference,
      'redirect-url': redirect,
      'signature:integrity': signature,
    });
    const checkoutUrl = `${WOMPI_CHECKOUT_URL}?${params.toString()}`;
    return insertCharge({
      userId,
      provider: this.id,
      method: 'wompi',
      reference,
      amountCop,
      amountUsd: copToUsd(amountCop),
      detail: { checkoutUrl, amountInCents, currency },
    });
  }

  getCharge(id: string, userId: number): Charge | null {
    return loadCharge(id, userId);
  }

  private async fetchTransaction(txId: string): Promise<WompiTransaction> {
    const res = await fetch(`${WOMPI_API_URL}/transactions/${encodeURIComponent(txId)}`, {
      headers: { Accept: 'application/json' },
    });
    const json = (await res.json().catch(() => ({}))) as { data?: WompiTransaction };
    if (!res.ok || !json.data) throw new Error(`Wompi transaction lookup failed (${res.status})`);
    return json.data;
  }

  async verifyCharge({
    chargeId,
    userId,
    providerTxId,
  }: {
    chargeId: string;
    userId: number;
    providerTxId: string;
  }): Promise<VerifyResult> {
    const charge = loadCharge(chargeId, userId);
    if (!charge) throw new Error('charge not found');
    if (charge.status === 'paid') {
      return { charge, newBalanceUsd: lamportsToUsd(getBalance(userId)), status: 'APPROVED' };
    }

    const tx = await this.fetchTransaction(providerTxId);
    // El reference de Wompi debe coincidir con el del cobro (anti-suplantación).
    if (tx.reference !== charge.reference) throw new Error('reference mismatch');
    if (tx.amount_in_cents !== Math.round(charge.amountCop * 100)) throw new Error('amount mismatch');

    if (tx.status === 'APPROVED') {
      applyCredit(chargeId);
    } else if (tx.status === 'DECLINED' || tx.status === 'VOIDED' || tx.status === 'ERROR') {
      db.prepare(
        "UPDATE payment_charges SET status = 'expired' WHERE id = ? AND status = 'pending'",
      ).run(chargeId);
    }
    return {
      charge: loadCharge(chargeId, userId)!,
      newBalanceUsd: lamportsToUsd(getBalance(userId)),
      status: tx.status,
    };
  }

  async handleWebhook(
    body: unknown,
    headerChecksum?: string,
  ): Promise<{ ok: boolean; credited: boolean }> {
    const event = body as {
      event?: string;
      data?: { transaction?: WompiTransaction };
      signature?: { properties?: string[]; checksum?: string };
      timestamp?: number;
    };
    const sig = event.signature;
    if (!sig?.properties || !sig.checksum) return { ok: false, credited: false };

    // checksum = SHA256( valores de properties (en orden) + timestamp + events_secret )
    const values = sig.properties
      .map((path) =>
        path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], event.data),
      )
      .map((v) => String(v ?? ''))
      .join('');
    const computed = sha256(`${values}${event.timestamp ?? ''}${WOMPI_EVENTS_SECRET}`).toLowerCase();
    const received = (headerChecksum || sig.checksum).toLowerCase();
    if (computed !== received) return { ok: false, credited: false };

    const t = event.data?.transaction;
    if (event.event !== 'transaction.updated' || !t) return { ok: true, credited: false };
    if (t.status !== 'APPROVED') return { ok: true, credited: false };

    const row = loadChargeByReference(t.reference);
    if (!row) return { ok: true, credited: false };
    if (Math.round(row.amount_cop * 100) !== t.amount_in_cents) return { ok: true, credited: false };
    const outcome = applyCredit(row.id);
    return { ok: true, credited: outcome === 'credited' };
  }
}

// ─── Factory ───────────────────────────────────────────────────

let provider: PaymentProvider;
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    if (PROVIDER === 'wompi') {
      if (wompiConfigured()) {
        provider = new WompiProvider();
        console.log(`[payments] provider=wompi (${provider.sandbox ? 'sandbox' : 'production'})`);
      } else {
        provider = new BrebSandboxProvider();
        console.warn(
          '[payments] PAYMENT_PROVIDER=wompi pero faltan WOMPI_PUBLIC_KEY/WOMPI_INTEGRITY_SECRET — cae a bre-b-sandbox',
        );
      }
    } else {
      provider = new BrebSandboxProvider();
    }
  }
  return provider;
}
