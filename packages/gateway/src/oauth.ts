/**
 * OAuth 2.0 con PKCE flow para autenticar MCP clients.
 *
 * Flow:
 *  1. MCP cliente: GET /auth/connect?session=X&code_challenge=Y&redirect_uri=http://localhost:54321/cb&client_name=Z
 *     → si user no logueado, redirige a /login?next=...
 *     → si logueado, muestra "Authorize?"
 *  2. Usuario clickea Autorizar → POST /auth/authorize
 *     → genera code, redirige a redirect_uri con code en query
 *  3. MCP cliente recibe code en su local server
 *  4. POST /oauth/token con { code, code_verifier }
 *     → valida sha256(code_verifier) === code_challenge
 *     → emite access_token (opaque, en DB)
 */
import { createHash } from 'node:crypto';
import { db, type OAuthSessionRow } from './db';
import { newRandomId } from './auth';

const SESSION_TTL = 10 * 60; // 10 minutos para completar el flow
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 días

export function createOAuthSession(args: {
  codeChallenge: string;
  redirectUri: string;
  clientName: string;
}): string {
  const sessionId = newRandomId('sess', 16);
  db.prepare(
    `INSERT INTO oauth_sessions (session_id, code_challenge, redirect_uri, client_name, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    args.codeChallenge,
    args.redirectUri,
    args.clientName,
    Math.floor(Date.now() / 1000) + SESSION_TTL,
  );
  return sessionId;
}

export function getOAuthSession(sessionId: string): OAuthSessionRow | null {
  const row = db.prepare('SELECT * FROM oauth_sessions WHERE session_id = ?').get(sessionId) as
    | OAuthSessionRow
    | undefined;
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row;
}

export function authorizeSession(sessionId: string, userId: number): string | null {
  const session = getOAuthSession(sessionId);
  if (!session) return null;
  if (session.consumed) return null;

  const code = newRandomId('code', 24);
  db.prepare(
    'UPDATE oauth_sessions SET user_id = ?, code = ?, consumed = 1 WHERE session_id = ?',
  ).run(userId, code, sessionId);
  return code;
}

/**
 * Intercambia code + code_verifier por access_token.
 */
export function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): { access_token: string; expires_in: number; token_type: 'Bearer' } | { error: string } {
  const session = db
    .prepare('SELECT * FROM oauth_sessions WHERE code = ?')
    .get(code) as OAuthSessionRow | undefined;

  if (!session) return { error: 'invalid_code' };
  if (!session.user_id) return { error: 'session_not_authorized' };

  // Verifica PKCE: code_challenge === sha256(code_verifier) base64url
  const computed = createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (computed !== session.code_challenge) {
    return { error: 'invalid_code_verifier' };
  }

  const token = newRandomId('tok', 32);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO oauth_tokens (token, user_id, client_name, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(token, session.user_id, session.client_name, now + TOKEN_TTL, now);

  // Borrar el code para que no se pueda reusar
  db.prepare('DELETE FROM oauth_sessions WHERE code = ?').run(code);

  return {
    access_token: token,
    expires_in: TOKEN_TTL,
    token_type: 'Bearer',
  };
}

export function revokeToken(token: string): void {
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token = ?').run(token);
}
