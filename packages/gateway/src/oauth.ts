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
import { db, type OAuthSessionRow, type OAuthClientRow, type OAuthRefreshTokenRow } from './db';
import { newRandomId } from './auth';

const SESSION_TTL = 10 * 60; // 10 minutos para completar el flow
// Access token 30d (sin cambio: el cliente stdio re-autentica por browser al
// expirar y no usa refresh, así que acortarlo rompería su UX). El refresh token
// (1 año, deslizante por rotación) hace que la conexión de Claude/ChatGPT
// sobreviva indefinidamente mientras se use: al expirar el access, el cliente
// renueva con grant_type=refresh_token sin abrir el navegador.
const ACCESS_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 días
const REFRESH_TOKEN_TTL = 365 * 24 * 60 * 60; // 365 días (se desliza en cada rotación)

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
 * Mintea un par access_token + refresh_token ligados a un usuario/cliente.
 * El access va a oauth_tokens (lo que valida el verifier); el refresh a
 * oauth_refresh_tokens. Comparten `resource` (audiencia RFC 8707) y `family_id`
 * (linaje de rotación). No abre transacción propia: los callers lo envuelven en
 * db.transaction junto al resto de su trabajo (better-sqlite3 no anida tx).
 */
function issueAccessAndRefresh(p: {
  userId: number;
  clientName: string;
  resource: string | null;
  familyId: string;
}): { access_token: string; refresh_token: string; expires_in: number } {
  const now = Math.floor(Date.now() / 1000);
  const access_token = newRandomId('tok', 32);
  const refresh_token = newRandomId('rt', 32);
  db.prepare(
    `INSERT INTO oauth_tokens (token, user_id, client_name, resource, expires_at, created_at)
     VALUES (@token, @userId, @clientName, @resource, @expiresAt, @createdAt)`,
  ).run({
    token: access_token,
    userId: p.userId,
    clientName: p.clientName,
    resource: p.resource,
    expiresAt: now + ACCESS_TOKEN_TTL,
    createdAt: now,
  });
  db.prepare(
    `INSERT INTO oauth_refresh_tokens
       (refresh_token, user_id, client_name, resource, access_token, family_id, replaced_by, revoked, expires_at, created_at)
     VALUES (@rt, @userId, @clientName, @resource, @accessToken, @familyId, NULL, 0, @expiresAt, @createdAt)`,
  ).run({
    rt: refresh_token,
    userId: p.userId,
    clientName: p.clientName,
    resource: p.resource,
    accessToken: access_token,
    familyId: p.familyId,
    expiresAt: now + REFRESH_TOKEN_TTL,
    createdAt: now,
  });
  return { access_token, refresh_token, expires_in: ACCESS_TOKEN_TTL };
}

/**
 * Intercambia code + code_verifier por access_token + refresh_token.
 */
