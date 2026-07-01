import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  createOAuthSession,
  getOAuthSession,
  authorizeSession,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  registerOAuthClient,
  getOAuthClient,
} from '../src/oauth';
import { revokeOAuthByPrefix } from '../src/api-keys';
import { db, initDb, pool } from '../src/db';
import { mcpTokenVerifier } from '../src/mcp-oauth';

before(async () => {
  await initDb();
});

after(async () => {
  await pool.end();
});

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makePkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function createTestUser(email: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(email, 'fake', '[]', `pk-${email}`, 0, now);
  return Number(result.lastInsertRowid);
}

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
});

// ─── createOAuthSession + getOAuthSession ──────────────────────

test('createOAuthSession devuelve sessionId con prefijo "sess_"', async () => {
  const sessionId = await createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://localhost:3000/cb',
    clientName: 'test-client',
  });
  assert.match(sessionId, /^sess_/);
});

test('getOAuthSession recupera la fila recién creada con campos correctos', async () => {
  const sessionId = await createOAuthSession({
    codeChallenge: 'cc-xyz',
    redirectUri: 'http://localhost:9999/cb',
    clientName: 'cliente-x',
  });
  const got = await getOAuthSession(sessionId);
  assert.ok(got);
  assert.equal(got!.code_challenge, 'cc-xyz');
  assert.equal(got!.redirect_uri, 'http://localhost:9999/cb');
  assert.equal(got!.client_name, 'cliente-x');
  assert.equal(got!.consumed, 0);
  assert.equal(got!.code, null);
  assert.ok(got!.expires_at > Math.floor(Date.now() / 1000));
});

test('getOAuthSession con sessionId inexistente → null', async () => {
  assert.equal(await getOAuthSession('sess_nonexistent'), null);
});

test('getOAuthSession con sesión expirada → null', async () => {
  const sessionId = await createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://x',
    clientName: 'x',
  });
  // Forzar expiración
  await db
    .prepare('UPDATE oauth_sessions SET expires_at = ? WHERE session_id = ?')
    .run(Math.floor(Date.now() / 1000) - 1, sessionId);
  assert.equal(await getOAuthSession(sessionId), null);
});

// ─── authorizeSession ──────────────────────────────────────────

test('authorizeSession devuelve code y marca consumed=1', async () => {
  const userId = await createTestUser('u1@test');
  const sessionId = await createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = await authorizeSession(sessionId, userId);
  assert.ok(code);
  assert.match(code!, /^code_/);
  // Ahora la sesión está consumed → no se puede autorizar de nuevo
  const second = await authorizeSession(sessionId, userId);
  assert.equal(second, null, 'segundo authorize del mismo session debe fallar');
});

test('authorizeSession con sessionId inexistente → null', async () => {
  const userId = await createTestUser('u@test');
  assert.equal(await authorizeSession('sess_no', userId), null);
});

test('authorizeSession con sesión expirada → null', async () => {
  const userId = await createTestUser('uexp@test');
  const sessionId = await createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://x',
    clientName: 'x',
  });
  await db
    .prepare('UPDATE oauth_sessions SET expires_at = ? WHERE session_id = ?')
    .run(Math.floor(Date.now() / 1000) - 1, sessionId);
  assert.equal(await authorizeSession(sessionId, userId), null);
});

// ─── exchangeCodeForToken (PKCE) ───────────────────────────────

test('exchangeCodeForToken: PKCE válido → access_token + expires_in + token_type Bearer', async () => {
  const userId = await createTestUser('pkce@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'mcp-client',
  });
  const code = (await authorizeSession(sessionId, userId))!;

  const result = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in result);
  if ('access_token' in result) {
    assert.match(result.access_token, /^tok_/);
    assert.equal(result.token_type, 'Bearer');
    assert.ok(result.expires_in > 0);
  }
});

