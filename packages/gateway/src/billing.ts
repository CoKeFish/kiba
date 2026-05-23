/**
 * Billing helpers: balance, topup (fake), debit, transactions.
 */
import { db, type TransactionRow } from './db';
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

export function getBalance(userId: number): number {
  const row = db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(userId) as
    | { balance_lamports: number }
    | undefined;
  return row?.balance_lamports ?? 0;
}

export function topup(userId: number, amountUsd: number): { newBalance: number } {
  const lamports = usdToLamports(amountUsd);
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance_lamports = balance_lamports + ? WHERE id = ?').run(
      lamports,
      userId,
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, metadata, created_at)
       VALUES (?, 'topup', ?, 'fake-stripe', ?, ?)`,
    ).run(userId, lamports, JSON.stringify({ usd: amountUsd, rate: ASSET_USD_RATE }), now);
  });
  tx();
  return { newBalance: getBalance(userId) };
}

/**
 * Debita lamports del balance del usuario. Falla si no hay saldo suficiente.
 * Atomic: usa SQLite transaction.
 */
export function debit(args: {
  userId: number;
  lamports: number;
  service: string;
  signature?: string;
  metadata?: object;
}):
  | { ok: true; newBalance: number; transactionId: number }
  | { ok: false; error: string } {
  const { userId, lamports, service, signature, metadata } = args;
  const now = Math.floor(Date.now() / 1000);

  let newBalance = 0;
  let transactionId = 0;
  let failed: string | null = null;

  const tx = db.transaction(() => {
    const cur = (db.prepare('SELECT balance_lamports FROM users WHERE id = ?').get(userId) as
      | { balance_lamports: number }
      | undefined)?.balance_lamports;
    if (cur === undefined) {
      failed = 'user not found';
      return;
    }
    if (cur < lamports) {
      failed = 'insufficient balance';
      return;
    }
    db.prepare('UPDATE users SET balance_lamports = balance_lamports - ? WHERE id = ?').run(
      lamports,
      userId,
    );
    const info = db.prepare(
      `INSERT INTO transactions (user_id, type, amount_lamports, service, signature, metadata, created_at)
       VALUES (?, 'call', ?, ?, ?, ?, ?)`,
    ).run(userId, -lamports, service, signature ?? null, metadata ? JSON.stringify(metadata) : null, now);
    newBalance = cur - lamports;
    transactionId = Number(info.lastInsertRowid);
  });
  tx();

  if (failed) return { ok: false, error: failed };
  return { ok: true, newBalance, transactionId };
}

/**
 * Stamps the on-chain signature on an existing transaction row. Used after
 * `debit()` runs (before the call) — once the call returns with a real signature
 * we backfill it so /v1/transactions can render explorer links.
 */
export function attachSignature(transactionId: number, signature: string): void {
  db.prepare('UPDATE transactions SET signature = ? WHERE id = ?').run(signature, transactionId);
}

export function getTransactions(userId: number, limit = 50): TransactionRow[] {
  return db
    .prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(userId, limit) as TransactionRow[];
}
