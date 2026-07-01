import { TRUNCATE_SQL } from './_setup-env';

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  signJwt,
  verifyJwt,
  newRandomId,
  createUser,
  authenticate,
  getUser,
  getUserByToken,
} from '../src/auth';
import { usdToLamports } from '../src/billing';
import { db, initDb, pool } from '../src/db';

before(async () => {
  await initDb();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.exec(TRUNCATE_SQL);
});

// ─── newRandomId ───────────────────────────────────────────────

test('newRandomId tiene el prefijo solicitado', () => {
  const id = newRandomId('sess', 16);
  assert.match(id, /^sess_/);
});

test('newRandomId default 24 bytes produce 32 chars base64url después del prefijo', () => {
  const id = newRandomId('tok');
  // 24 bytes base64url → 32 chars (sin padding)
  const tail = id.replace(/^tok_/, '');
  assert.equal(tail.length, 32);
});

test('newRandomId genera IDs únicos', () => {
  const set = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    set.add(newRandomId('x', 8));
  }
  assert.equal(set.size, 1000, 'todos los IDs deben ser únicos');
});

test('newRandomId solo usa charset base64url (A-Za-z0-9_-)', () => {
  const id = newRandomId('p', 16);
  const tail = id.replace(/^p_/, '');
  assert.match(tail, /^[A-Za-z0-9_-]+$/);
});

// ─── signJwt / verifyJwt ───────────────────────────────────────

test('signJwt produce 3 partes separadas por punto', () => {
  const tok = signJwt({ id: 1, email: 'a@b' });
  assert.equal(tok.split('.').length, 3);
});

test('verifyJwt acepta su propio token y devuelve el payload', () => {
  const tok = signJwt({ id: 42, email: 'me@test' });
  const payload = verifyJwt<{ id: number; email: string }>(tok);
  assert.ok(payload);
  assert.equal(payload!.id, 42);
  assert.equal(payload!.email, 'me@test');
});

test('verifyJwt rechaza token con firma manipulada', () => {
  const tok = signJwt({ id: 1 });
  const tampered = tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A');
  assert.equal(verifyJwt(tampered), null);
});

test('verifyJwt rechaza token con menos de 3 partes', () => {
  assert.equal(verifyJwt('foo.bar'), null);
  assert.equal(verifyJwt('not-a-jwt'), null);
});

test('verifyJwt rechaza token expirado', () => {
  const tok = signJwt({ id: 1 }, -1); // ttl negativo → exp en el pasado
  assert.equal(verifyJwt(tok), null);
});

test('verifyJwt incluye iat y exp en el payload', () => {
  const before = Math.floor(Date.now() / 1000);
  const tok = signJwt({ id: 1 }, 60);
  const payload = verifyJwt<{ iat: number; exp: number }>(tok);
  assert.ok(payload);
  assert.ok(payload!.iat >= before);
  assert.ok(payload!.exp >= payload!.iat + 60);
});

// ─── createUser / authenticate ─────────────────────────────────

test('createUser inserta usuario y le da bono inicial $5', async () => {
  const result = await createUser('new@test.com', 'password123');
  assert.ok(!('error' in result));
  if (!('error' in result)) {
    assert.equal(result.email, 'new@test.com');
    // Bono de signup: $5 convertidos a unidades base de la cadena activa.
    assert.equal(result.balance_lamports, usdToLamports(5));
    // Tiene wallet custodial
    assert.ok(result.custodial_wallet_pubkey);
    assert.ok(result.custodial_wallet_secret);
    // Hash de password no es el plaintext
    assert.notEqual(result.password_hash, 'password123');
  }
});

test('createUser registra una transacción de bono "signup-bonus"', async () => {
  const result = await createUser('bonus@test.com', 'password123');
  if (!('error' in result)) {
    const txs = (await db
      .prepare('SELECT * FROM transactions WHERE user_id = ?')
      .all(result.id)) as Array<{ type: string; service: string; amount_lamports: number }>;
    assert.equal(txs.length, 1);
    assert.equal(txs[0].type, 'topup');
    assert.equal(txs[0].service, 'signup-bonus');
    assert.equal(txs[0].amount_lamports, usdToLamports(5));
  }
});

test('createUser con email duplicado → error', async () => {
  await createUser('dup@test.com', 'password1');
  const second = await createUser('dup@test.com', 'password2');
  assert.ok('error' in second);
  if ('error' in second) {
    assert.match(second.error, /registrado/i);
  }
});

test('authenticate con password correcta → user', async () => {
  const created = await createUser('auth@test.com', 'mypass');
  if (!('error' in created)) {
    const user = await authenticate('auth@test.com', 'mypass');
    assert.ok(user);
    assert.equal(user!.id, created.id);
  }
});

test('authenticate con password incorrecta → null', async () => {
  await createUser('bad@test.com', 'rightpass');
  assert.equal(await authenticate('bad@test.com', 'wrongpass'), null);
});

test('authenticate con email inexistente → null', async () => {
  assert.equal(await authenticate('nobody@test.com', 'x'), null);
});

// ─── getUser ───────────────────────────────────────────────────

test('getUser por id existente', async () => {
  const created = await createUser('lookup@test.com', 'pass1');
  if (!('error' in created)) {
    const u = await getUser(created.id);
    assert.ok(u);
    assert.equal(u!.email, 'lookup@test.com');
  }
});

test('getUser por id inexistente → null', async () => {
  assert.equal(await getUser(99999), null);
});

// ─── getUserByToken ────────────────────────────────────────────

test('getUserByToken con token válido en oauth_tokens → user', async () => {
  const created = await createUser('tok@test.com', 'pass1');
  if (!('error' in created)) {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO oauth_tokens (token, user_id, client_name, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run('tok_abc', created.id, 'mcp', now + 3600, now);

    const u = await getUserByToken('tok_abc');
    assert.ok(u);
    assert.equal(u!.id, created.id);
  }
});

test('getUserByToken con token expirado → null', async () => {
  const created = await createUser('exp@test.com', 'pass1');
  if (!('error' in created)) {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO oauth_tokens (token, user_id, client_name, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run('tok_old', created.id, 'mcp', now - 1, now - 100);
    assert.equal(await getUserByToken('tok_old'), null);
  }
});

test('getUserByToken con token revocado → null', async () => {
  const created = await createUser('rev@test.com', 'pass1');
  if (!('error' in created)) {
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO oauth_tokens (token, user_id, client_name, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .run('tok_rev', created.id, 'mcp', now + 3600, now);
    assert.equal(await getUserByToken('tok_rev'), null);
  }
});

test('getUserByToken con token inexistente → null', async () => {
  assert.equal(await getUserByToken('tok_unknown'), null);
});