test('exchangeCodeForToken: verifier incorrecto → invalid_code_verifier', async () => {
  const userId = await createTestUser('pkce-bad@test');
  const { challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = (await authorizeSession(sessionId, userId))!;

  const wrongVerifier = base64url(randomBytes(32));
  const result = await exchangeCodeForToken(code, wrongVerifier);
  assert.ok('error' in result);
  if ('error' in result) {
    assert.equal(result.error, 'invalid_code_verifier');
  }
});

test('exchangeCodeForToken: code inexistente → invalid_code', async () => {
  const result = await exchangeCodeForToken('code_not_real', 'whatever');
  assert.ok('error' in result);
  if ('error' in result) {
    assert.equal(result.error, 'invalid_code');
  }
});

test('exchangeCodeForToken: sesión sin user_id (no autorizada) → session_not_authorized', async () => {
  // Caso teórico: alguien tiene un code en la DB pero la sesión no fue authorizeSession-ada.
  // No es una vía normal del flow, pero el guardia existe en el código.
  // Forzamos manualmente el escenario.
  const { challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  // Inyectar code sin user_id (no usar authorizeSession que setea ambos)
  await db
    .prepare('UPDATE oauth_sessions SET code = ? WHERE session_id = ?')
    .run('code_orphan', sessionId);

  const result = await exchangeCodeForToken('code_orphan', 'verifier');
  assert.ok('error' in result);
  if ('error' in result) {
    assert.equal(result.error, 'session_not_authorized');
  }
});

test('exchangeCodeForToken: code es de un solo uso (segunda vez → invalid_code)', async () => {
  const userId = await createTestUser('once@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = (await authorizeSession(sessionId, userId))!;

  const first = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in first);

  const second = await exchangeCodeForToken(code, verifier);
  assert.ok('error' in second);
  if ('error' in second) {
    assert.equal(second.error, 'invalid_code');
  }
});

test('exchangeCodeForToken inserta el token en oauth_tokens con expires_at futuro', async () => {
  const userId = await createTestUser('inst@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'mcp',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    const row = (await db.prepare('SELECT * FROM oauth_tokens WHERE token = ?').get(r.access_token)) as
      | { user_id: number; client_name: string; expires_at: number; revoked: number }
      | undefined;
    assert.ok(row);
    assert.equal(row!.user_id, userId);
    assert.equal(row!.client_name, 'mcp');
    assert.equal(row!.revoked, 0);
    assert.ok(row!.expires_at > Math.floor(Date.now() / 1000));
  }
});

// ─── Resource indicator / audience binding (RFC 8707) ──────────

test('exchangeCodeForToken liga el resource de la sesión al token', async () => {
  const userId = await createTestUser('aud@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'https://chatgpt.com/connector/oauth/abc',
    clientName: 'chatgpt',
    clientId: 'client_abc',
    resource: 'https://gw.example.com/mcp',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    const row = (await db
      .prepare('SELECT resource FROM oauth_tokens WHERE token = ?')
      .get(r.access_token)) as { resource: string | null };
    assert.equal(row.resource, 'https://gw.example.com/mcp');
  }
});

test('exchangeCodeForToken sin resource → columna NULL (compat stdio)', async () => {
  const userId = await createTestUser('nores@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://localhost:5000/cb',
    clientName: 'stdio',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    const row = (await db
      .prepare('SELECT resource FROM oauth_tokens WHERE token = ?')
      .get(r.access_token)) as { resource: string | null };
    assert.equal(row.resource, null);
  }
});

// PUBLIC_URL no está seteado en los tests → gatewayOrigin() = http://localhost:8000

test('mcpTokenVerifier: token con resource del mismo origin → AuthInfo OK', async () => {
  const userId = await createTestUser('vok@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'https://chatgpt.com/connector/oauth/x',
    clientName: 'cg',
    clientId: 'c1',
    resource: 'http://localhost:8000/mcp',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    const info = await mcpTokenVerifier.verifyAccessToken(r.access_token);
    assert.equal((info.extra as { userId: number }).userId, userId);
    assert.equal(info.resource?.origin, 'http://localhost:8000');
  }
});

test('mcpTokenVerifier: token con resource de otro origin → InvalidTokenError', async () => {
  const userId = await createTestUser('vbad@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'https://chatgpt.com/connector/oauth/y',
    clientName: 'cg',
    clientId: 'c2',
    resource: 'https://evil.example.com/mcp',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    await assert.rejects(() => mcpTokenVerifier.verifyAccessToken(r.access_token), /audience/i);
  }
});

test('mcpTokenVerifier: token sin resource (stdio/legacy) → OK', async () => {
  const userId = await createTestUser('vnores@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://localhost:5000/cb',
    clientName: 'stdio',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    const info = await mcpTokenVerifier.verifyAccessToken(r.access_token);
    assert.equal((info.extra as { userId: number }).userId, userId);
    assert.equal(info.resource, undefined);
  }
});

// ─── revokeToken ───────────────────────────────────────────────

test('revokeToken pone revoked=1 sin tirar errores', async () => {
  const userId = await createTestUser('rev@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  if ('access_token' in r) {
    await revokeToken(r.access_token);
    const row = (await db
      .prepare('SELECT revoked FROM oauth_tokens WHERE token = ?')
      .get(r.access_token)) as { revoked: number } | undefined;
    assert.equal(row!.revoked, 1);
  }
});

test('revokeToken sobre token inexistente: no-throw', async () => {
  await assert.doesNotReject(() => revokeToken('tok_nonexistent'));
});

// ═══════════════════════════════════════════════════════════════
//   Refresh tokens (OAuth 2.1: rotación + reuso) + DCR dedup/purga
// ═══════════════════════════════════════════════════════════════

async function issuePair(opts?: { resource?: string; clientName?: string }): Promise<{
  userId: number;
  access_token: string;
  refresh_token: string;
}> {
  const userId = await createTestUser(`u-${randomBytes(4).toString('hex')}@test`);
  const { verifier, challenge } = makePkcePair();
  const sessionId = await createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    clientName: opts?.clientName ?? 'Claude',
    ...(opts?.resource ? { clientId: 'c_test', resource: opts.resource } : {}),
  });
  const code = (await authorizeSession(sessionId, userId))!;
  const r = await exchangeCodeForToken(code, verifier);
  if (!('access_token' in r)) throw new Error('expected token pair');
  return { userId, access_token: r.access_token, refresh_token: r.refresh_token };
}

