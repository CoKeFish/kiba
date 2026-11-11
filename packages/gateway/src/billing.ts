/**
 * Créditos: el saldo prepago de una cuenta.
 *
 * Los créditos son un prepago de servicios, no dinero guardado:
 *   - Solo sirven para pagar llamadas. No se retiran ni se transfieren a otra cuenta: ninguna
 *     función de este módulo, ni ninguna ruta, los saca de la cuenta de otra forma.
 *   - Tienen tope por cuenta (CREDIT_MAX_BALANCE_USD): no se puede recargar por encima.
 *   - Caducan (CREDIT_EXPIRY_DAYS después de entrar a la cuenta).
 *
 * Para la caducidad el saldo se lleva por lotes (`credit_lots`): cada entrada de créditos es un
 * lote con su fecha de vencimiento, y cada gasto consume primero el lote que vence antes.
 * `users.balance_lamports` sigue siendo el total. Los lotes se ponen al día con ese total antes
 * de cada gasto y en el trabajo periódico (`syncLots`), así que quien suma créditos (recargas,
 * reembolsos, devoluciones de reclamos) no tiene que saber de lotes.
 */
import { db, withTransaction, type TransactionRow, type Tx } from './db';
import { ASSET_USD_RATE, BASE_UNITS_PER_TOKEN } from './chain';

// "lamports" aquí significa "unidades base del activo activo": lamports en Solana,
// stroops en Stellar. Los nombres se conservan para no romper el resto del código.
export function usdToLamports(usd: number): number {
  return Math.floor((usd / ASSET_USD_RATE) * BASE_UNITS_PER_TOKEN);
}

export function lamportsToUsd(lamports: number): number {
  return (lamports / BASE_UNITS_PER_TOKEN) * ASSET_USD_RATE;
}

export function lamportsToSol(lamports: number): number {
  return lamports / BASE_UNITS_PER_TOKEN;
}

const DAY_S = 86_400;
/** Días que duran los créditos desde que entran a la cuenta. 0 = no caducan. */
export const CREDIT_EXPIRY_DAYS = (() => {
  const raw = process.env.CREDIT_EXPIRY_DAYS;
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : 365;
})();
/** Máximo de créditos que puede tener una cuenta (USD). Las recargas que lo superan se rechazan. */
export const CREDIT_MAX_BALANCE_USD = Number(process.env.CREDIT_MAX_BALANCE_USD) || 200;

export async function getBalance(userId: number): Promise<number> {
  const row = (await db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(userId)) as
    | { balance_lamports: number }
    | undefined;
  return row?.balance_lamports ?? 0;
}

/**
 * ¿Cabe esta recarga bajo el tope de la cuenta? Lanza si no. Los reembolsos y las devoluciones
 * no pasan por aquí: devuelven lo que ya era del usuario.
 */
export async function assertTopupAllowed(userId: number, amountUsd: number): Promise<void> {
  const current = lamportsToUsd(await getBalance(userId));
  if (current + amountUsd > CREDIT_MAX_BALANCE_USD + 1e-9) {
    const room = Math.max(0, CREDIT_MAX_BALANCE_USD - current);
    throw new Error(
      `una cuenta puede tener hasta ${CREDIT_MAX_BALANCE_USD} USD en créditos; tienes ${current.toFixed(2)} USD y puedes recargar hasta ${room.toFixed(2)} USD más`,
    );
  }
}

