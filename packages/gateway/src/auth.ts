/**
 * Auth helpers: signup, login, session JWT, custodial wallet generation.
 */
import bcrypt from 'bcryptjs';
import { Keypair } from '@solana/web3.js';
import { createHmac, randomBytes } from 'node:crypto';
import { db, type UserRow } from './db';
import { usdToLamports } from './billing';

/** Bono de bienvenida en USD, convertido a unidades base de la cadena activa. */
const SIGNUP_BONUS_USD = 5;

const DEFAULT_JWT_SECRET = 'dev-secret-change-in-prod';
// Seguridad independiente de NODE_ENV: NUNCA firmar con el default público ni con un
// secreto débil. Si falta/es inseguro: en producción se aborta; fuera de producción se
// genera uno ALEATORIO efímero (las sesiones no sobreviven a un reinicio — aceptable en
// dev/testnet) de modo que las cookies jamás se firman con un secreto conocido/forjable.
const envSecret = process.env.JWT_SECRET;
let JWT_SECRET: string;
if (!envSecret || envSecret === DEFAULT_JWT_SECRET || envSecret.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[auth] JWT_SECRET ausente o inseguro en producción. Define uno fuerte: openssl rand -base64 48',
    );
  }
  JWT_SECRET = randomBytes(48).toString('base64url');
  console.warn(
    '[auth] JWT_SECRET ausente o inseguro — usando un secreto ALEATORIO efímero ' +
      '(las sesiones no sobreviven a reinicios). Define JWT_SECRET para persistirlas.',
  );
} else {
  JWT_SECRET = envSecret;
}

// ─── JWT helpers (HMAC-SHA256, sin librería) ───────────────────

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signJwt(payload: object, ttlSeconds = 60 * 60 * 24 * 30): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(fullPayload));
  const sig = base64url(createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function verifyJwt<T = unknown>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = base64url(createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest());
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(fromBase64url(p).toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as T;
  } catch {
    return null;
  }
}

// ─── User CRUD ─────────────────────────────────────────────────

export function createUser(email: string, password: string): UserRow | { error: string } {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return { error: 'Email ya registrado' };

  const password_hash = bcrypt.hashSync(password, 10);
  const wallet = Keypair.generate();
  // TODO(seguridad/custodia): la private key se guarda en CLARO en SQLite — aceptable en
  // testnet/hackathon, NO en mainnet. Endurecer antes de producción real: cifrado en reposo
  // (AES-256-GCM + KMS) o delegar la custodia a Accesly (social login + gasless sobre Stellar)
  // y dejar de almacenar claves aquí. Ver docs/TEST_PLAN.md (gateway-20/21).
  const custodial_wallet_secret = JSON.stringify(Array.from(wallet.secretKey));
  const custodial_wallet_pubkey = wallet.publicKey.toBase58();

  // Bono inicial en USD → unidades base del activo activo (chain-aware).
  const bonusLamports = usdToLamports(SIGNUP_BONUS_USD);

  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, bonusLamports, Math.floor(Date.now() / 1000));

  const userId = result.lastInsertRowid as number;

  // Registrar bono
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount_lamports, service, created_at)
     VALUES (?, 'topup', ?, 'signup-bonus', ?)`,
  ).run(userId, bonusLamports, Math.floor(Date.now() / 1000));

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
}

export function authenticate(email: string, password: string): UserRow | null {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

export function getUser(id: number): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
}

export function getUserByToken(token: string): UserRow | null {
  const row = db
    .prepare('SELECT * FROM oauth_tokens WHERE token = ? AND revoked = 0')
    .get(token) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return getUser(row.user_id);
}

// ─── Random tokens ─────────────────────────────────────────────

export function newRandomId(prefix: string, bytes = 24): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}