test('exchangeCodeForToken también emite refresh_token (rt_) con familia', async () => {
  const { access_token, refresh_token } = await issuePair();
  assert.match(access_token, /^tok_/);
  assert.match(refresh_token, /^rt_/);
  const row = (await db
    .prepare('SELECT * FROM oauth_refresh_tokens WHERE refresh_token = ?')
    .get(refresh_token)) as {
    revoked: number;
    replaced_by: string | null;
    access_token: string;
    family_id: string;
    expires_at: number;
  };
  assert.ok(row);
  assert.equal(row.revoked, 0);
  assert.equal(row.replaced_by, null);
  assert.equal(row.access_token, access_token);
  assert.ok(row.family_id);
  // refresh ~1 año (> 300 días)
  assert.ok(row.expires_at > Math.floor(Date.now() / 1000) + 300 * 24 * 60 * 60);
});

test('refreshAccessToken rota access+refresh, preserva resource y revoca el access viejo', async () => {
  const { userId, access_token: oldAccess, refresh_token: rt1 } = await issuePair({
    resource: 'http://localhost:8000/mcp',
  });
  const r = await refreshAccessToken(rt1);
  assert.ok('access_token' in r);
  if (!('access_token' in r)) return;
  assert.notEqual(r.access_token, oldAccess);
  assert.notEqual(r.refresh_token, rt1);
  assert.match(r.refresh_token, /^rt_/);

  const old = (await db.prepare('SELECT revoked FROM oauth_tokens WHERE token = ?').get(oldAccess)) as {
    revoked: number;
  };
  assert.equal(old.revoked, 1, 'el access viejo queda revocado tras rotar');

  const r1 = (await db
    .prepare('SELECT replaced_by, family_id FROM oauth_refresh_tokens WHERE refresh_token = ?')
    .get(rt1)) as { replaced_by: string; family_id: string };
  const r2 = (await db
    .prepare('SELECT family_id FROM oauth_refresh_tokens WHERE refresh_token = ?')
    .get(r.refresh_token)) as { family_id: string };
  assert.equal(r1.replaced_by, r.refresh_token);
  assert.equal(r1.family_id, r2.family_id, 'misma familia tras rotación');

  const newRow = (await db
    .prepare('SELECT resource FROM oauth_tokens WHERE token = ?')
    .get(r.access_token)) as { resource: string | null };
  assert.equal(newRow.resource, 'http://localhost:8000/mcp');

  const info = await mcpTokenVerifier.verifyAccessToken(r.access_token);
  assert.equal((info.extra as { userId: number }).userId, userId);
  assert.equal(info.resource?.origin, 'http://localhost:8000');
});

