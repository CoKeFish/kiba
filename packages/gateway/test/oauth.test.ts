import { TEST_TMP_DIR } from './_setup-env';

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import {
  createOAuthSession,
  getOAuthSession,
  authorizeSession,
  exchangeCodeForToken,
  revokeToken,
} from '../src/oauth';
import { db } from '../src/db';

after(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makePkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createTestUser(email: string): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, custodial_wallet_secret, custodial_wallet_pubkey, balance_lamports, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(email, 'fake', '[]', `pk-${email}`, 0, now);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  db.exec('DELETE FROM oauth_tokens; DELETE FROM oauth_sessions; DELETE FROM users;');
});

// ─── createOAuthSession + getOAuthSession ──────────────────────

test('createOAuthSession devuelve sessionId con prefijo "sess_"', () => {
  const sessionId = createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://localhost:3000/cb',
    clientName: 'test-client',
  });
  assert.match(sessionId, /^sess_/);
});

test('getOAuthSession recupera la fila recién creada con campos correctos', () => {
  const sessionId = createOAuthSession({
    codeChallenge: 'cc-xyz',
    redirectUri: 'http://localhost:9999/cb',
    clientName: 'cliente-x',
  });
  const got = getOAuthSession(sessionId);
  assert.ok(got);
  assert.equal(got!.code_challenge, 'cc-xyz');
  assert.equal(got!.redirect_uri, 'http://localhost:9999/cb');
  assert.equal(got!.client_name, 'cliente-x');
  assert.equal(got!.consumed, 0);
  assert.equal(got!.code, null);
  assert.ok(got!.expires_at > Math.floor(Date.now() / 1000));
});

test('getOAuthSession con sessionId inexistente → null', () => {
  assert.equal(getOAuthSession('sess_nonexistent'), null);
});

test('getOAuthSession con sesión expirada → null', () => {
  const sessionId = createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://x',
    clientName: 'x',
  });
  // Forzar expiración
  db.prepare('UPDATE oauth_sessions SET expires_at = ? WHERE session_id = ?').run(
    Math.floor(Date.now() / 1000) - 1,
    sessionId,
  );
  assert.equal(getOAuthSession(sessionId), null);
});

// ─── authorizeSession ──────────────────────────────────────────

test('authorizeSession devuelve code y marca consumed=1', () => {
  const userId = createTestUser('u1@test');
  const sessionId = createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = authorizeSession(sessionId, userId);
  assert.ok(code);
  assert.match(code!, /^code_/);
  // Ahora la sesión está consumed → no se puede autorizar de nuevo
  const second = authorizeSession(sessionId, userId);
  assert.equal(second, null, 'segundo authorize del mismo session debe fallar');
});

test('authorizeSession con sessionId inexistente → null', () => {
  const userId = createTestUser('u@test');
  assert.equal(authorizeSession('sess_no', userId), null);
});

test('authorizeSession con sesión expirada → null', () => {
  const userId = createTestUser('uexp@test');
  const sessionId = createOAuthSession({
    codeChallenge: 'cc',
    redirectUri: 'http://x',
    clientName: 'x',
  });
  db.prepare('UPDATE oauth_sessions SET expires_at = ? WHERE session_id = ?').run(
    Math.floor(Date.now() / 1000) - 1,
    sessionId,
  );
  assert.equal(authorizeSession(sessionId, userId), null);
});

// ─── exchangeCodeForToken (PKCE) ───────────────────────────────

test('exchangeCodeForToken: PKCE válido → access_token + expires_in + token_type Bearer', () => {
  const userId = createTestUser('pkce@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'mcp-client',
  });
  const code = authorizeSession(sessionId, userId)!;

  const result = exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in result);
  if ('access_token' in result) {
    assert.match(result.access_token, /^tok_/);
    assert.equal(result.token_type, 'Bearer');
    assert.ok(result.expires_in > 0);
  }
});

test('exchangeCodeForToken: verifier incorrecto → invalid_code_verifier', () => {
  const userId = createTestUser('pkce-bad@test');
  const { challenge } = makePkcePair();
  const sessionId = createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = authorizeSession(sessionId, userId)!;

  const wrongVerifier = base64url(randomBytes(32));
  const result = exchangeCodeForToken(code, wrongVerifier);
  assert.ok('error' in result);
  if ('error' in result) {
    assert.equal(result.error, 'invalid_code_verifier');
  }
});

test('exchangeCodeForToken: code inexistente → invalid_code', () => {
  const result = exchangeCodeForToken('code_not_real', 'whatever');
  assert.ok('error' in result);
  if ('error' in result) {
    assert.equal(result.error, 'invalid_code');
  }
});

test('exchangeCodeForToken: sesión sin user_id (no autorizada) → session_not_authorized', () => {
  // Caso teórico: alguien tiene un code en la DB pero la sesión no fue authorizeSession-ada.
  // No es una vía normal del flow, pero el guardia existe en el código.
  // Forzamos manualmente el escenario.
  const { challenge } = makePkcePair();
  const sessionId = createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  // Inyectar code sin user_id (no usar authorizeSession que setea ambos)
  db.prepare(
    'UPDATE oauth_sessions SET code = ? WHERE session_id = ?',
  ).run('code_orphan', sessionId);

  const result = exchangeCodeForToken('code_orphan', 'verifier');
  assert.ok('error' in result);
  if ('error' in result) {
    assert.equal(result.error, 'session_not_authorized');
  }
});

test('exchangeCodeForToken: code es de un solo uso (segunda vez → invalid_code)', () => {
  const userId = createTestUser('once@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = authorizeSession(sessionId, userId)!;

  const first = exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in first);

  const second = exchangeCodeForToken(code, verifier);
  assert.ok('error' in second);
  if ('error' in second) {
    assert.equal(second.error, 'invalid_code');
  }
});

test('exchangeCodeForToken inserta el token en oauth_tokens con expires_at futuro', () => {
  const userId = createTestUser('inst@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'mcp',
  });
  const code = authorizeSession(sessionId, userId)!;
  const r = exchangeCodeForToken(code, verifier);
  assert.ok('access_token' in r);
  if ('access_token' in r) {
    const row = db.prepare('SELECT * FROM oauth_tokens WHERE token = ?').get(r.access_token) as
      | { user_id: number; client_name: string; expires_at: number; revoked: number }
      | undefined;
    assert.ok(row);
    assert.equal(row!.user_id, userId);
    assert.equal(row!.client_name, 'mcp');
    assert.equal(row!.revoked, 0);
    assert.ok(row!.expires_at > Math.floor(Date.now() / 1000));
  }
});

// ─── revokeToken ───────────────────────────────────────────────

test('revokeToken pone revoked=1 sin tirar errores', () => {
  const userId = createTestUser('rev@test');
  const { verifier, challenge } = makePkcePair();
  const sessionId = createOAuthSession({
    codeChallenge: challenge,
    redirectUri: 'http://x',
    clientName: 'x',
  });
  const code = authorizeSession(sessionId, userId)!;
  const r = exchangeCodeForToken(code, verifier);
  if ('access_token' in r) {
    revokeToken(r.access_token);
    const row = db.prepare('SELECT revoked FROM oauth_tokens WHERE token = ?').get(r.access_token) as
      | { revoked: number }
      | undefined;
    assert.equal(row!.revoked, 1);
  }
});

test('revokeToken sobre token inexistente: no-throw', () => {
  assert.doesNotThrow(() => revokeToken('tok_nonexistent'));
});