export function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
):
  | { access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer' }
  | { error: string } {
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

  // RFC 8707: liga los tokens a la audiencia (`resource`) que pidió el cliente en
  // el authorize. NULL para el flujo stdio. Familia nueva por autorización; el
  // code es de un solo uso (se borra en la misma transacción que el minteo).
  const userId = session.user_id;
  const clientName = session.client_name;
  const resource = session.resource ?? null;
  const familyId = newRandomId('rtf', 16);
  const issue = db.transaction(() => {
    const pair = issueAccessAndRefresh({ userId, clientName, resource, familyId });
    db.prepare('DELETE FROM oauth_sessions WHERE code = ?').run(code);
    return pair;
  });
  const pair = issue();

  return {
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    expires_in: pair.expires_in,
    token_type: 'Bearer',
  };
}

/**
 * Renueva un access token a partir de un refresh token (grant_type=refresh_token).
 * OAuth 2.1 para clientes públicos: ROTA el refresh (emite uno nuevo e invalida el
 * presentado) y revoca el access viejo. Preserva la audiencia (`resource`).
 * Detección de reuso: si se presenta un refresh ya rotado, se asume robo y se
 * quema la familia entera.
 */
export function refreshAccessToken(
  refreshToken: string,
):
  | { access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer' }
  | { error: 'invalid_grant' } {
  const row = db
    .prepare('SELECT * FROM oauth_refresh_tokens WHERE refresh_token = ?')
    .get(refreshToken) as OAuthRefreshTokenRow | undefined;

  if (!row) return { error: 'invalid_grant' };
  // Reuso de un refresh ya consumido → señal de robo: quema toda la familia.
  if (row.replaced_by) {
    burnRefreshFamily(row.family_id);
    return { error: 'invalid_grant' };
  }
  if (row.revoked) return { error: 'invalid_grant' };
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) return { error: 'invalid_grant' };

  const rotate = db.transaction(() => {
    // Access TTL largo (30d): al rotar revocamos el access viejo para que solo haya
    // un access vivo por conexión (mantiene listOAuthConnections limpio).
    if (row.access_token) {
      db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token = ?').run(row.access_token);
    }
    const pair = issueAccessAndRefresh({
      userId: row.user_id,
      clientName: row.client_name,
      resource: row.resource, // PRESERVA la audiencia; ignora cualquier `resource` del form
      familyId: row.family_id, // MISMA familia (linaje de rotación)
    });
    db.prepare('UPDATE oauth_refresh_tokens SET replaced_by = ? WHERE refresh_token = ?').run(
      pair.refresh_token,
      refreshToken,
    );
    return pair;
  });
  const pair = rotate();

  return {
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    expires_in: pair.expires_in,
    token_type: 'Bearer',
  };
}

/**
 * Revoca toda una familia de refresh (todos los refresh + sus access tokens).
 * Idempotente. Usada en detección de reuso y en la cascada de revocación.
 */
export function burnRefreshFamily(familyId: string): void {
  const burn = db.transaction(() => {
    db.prepare(
      `UPDATE oauth_tokens SET revoked = 1
       WHERE token IN (
         SELECT access_token FROM oauth_refresh_tokens
         WHERE family_id = ? AND access_token IS NOT NULL
       )`,
    ).run(familyId);
    db.prepare('UPDATE oauth_refresh_tokens SET revoked = 1 WHERE family_id = ?').run(familyId);
  });
  burn();
}

/**
 * Dado un token (access O refresh), quema su familia de refresh. `family_id` es
 * la identidad durable de la conexión.
 */
export function revokeRefreshFamilyForToken(token: string): void {
  const row = db
    .prepare(
      'SELECT family_id FROM oauth_refresh_tokens WHERE refresh_token = ? OR access_token = ? LIMIT 1',
    )
    .get(token, token) as { family_id: string } | undefined;
  if (row) burnRefreshFamily(row.family_id);
}

export function revokeToken(token: string): void {
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token = ?').run(token);
  // Cascada: revocar también la familia de refresh asociada (RFC 7009: revocar un
  // refresh debe matar su access, y al revés). Sin esto, un access revocado podría
  // "revivir" vía su refresh token. `token` puede ser un access o un refresh.
  revokeRefreshFamilyForToken(token);
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

const CLIENT_PURGE_DAYS = 30;

/** Clave canónica de redirect_uris: dedup + orden estable (insensible a orden). */
function canonicalRedirectUris(uris: string[]): string {
  return JSON.stringify([...new Set(uris)].sort());
}

/**
 * Purga oportunista de clientes DCR huérfanos: registrados hace > 30 días y sin
 * ningún token (access o refresh) vivo asociado por client_name. Mantiene
 * oauth_clients acotada pese a que Claude se re-registra en cada conexión.
 * `NOT EXISTS` (no `NOT IN`) para evitar trampas con NULL.
 */
function purgeOrphanClients(): void {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - CLIENT_PURGE_DAYS * 24 * 60 * 60;
  db.prepare(
    `DELETE FROM oauth_clients
     WHERE created_at < @cutoff
       AND client_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM oauth_tokens t
         WHERE t.client_name = oauth_clients.client_name AND t.revoked = 0 AND t.expires_at > @now
       )
       AND NOT EXISTS (
         SELECT 1 FROM oauth_refresh_tokens r
         WHERE r.client_name = oauth_clients.client_name AND r.revoked = 0 AND r.expires_at > @now
       )`,
  ).run({ cutoff, now });
}

export function registerOAuthClient(input: RegisterClientInput): OAuthClientRow {
  const clientName = input.client_name ?? null;
  const redirectUris = canonicalRedirectUris(input.redirect_uris ?? []);

  // Limpieza oportunista de huérfanos viejos (nunca toca filas con created_at = now).
  purgeOrphanClients();

  // Dedup: Claude (DCR) se re-registra en cada conexión con el mismo nombre y el
  // mismo callback. Si ya existe un cliente con idéntico (client_name, redirect_uris)
  // reutilizamos su client_id → oauth_clients deja de crecer. `IS` = null-safe.
  const existing = db
    .prepare(
      'SELECT * FROM oauth_clients WHERE client_name IS ? AND redirect_uris = ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(clientName, redirectUris) as OAuthClientRow | undefined;
  if (existing) return existing;

  const row: OAuthClientRow = {
    client_id: newRandomId('client', 16),
    client_secret: null, // public client (PKCE), sin secret
    client_name: clientName,
    redirect_uris: redirectUris, // guardamos la forma canónica (orden estable)
    grant_types: JSON.stringify(input.grant_types ?? ['authorization_code', 'refresh_token']),
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