test('refreshAccessToken: reuso de un refresh ya rotado → invalid_grant + quema la familia', async () => {
  const { refresh_token: rt1 } = await issuePair();
  const r = await refreshAccessToken(rt1);
  assert.ok('access_token' in r);
  if (!('access_token' in r)) return;
  const rt2 = r.refresh_token;
  const newAccess = r.access_token;

  // Reusar rt1 (ya rotado) → invalid_grant
  assert.deepEqual(await refreshAccessToken(rt1), { error: 'invalid_grant' });

  // Familia quemada: rt2 revocado e inservible, y su access revocado
  const rt2row = (await db
    .prepare('SELECT revoked FROM oauth_refresh_tokens WHERE refresh_token = ?')
    .get(rt2)) as { revoked: number };
  assert.equal(rt2row.revoked, 1);
  assert.deepEqual(await refreshAccessToken(rt2), { error: 'invalid_grant' });
  const acc = (await db.prepare('SELECT revoked FROM oauth_tokens WHERE token = ?').get(newAccess)) as {
    revoked: number;
  };
  assert.equal(acc.revoked, 1);
});

test('refreshAccessToken: token desconocido → invalid_grant', async () => {
  assert.deepEqual(await refreshAccessToken('rt_nope'), { error: 'invalid_grant' });
});

test('refreshAccessToken: refresh expirado → invalid_grant', async () => {
  const { refresh_token } = await issuePair();
  await db
    .prepare('UPDATE oauth_refresh_tokens SET expires_at = ? WHERE refresh_token = ?')
    .run(Math.floor(Date.now() / 1000) - 1, refresh_token);
  assert.deepEqual(await refreshAccessToken(refresh_token), { error: 'invalid_grant' });
});

test('refreshAccessToken: refresh revocado → invalid_grant', async () => {
  const { refresh_token } = await issuePair();
  await db
    .prepare('UPDATE oauth_refresh_tokens SET revoked = 1 WHERE refresh_token = ?')
    .run(refresh_token);
  assert.deepEqual(await refreshAccessToken(refresh_token), { error: 'invalid_grant' });
});

test('cascada: revokeToken(access) revoca también el refresh', async () => {
  const { access_token, refresh_token } = await issuePair();
  await revokeToken(access_token);
  const rrow = (await db
    .prepare('SELECT revoked FROM oauth_refresh_tokens WHERE refresh_token = ?')
    .get(refresh_token)) as { revoked: number };
  assert.equal(rrow.revoked, 1);
  assert.deepEqual(await refreshAccessToken(refresh_token), { error: 'invalid_grant' });
});

test('cascada: revokeToken(refresh) revoca también el access (RFC 7009)', async () => {
  const { access_token, refresh_token } = await issuePair();
  await revokeToken(refresh_token);
  const arow = (await db.prepare('SELECT revoked FROM oauth_tokens WHERE token = ?').get(access_token)) as {
    revoked: number;
  };
  assert.equal(arow.revoked, 1);
  assert.deepEqual(await refreshAccessToken(refresh_token), { error: 'invalid_grant' });
});