export async function topup(userId: number, amountUsd: number): Promise<{ newBalance: number }> {
  const lamports = usdToLamports(amountUsd);
  const now = Math.floor(Date.now() / 1000);
  await withTransaction(async (tx) => {
    await tx
      .prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?')
      .run(lamports, userId);
    await tx
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'topup', ?, 'fake-stripe', ?, ?)`,
      )
      .run(userId, lamports, JSON.stringify({ usd: amountUsd, rate: ASSET_USD_RATE }), now);
  });
  return { newBalance: await getBalance(userId) };
}

// ─── Lotes y caducidad ──────────────────────────────────────────────────────

interface Lot {
  id: number;
  remaining: number;
  expires_at: number | null;
}

/** Lotes con saldo, en el orden en que se gastan: el que vence antes va primero. */
async function openLots(tx: Tx, userId: number): Promise<Lot[]> {
  return (await tx
    .prepare('SELECT id, remaining, expires_at FROM credit_lots WHERE user_id = ? AND remaining > 0 ORDER BY expires_at NULLS LAST, id FOR UPDATE')
    .all(userId)) as Lot[];
}

/** Saca `amount` de los lotes, empezando por el que vence antes. */
async function consume(tx: Tx, lots: Lot[], amount: number): Promise<void> {
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(Number(lot.remaining), left);
    await tx.prepare('UPDATE credit_lots SET remaining = remaining - ? WHERE id = ?').run(take, lot.id);
    lot.remaining = Number(lot.remaining) - take;
    left -= take;
  }
}

/**
 * Pone los lotes al día con el saldo de la cuenta. Lo que entró sin lote (una recarga, un
 * reembolso) se vuelve un lote nuevo que vence desde ahora. Devuelve los lotes con saldo.
 */
async function syncLots(tx: Tx, userId: number, balance: number, now: number): Promise<Lot[]> {
  const lots = await openLots(tx, userId);
  const inLots = lots.reduce((s, l) => s + Number(l.remaining), 0);
  if (balance > inLots) {
    const amount = balance - inLots;
    const expiresAt = CREDIT_EXPIRY_DAYS > 0 ? now + CREDIT_EXPIRY_DAYS * DAY_S : null;
    const info = await tx
      .prepare('INSERT INTO credit_lots (user_id, amount, remaining, expires_at, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .run(userId, amount, amount, expiresAt, now);
    lots.push({ id: Number(info.lastInsertRowid), remaining: amount, expires_at: expiresAt });
    lots.sort((a, b) => (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity) || a.id - b.id);
  } else if (balance < inLots) {
    // Algo descontó saldo sin pasar por `debit`: los lotes se ajustan igual.
    await consume(tx, lots, inLots - balance);
  }
  return lots.filter((l) => Number(l.remaining) > 0);
}

/**
 * Vence los créditos caducados de una cuenta dentro de la transacción de quien llama (que ya
 * tiene tomada la fila del usuario). Devuelve el saldo que queda y los lotes vigentes.
 */
async function expireLots(tx: Tx, userId: number, balance: number, now: number): Promise<{ balance: number; lots: Lot[] }> {
  const lots = await syncLots(tx, userId, balance, now);
  const dead = lots.filter((l) => l.expires_at != null && Number(l.expires_at) <= now);
  if (dead.length === 0) return { balance, lots };
  const expired = dead.reduce((s, l) => s + Number(l.remaining), 0);
  for (const l of dead) await tx.prepare('UPDATE credit_lots SET remaining = 0 WHERE id = ?').run(l.id);
  await tx.prepare('UPDATE users SET balance_lamports = balance_lamports - ? WHERE id = ?').run(expired, userId);
  await tx
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'expire', ?, 'credits', ?, ?)`,
    )
    .run(userId, -expired, JSON.stringify({ reason: `créditos sin usar en ${CREDIT_EXPIRY_DAYS} días` }), now);
  return { balance: balance - expired, lots: lots.filter((l) => !dead.includes(l)) };
}

async function lockedBalance(tx: Tx, userId: number): Promise<number | undefined> {
  const row = (await tx.prepare('SELECT balance_lamports FROM users WHERE id = ? FOR UPDATE').get(userId)) as
    | { balance_lamports: number }
    | undefined;
  return row === undefined ? undefined : Number(row.balance_lamports);
}

