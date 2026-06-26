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
import { db, type OAuthSessionRow, type OAuthClientRow } from './db';
import { newRandomId } from './auth';

const SESSION_TTL = 10 * 60; // 10 minutos para completar el flow
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 días

export function createOAuthSession(args: {
  codeChallenge: string;
  redirectUri: string;
  clientName: string;
  // Campos del flujo OAuth estándar (connectors remotos). Opcionales: el flujo
  // stdio existente no los pasa y quedan NULL.
  state?: string;
  clientId?: string;
  resource?: string;
}): string {
  const sessionId = newRandomId('sess', 16);
  db.prepare(
    `INSERT INTO oauth_sessions (session_id, code_challenge, redirect_uri, client_name, state, client_id, resource, expires_at)
     VALUES (@sessionId, @codeChallenge, @redirectUri, @clientName, @state, @clientId, @resource, @expiresAt)`,
  ).run({
    sessionId,
    codeChallenge: args.codeChallenge,
    redirectUri: args.redirectUri,
    clientName: args.clientName,
    state: args.state ?? null,
    clientId: args.clientId ?? null,
    resource: args.resource ?? null,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL,
  });
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
    'UPDATE oauth_sessions SET user_id = @userId, code = @code, consumed = 1 WHERE session_id = @sessionId',
  ).run({ userId, code, sessionId });
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
    `INSERT INTO oauth_tokens (token, user_id, client_name, resource, expires_at, created_at)
     VALUES (@token, @userId, @clientName, @resource, @expiresAt, @createdAt)`,
  ).run({
    token,
    userId: session.user_id,
    clientName: session.client_name,
    // RFC 8707: liga el token a la audiencia (`resource`) que pidió el cliente en
    // el authorize. NULL para el flujo stdio (que no manda resource).
    resource: session.resource ?? null,
    expiresAt: now + TOKEN_TTL,
    createdAt: now,
  });

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

// ─── Dynamic Client Registration (RFC 7591) ────────────────────
// Claude.ai y ChatGPT no tienen un client_id pre-emitido: lo obtienen
// auto-registrándose contra POST /register. Clientes públicos (PKCE, sin secret).

export interface RegisterClientInput {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

export function registerOAuthClient(input: RegisterClientInput): OAuthClientRow {
  const row: OAuthClientRow = {
    client_id: newRandomId('client', 16),
    client_secret: null, // public client (PKCE), sin secret
    client_name: input.client_name ?? null,
    redirect_uris: JSON.stringify(input.redirect_uris ?? []),
    grant_types: JSON.stringify(input.grant_types ?? ['authorization_code']),
    response_types: JSON.stringify(input.response_types ?? ['code']),
    scope: input.scope ?? null,
    token_endpoint_auth_method: input.token_endpoint_auth_method ?? 'none',
    created_at: Math.floor(Date.now() / 1000),
  };
  db.prepare(
    `INSERT INTO oauth_clients
       (client_id, client_secret, client_name, redirect_uris, grant_types, response_types, scope, token_endpoint_auth_method, created_at)
     VALUES
       (@client_id, @client_secret, @client_name, @redirect_uris, @grant_types, @response_types, @scope, @token_endpoint_auth_method, @created_at)`,
  ).run(row);
  return row;
}

export function getOAuthClient(clientId: string): OAuthClientRow | null {
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as
    | OAuthClientRow
    | undefined;
  return row ?? null;
}
