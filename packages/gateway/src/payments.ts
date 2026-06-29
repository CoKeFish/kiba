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
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

// ── Stripe ── (tarjeta internacional; llaves de test instantáneas, sin KYC)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API_URL = 'https://api.stripe.com/v1';

function stripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY);
}

// ── PayPal ── (tarjeta/cuenta PayPal; credenciales sandbox instantáneas, sin KYC)
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || '';
const PAYPAL_API_URL = (process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com').replace(
  /\/+$/,
  '',
);

function paypalConfigured(): boolean {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_SECRET);
}

// ── USDC en Stellar (depósito cripto, estilo AstroPay) ──
// El usuario envía USDC a una dirección de la plataforma con un memo único; un
// poll a Horizon detecta el pago entrante con ese memo y acredita los Kibs.
const STELLAR_HORIZON_URL = (process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org').replace(
  /\/+$/,
  '',
);
const STELLAR_DEPOSIT_ADDRESS =
  process.env.STELLAR_DEPOSIT_ADDRESS || process.env.TRUSTLESS_WORK_PLATFORM_ADDRESS || '';
const USDC_ISSUER = process.env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS || '';
const USDC_CODE = process.env.TRUSTLESS_WORK_TRUSTLINE_SYMBOL || 'USDC';

function stellarConfigured(): boolean {
  return Boolean(STELLAR_DEPOSIT_ADDRESS && USDC_ISSUER);
}

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

export interface WebhookInput {
  body: unknown;
  rawBody?: string;
  headers: Record<string, string | undefined>;
}