test('cascada: revokeOAuthByPrefix revoca access + refresh', async () => {
  const { userId, access_token, refresh_token } = await issuePair();
  const ok = await revokeOAuthByPrefix(userId, access_token.slice(0, 16));
  assert.equal(ok, true);
  const arow = (await db.prepare('SELECT revoked FROM oauth_tokens WHERE token = ?').get(access_token)) as {
    revoked: number;
  };
  assert.equal(arow.revoked, 1);
  assert.deepEqual(await refreshAccessToken(refresh_token), { error: 'invalid_grant' });
});

test('refreshAccessToken: resource NULL (stdio) se preserva en la renovación', async () => {
  const { refresh_token } = await issuePair(); // sin resource
  const r = await refreshAccessToken(refresh_token);
  assert.ok('access_token' in r);
  if (!('access_token' in r)) return;
  const row = (await db
    .prepare('SELECT resource FROM oauth_tokens WHERE token = ?')
    .get(r.access_token)) as { resource: string | null };
  assert.equal(row.resource, null);
  const info = await mcpTokenVerifier.verifyAccessToken(r.access_token);
  assert.equal(info.resource, undefined);
});

test('DCR dedup: mismo (client_name, redirect_uris) → mismo client_id', async () => {
  const a = await registerOAuthClient({
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  });
  const b = await registerOAuthClient({
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  });
  assert.equal(b.client_id, a.client_id);
  // Insensible a orden y duplicados
  const c = await registerOAuthClient({
    client_name: 'Claude',
    redirect_uris: [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback',
    ],
  });
  assert.equal(c.client_id, a.client_id);
  // Distinto nombre o redirect → distinto client_id
  const d = await registerOAuthClient({
    client_name: 'Otro',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  });
  assert.notEqual(d.client_id, a.client_id);
  const e = await registerOAuthClient({
    client_name: 'Claude',
    redirect_uris: ['https://otro.example/cb'],
  });
  assert.notEqual(e.client_id, a.client_id);
});

test('DCR purga: borra huérfanos > 30d, conserva recientes y con tokens vivos', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - 40 * 24 * 60 * 60;
  const userId = await createTestUser('purge@test');
  // Huérfano viejo sin tokens → debe purgarse
  await db
    .prepare(
      `INSERT INTO oauth_clients (client_id, client_secret, client_name, redirect_uris, grant_types, response_types, scope, token_endpoint_auth_method, created_at)
     VALUES ('client_orphan', NULL, 'OldOrphan', '["https://o/cb"]', NULL, NULL, NULL, 'none', ?)`,
    )
    .run(old);
  // Cliente viejo PERO con token vivo (mismo client_name) → debe conservarse
  await db
    .prepare(
      `INSERT INTO oauth_clients (client_id, client_secret, client_name, redirect_uris, grant_types, response_types, scope, token_endpoint_auth_method, created_at)
     VALUES ('client_live', NULL, 'LiveClient', '["https://l/cb"]', NULL, NULL, NULL, 'none', ?)`,
    )
    .run(old);
  await db
    .prepare(
      `INSERT INTO oauth_tokens (token, user_id, client_name, resource, expires_at, created_at)
     VALUES ('tok_live', ?, 'LiveClient', NULL, ?, ?)`,
    )
    .run(userId, now + 1000, now);

  // Cliente reciente (created_at = now) → no debe purgarse
  const recent = await registerOAuthClient({ client_name: 'Recent', redirect_uris: ['https://r/cb'] });
  // Disparar otra purga con un registro nuevo
  await registerOAuthClient({ client_name: 'Trigger', redirect_uris: ['https://t/cb'] });

  assert.equal(await getOAuthClient('client_orphan'), null);
  assert.ok(await getOAuthClient('client_live'));
  assert.ok(await getOAuthClient(recent.client_id));
});