/** Trabajo periódico: vence los créditos caducados de todas las cuentas. Devuelve cuántas cuentas tocó. */
export async function expireCredits(now = Math.floor(Date.now() / 1000)): Promise<number> {
  const users = (await db.prepare('SELECT id FROM users WHERE balance_lamports > 0 ORDER BY id').all()) as Array<{ id: number }>;
  let touched = 0;
  for (const u of users) {
    await withTransaction(async (tx) => {
      const balance = await lockedBalance(tx, Number(u.id));
      if (balance === undefined) return;
      const after = await expireLots(tx, Number(u.id), balance, now);
      if (after.balance !== balance) touched++;
    });
  }
  return touched;
}

export interface CreditStatus {
  balanceLamports: number;
  /** Tope de créditos de la cuenta. */
  capUsd: number;
  /** Cuánto se puede recargar todavía sin pasar el tope. */
  roomUsd: number;
  /** Lo próximo que vence; null si nada caduca. */
  nextExpiry: { lamports: number; usd: number; at: number } | null;
  expiryDays: number;
}

/** Saldo de créditos con su tope y lo próximo que vence. */
export async function creditStatus(userId: number, now = Math.floor(Date.now() / 1000)): Promise<CreditStatus> {
  return withTransaction(async (tx) => {
    const balance = (await lockedBalance(tx, userId)) ?? 0;
    const after = await expireLots(tx, userId, balance, now);
    const first = after.lots.find((l) => l.expires_at != null);
    // Todo lo que vence en la misma fecha que el primer lote.
    const sameDay = first ? after.lots.filter((l) => l.expires_at === first.expires_at).reduce((s, l) => s + Number(l.remaining), 0) : 0;
    return {
      balanceLamports: after.balance,
      capUsd: CREDIT_MAX_BALANCE_USD,
      roomUsd: Math.max(0, CREDIT_MAX_BALANCE_USD - lamportsToUsd(after.balance)),
      nextExpiry: first ? { lamports: sameDay, usd: lamportsToUsd(sameDay), at: Number(first.expires_at) } : null,
      expiryDays: CREDIT_EXPIRY_DAYS,
    };
  });
}

/**
 * Debita lamports del balance del usuario. Falla si no hay saldo suficiente.
 * Atómico: toma la fila del usuario, vence lo caducado y gasta primero lo que vence antes.
 */
export async function debit(args: {
  userId: number;
  lamports: number;
  service: string;
  signature?: string;
  metadata?: object;
}): Promise<
  { ok: true; newBalance: number; transactionId: number } | { ok: false; error: string }
> {
  const { userId, lamports, service, signature, metadata } = args;
  const now = Math.floor(Date.now() / 1000);

  let newBalance = 0;
  let transactionId = 0;
  let failed: string | null = null;

  await withTransaction(async (tx) => {
    const locked = await lockedBalance(tx, userId);
    if (locked === undefined) {
      failed = 'user not found';
      return;
    }
    // Lo caducado no se puede gastar, aunque el trabajo periódico aún no haya pasado.
    const { balance: cur, lots } = await expireLots(tx, userId, locked, now);
    if (cur < lamports) {
      failed = 'insufficient balance';
      return;
    }
    await consume(tx, lots, lamports);
    await tx
      .prepare('UPDATE users SET balance_lamports = balance_lamports - ? WHERE id = ?')
      .run(lamports, userId);
    const info = await tx
      .prepare(
        `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
       VALUES (?, 'call', ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(userId, -lamports, service, signature ?? null, metadata ? JSON.stringify(metadata) : null, now);
    newBalance = cur - lamports;
    transactionId = Number(info.lastInsertRowid);
  });

  if (failed) return { ok: false, error: failed };
  return { ok: true, newBalance, transactionId };
}

/**
 * Stamps the on-chain signature on an existing transaction row. Used after
 * `debit()` runs (before the call) — once the call returns with a real signature
 * we backfill it so /v1/transactions can render explorer links.
 */
export async function attachSignature(transactionId: number, signature: string): Promise<void> {
  await db
    .prepare('UPDATE transactions SET signature = ? WHERE id = ?')
    .run(signature, transactionId);
}

export async function getTransactions(userId: number, limit = 50): Promise<TransactionRow[]> {
  return (await db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)) as TransactionRow[];
}