export interface PaymentProvider {
  readonly id: string;
  readonly sandbox: boolean;
  /** Etiqueta para la UI (ej. "Bre-B", "Tarjeta (Stripe)"). */
  readonly label: string;
  /** País/segmento (ej. "CO", "Intl") — informativo para la UI. */
  readonly country?: string;
  /** 'qr' = pago in-app; 'redirect' = checkout del PSP; 'deposit' = enviar cripto a una dirección. */
  readonly mode: 'qr' | 'redirect' | 'deposit';
  createCharge(input: CreateChargeInput): Charge | Promise<Charge>;
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
  handleWebhook?(input: WebhookInput): Promise<{ ok: boolean; credited: boolean }>;
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

/** Mezcla campos en el `detail` (metadata JSON) de un cobro. */
function mergeChargeDetail(id: string, patch: Record<string, unknown>): void {
  const r = db.prepare('SELECT metadata FROM payment_charges WHERE id = ?').get(id) as
    | { metadata: string | null }
    | undefined;
  const cur = r?.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {};
  db.prepare('UPDATE payment_charges SET metadata = ? WHERE id = ?').run(
    JSON.stringify({ ...cur, ...patch }),
    id,
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
  readonly label = 'Bre-B';
  readonly country = 'CO';
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
  readonly label = 'Wompi';
  readonly country = 'CO';
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

  async handleWebhook({ body, headers }: WebhookInput): Promise<{ ok: boolean; credited: boolean }> {
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
    const received = (headers['x-event-checksum'] || sig.checksum).toLowerCase();
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

// ─── Stripe provider (tarjeta internacional) ───────────────────

interface StripeSession {
  id: string;
  url?: string;
  status?: 'open' | 'complete' | 'expired';
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  client_reference_id?: string;
  amount_total?: number;
}

class StripeProvider implements PaymentProvider {
  readonly id = 'stripe';
  readonly sandbox = STRIPE_SECRET_KEY.startsWith('sk_test');
  readonly label = 'Tarjeta (Stripe)';
  readonly country = 'Intl';
  readonly mode = 'redirect' as const;

  private async stripe(path: string, method: 'GET' | 'POST', form?: URLSearchParams): Promise<any> {
    const res = await fetch(`${STRIPE_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${json.error?.message ?? 'request failed'}`);
    return json;
  }

  async createCharge({ userId, amountCop, redirectUrl }: CreateChargeInput): Promise<Charge> {
    // Stripe cobra en USD (tarjeta internacional). Convertimos COP→USD; los créditos
    // se acreditan por amount_usd. USD = 2 decimales → centavos.
    const amountUsd = copToUsd(amountCop);
    const cents = Math.round(amountUsd * 100);
    const reference = `KIBA-${randomBytes(8).toString('hex').toUpperCase()}`;

    // 1. Creamos el cobro local para tener el id (va en metadata de Stripe).
    const charge = insertCharge({
      userId,
      provider: this.id,
      method: 'stripe',
      reference,
      amountCop,
      amountUsd,
      detail: {},
    });

    // 2. Creamos la Checkout Session en Stripe.
    const redirect = redirectUrl || DEFAULT_REDIRECT;
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', `${redirect}?session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url', `${redirect}?canceled=1`);
    form.set('client_reference_id', reference);
    form.set('metadata[chargeId]', charge.id);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][unit_amount]', String(cents));
    form.set('line_items[0][price_data][product_data][name]', 'Kiba — recarga de créditos (Kibs)');
    const session = (await this.stripe('/checkout/sessions', 'POST', form)) as StripeSession;

    // 3. Guardamos la URL + el session id en el cobro.
    mergeChargeDetail(charge.id, { checkoutUrl: session.url, sessionId: session.id, amountUsdCents: cents });
    return loadCharge(charge.id, userId)!;
  }

  getCharge(id: string, userId: number): Charge | null {
    return loadCharge(id, userId);
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
      return { charge, newBalanceUsd: lamportsToUsd(getBalance(userId)), status: 'paid' };
    }
    const session = (await this.stripe(
      `/checkout/sessions/${encodeURIComponent(providerTxId)}`,
      'GET',
    )) as StripeSession;
    if (session.client_reference_id !== charge.reference) throw new Error('reference mismatch');

    if (session.payment_status === 'paid') {
      applyCredit(chargeId);
    } else if (session.status === 'expired') {
      db.prepare(
        "UPDATE payment_charges SET status = 'expired' WHERE id = ? AND status = 'pending'",
      ).run(chargeId);
    }
    return {
      charge: loadCharge(chargeId, userId)!,
      newBalanceUsd: lamportsToUsd(getBalance(userId)),
      status: session.payment_status ?? session.status ?? 'pending',
    };
  }

  async handleWebhook({ rawBody, headers }: WebhookInput): Promise<{ ok: boolean; credited: boolean }> {
    const sigHeader = headers['stripe-signature'];
    if (!sigHeader || !rawBody || !STRIPE_WEBHOOK_SECRET) return { ok: false, credited: false };

    // Firma Stripe: header "t=<ts>,v1=<hmac>"; firmado = HMAC_SHA256(`${t}.${rawBody}`, secret).
    const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = parts['t'];
    const v1 = parts['v1'];
    if (!t || !v1) return { ok: false, credited: false };
    const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, credited: false };

    const event = JSON.parse(rawBody) as { type?: string; data?: { object?: StripeSession } };
    if (event.type !== 'checkout.session.completed') return { ok: true, credited: false };
    const session = event.data?.object;
    if (!session || session.payment_status !== 'paid' || !session.client_reference_id) {
      return { ok: true, credited: false };
    }
    const row = loadChargeByReference(session.client_reference_id);
    if (!row) return { ok: true, credited: false };
    const outcome = applyCredit(row.id);
    return { ok: true, credited: outcome === 'credited' };
  }
}

// ─── PayPal provider (cuenta/tarjeta internacional) ────────────

interface PayPalOrder {
  id: string;
  status?: string;
  links?: { rel: string; href: string }[];
  purchase_units?: { reference_id?: string; custom_id?: string }[];
}

class PayPalProvider implements PaymentProvider {
  readonly id = 'paypal';
  readonly sandbox = PAYPAL_API_URL.includes('sandbox');
  readonly label = 'PayPal';
  readonly country = 'Intl';
  readonly mode = 'redirect' as const;

  private token: { value: string; exp: number } | null = null;

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !j.access_token) throw new Error(`PayPal auth failed (${res.status})`);
    this.token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  private async api(path: string, method: 'GET' | 'POST', body?: object): Promise<any> {
    const res = await fetch(`${PAYPAL_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }

  async createCharge({ userId, amountCop, redirectUrl }: CreateChargeInput): Promise<Charge> {
    const amountUsd = copToUsd(amountCop);
    const reference = `KIBA-${randomBytes(8).toString('hex').toUpperCase()}`;
    const charge = insertCharge({
      userId,
      provider: this.id,
      method: 'paypal',
      reference,
      amountCop,
      amountUsd,
      detail: {},
    });

    const redirect = redirectUrl || DEFAULT_REDIRECT;
    const { ok, status, json } = await this.api('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: reference,
          custom_id: reference,
          amount: { currency_code: 'USD', value: amountUsd.toFixed(2) },
        },
      ],
      application_context: {
        return_url: redirect,
        cancel_url: `${redirect}?canceled=1`,
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        brand_name: 'Kiba',
      },
    });
    const order = json as PayPalOrder;
    if (!ok || !order.id) {
      throw new Error(`PayPal create order failed (${status})`);
    }
    const approve = order.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) throw new Error('PayPal approve link missing');

    mergeChargeDetail(charge.id, { checkoutUrl: approve.href, orderId: order.id });
    return loadCharge(charge.id, userId)!;
  }

  getCharge(id: string, userId: number): Charge | null {
    return loadCharge(id, userId);
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
      return { charge, newBalanceUsd: lamportsToUsd(getBalance(userId)), status: 'COMPLETED' };
    }

    // Captura la orden (providerTxId = orderId que vuelve como ?token=).
    let cap = await this.api(`/v2/checkout/orders/${encodeURIComponent(providerTxId)}/capture`, 'POST', {});
    let order = cap.json as PayPalOrder;
    // Si ya estaba capturada, consultamos el estado real (idempotencia).
    if (!cap.ok) {
      const got = await this.api(`/v2/checkout/orders/${encodeURIComponent(providerTxId)}`, 'GET');
      order = got.json as PayPalOrder;
    }

    const ref = order.purchase_units?.[0]?.reference_id ?? order.purchase_units?.[0]?.custom_id;
    if (ref && ref !== charge.reference) throw new Error('reference mismatch');

    if (order.status === 'COMPLETED') {
      applyCredit(chargeId);
    } else if (order.status === 'VOIDED') {
      db.prepare(
        "UPDATE payment_charges SET status = 'expired' WHERE id = ? AND status = 'pending'",
      ).run(chargeId);
    }
    return {
      charge: loadCharge(chargeId, userId)!,
      newBalanceUsd: lamportsToUsd(getBalance(userId)),
      status: order.status ?? 'pending',
    };
  }
}

// ─── USDC en Stellar (depósito cripto) ─────────────────────────

interface HorizonPayment {
  type: string;
  asset_code?: string;
  asset_issuer?: string;
  to?: string;
  amount?: string;
  transaction_hash?: string;
  transaction?: { memo?: string; memo_type?: string };
}

class StellarUsdcProvider implements PaymentProvider {
  readonly id = 'stellar-usdc';
  readonly sandbox = STELLAR_HORIZON_URL.includes('testnet');
  readonly label = 'USDC (Stellar)';
  readonly country = 'Cripto';
  readonly mode = 'deposit' as const;

  createCharge({ userId, amountCop }: CreateChargeInput): Charge {
    const amountUsd = copToUsd(amountCop);
    // Memo Stellar: máx 28 bytes. Único por cobro → atribuye el depósito.
    const memo = `KIBA${randomBytes(6).toString('hex').toUpperCase()}`;
    return insertCharge({
      userId,
      provider: this.id,
      method: 'stellar-usdc',
      reference: memo,
      amountCop,
      amountUsd,
      detail: {
        network: 'Stellar',
        asset: USDC_CODE,
        issuer: USDC_ISSUER,
        depositAddress: STELLAR_DEPOSIT_ADDRESS,
        memo,
        memoType: 'text',
        amountUsdc: Number(amountUsd.toFixed(7)),
        instructions:
          'Envía exactamente este monto en USDC (Stellar) a la dirección, INCLUYENDO el memo. Sin el memo no se acredita.',
      },
    });
  }

  getCharge(id: string, userId: number): Charge | null {
    return loadCharge(id, userId);
  }

  /**
   * Busca en Horizon un pago USDC entrante a la dirección con el memo del cobro.
   * `providerTxId` no se usa (el depósito se identifica por memo, no por id de cliente).
   */
  async verifyCharge({
    chargeId,
    userId,
  }: {
    chargeId: string;
    userId: number;
    providerTxId: string;
  }): Promise<VerifyResult> {
    const charge = loadCharge(chargeId, userId);
    if (!charge) throw new Error('charge not found');
    if (charge.status === 'paid') {
      return { charge, newBalanceUsd: lamportsToUsd(getBalance(userId)), status: 'paid' };
    }

    const memo = String(charge.detail.memo ?? charge.reference);
    const res = await fetch(
      `${STELLAR_HORIZON_URL}/accounts/${encodeURIComponent(STELLAR_DEPOSIT_ADDRESS)}/payments?order=desc&limit=50&join=transactions`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) {
      // Cuenta sin movimientos aún (404) u otro → sigue pendiente, no es error fatal.
      return { charge, newBalanceUsd: lamportsToUsd(getBalance(userId)), status: 'pending' };
    }
    const json = (await res.json().catch(() => ({}))) as { _embedded?: { records?: HorizonPayment[] } };
    const records = json._embedded?.records ?? [];
    const min = charge.amountUsd - 1e-6;
    const match = records.find(
      (r) =>
        r.type === 'payment' &&
        r.asset_code === USDC_CODE &&
        r.asset_issuer === USDC_ISSUER &&
        r.to === STELLAR_DEPOSIT_ADDRESS &&
        r.transaction?.memo === memo &&
        Number(r.amount ?? '0') >= min,
    );

    if (match) {
      // Guarda el hash del depósito y acredita.
      mergeChargeDetail(chargeId, { depositTxHash: match.transaction_hash });
      applyCredit(chargeId);
    }
    return {
      charge: loadCharge(chargeId, userId)!,
      newBalanceUsd: lamportsToUsd(getBalance(userId)),
      status: match ? 'paid' : 'pending',
    };
  }
}

// ─── Registry (múltiples métodos a la vez) ─────────────────────
//
// Se ofrecen TODOS los métodos disponibles simultáneamente (no uno solo): el
// usuario elige en la UI. Bre-B sandbox siempre está; wompi/stripe si hay llaves.
// `PAYMENT_PROVIDER` solo marca cuál va PRIMERO (default sugerido).

const cache = new Map<string, PaymentProvider>();

function build(id: string): PaymentProvider | null {
  switch (id) {
    case 'bre-b-sandbox':
      return new BrebSandboxProvider();
    case 'wompi':
      return wompiConfigured() ? new WompiProvider() : null;
    case 'stripe':
      return stripeConfigured() ? new StripeProvider() : null;
    case 'paypal':
      return paypalConfigured() ? new PayPalProvider() : null;
    case 'stellar-usdc':
      return stellarConfigured() ? new StellarUsdcProvider() : null;
    default:
      return null;
  }
}

/** IDs de métodos disponibles, con el default (`PAYMENT_PROVIDER`) de primero. */
function availableIds(): string[] {
  const ids = ['bre-b-sandbox'];
  if (wompiConfigured()) ids.push('wompi');
  if (stripeConfigured()) ids.push('stripe');
  if (paypalConfigured()) ids.push('paypal');
  if (stellarConfigured()) ids.push('stellar-usdc');
  return ids.sort((a, b) => (a === PROVIDER ? -1 : b === PROVIDER ? 1 : 0));
}

/** Provider por id. Lanza si no está disponible (sin llaves). */
export function getProvider(id: string): PaymentProvider {
  const cached = cache.get(id);
  if (cached) return cached;
  const p = build(id);
  if (!p) throw new Error(`payment provider not available: ${id}`);
  cache.set(id, p);
  return p;
}

/** Todos los métodos de pago activos (para la UI). */
export function listProviders(): PaymentProvider[] {
  return availableIds().map((id) => getProvider(id));
}

/** Provider por defecto (primero disponible / el de PAYMENT_PROVIDER). */
export function getPaymentProvider(): PaymentProvider {
  return getProvider(availableIds()[0]);
}

/**
 * Verifica un cobro devuelto por un checkout, enrutando al provider correcto según
 * el `provider` guardado en el propio cobro (no depende del cliente).
 */
export async function verifyCharge(args: {
  chargeId: string;
  userId: number;
  providerTxId: string;
}): Promise<VerifyResult> {
  const row = db
    .prepare('SELECT provider FROM payment_charges WHERE id = ? AND user_id = ?')
    .get(args.chargeId, args.userId) as { provider: string } | undefined;
  if (!row) throw new Error('charge not found');
  const p = getProvider(row.provider);
  if (!p.verifyCharge) throw new Error('verify not supported by provider');
  return p.verifyCharge(args);
}

/** Lectura de un cobro (agnóstica al provider). */
export function getCharge(id: string, userId: number): Charge | null {
  return loadCharge(id, userId);
}
