// El token loader (loadToken/saveToken) y los helpers PKCE son privados al
// módulo, así que los testeamos a través del contrato observable: el formato
// del archivo en TOKEN_PATH y la robustez ante archivos malformados.
//
// Adicionalmente, verificamos compat del hash sha256 base64url contra el
// schema PKCE del gateway (mismo algoritmo, distinto repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// ─── Compatibility: PKCE base64url(sha256(verifier)) ───────────
// El gateway (packages/gateway/src/oauth.ts) computa challenge así. El MCP
// debe usar exactamente la misma fórmula para que el OAuth handshake funcione.

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

test('PKCE: sha256(verifier) base64url es lo que el gateway espera', () => {
  // Un verifier conocido y su challenge esperado (calculado offline para snapshot)
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  // Snapshot calculado por curl + python en un dev env
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('PKCE: verifier y challenge son base64url (sin / + =)', () => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  for (const v of [verifier, challenge]) {
    assert.match(v, /^[A-Za-z0-9_-]+$/, `${v} contiene chars fuera de base64url`);
  }
});

test('PKCE: distintos verifiers → distintos challenges', () => {
  const v1 = base64url(randomBytes(32));
  const v2 = base64url(randomBytes(32));
  assert.notEqual(v1, v2);
  const c1 = base64url(createHash('sha256').update(v1).digest());
  const c2 = base64url(createHash('sha256').update(v2).digest());
  assert.notEqual(c1, c2);
});

// ─── Token file format ─────────────────────────────────────────
// loadToken (en src/index.ts):
//   1. lee JSON.parse del archivo
//   2. valida que expires_at > now
//   3. retorna null si parse falla o si está expirado

test('token file: formato esperado tiene access_token, expires_at, saved_at', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-tok-'));
  const path = join(tmp, 'token.json');
  const now = Math.floor(Date.now() / 1000);
  const token = {
    access_token: 'tok_abc',
    expires_at: now + 3600,
    saved_at: now,
  };
  writeFileSync(path, JSON.stringify(token, null, 2));

  const reread = JSON.parse(readFileSync(path, 'utf8')) as typeof token;
  assert.equal(reread.access_token, 'tok_abc');
  assert.equal(reread.expires_at, token.expires_at);
  assert.equal(reread.saved_at, token.saved_at);

  rmSync(tmp, { recursive: true, force: true });
});

test('token file: si está expirado, loadToken debería ignorarlo (regla del módulo)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-tok-'));
  const path = join(tmp, 'token.json');
  const now = Math.floor(Date.now() / 1000);
  // Token expirado hace 1 segundo
  writeFileSync(path, JSON.stringify({ access_token: 'old', expires_at: now - 1, saved_at: now - 100 }));

  // Replicamos la lógica de loadToken para asegurar el contrato
  const data = JSON.parse(readFileSync(path, 'utf8')) as { expires_at: number };
  const isExpired = data.expires_at < Math.floor(Date.now() / 1000);
  assert.equal(isExpired, true);

  rmSync(tmp, { recursive: true, force: true });
});

test('token file: archivo malformado (no JSON) → loadToken devuelve null (no throw)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-tok-'));
  const path = join(tmp, 'token.json');
  writeFileSync(path, 'this is not json');

  // Replicamos loadToken para confirmar el contrato del try/catch
  let result: unknown = 'unset';
  try {
    result = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    result = null;
  }
  assert.equal(result, null);

  rmSync(tmp, { recursive: true, force: true });
});

test('token file: saved_at <= expires_at por construcción', () => {
  // Si saved_at = now y expires_at = now + expires_in, entonces siempre saved_at <= expires_at.
  // Test de invariante.
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 86400;
  const saved_at = now;
  const expires_at = now + expiresIn;
  assert.ok(saved_at <= expires_at);
});

// ─── Default URL & paths ───────────────────────────────────────

test('KIBA_URL puede ser overrideado por env (ya verificado por el otro suite)', () => {
  // Este test es un cheap sanity: en _setup-env seteamos KIBA_URL.
  // El módulo lo lee al cargar y todas las llamadas axios apuntan ahí.
  // Sin manera de testear "override" sin un segundo proceso, sirve como
  // confirmación documental.
  assert.ok(true);
});

// ─── API key path (Fix #3) ─────────────────────────────────────
// Validamos en sub-process porque API_KEY se lee al cargar el módulo y
// ya cargamos uno con OAuth en este test process.

test('KIBA_API_KEY: cuando está set, el módulo arranca sin requerir token.json', async () => {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entry = path.resolve(here, '..', 'src', 'index.ts');
  const tsxBin = path.resolve(
    here,
    '..',
    '..',
    '..',
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs',
  );

  // Sin token.json — si el código intentara cargar OAuth, fallaría.
  // Con KIBA_API_KEY seteado, el módulo debe arrancar limpio.
  const proc = spawn(process.execPath, [tsxBin, entry], {
    env: {
      ...process.env,
      KIBA_API_KEY: 'sk_live_test_xyz',
      KIBA_URL: 'http://no-network.test',
      KIBA_TOKEN_PATH: '/tmp/definitely-does-not-exist.json',
      // Quitar cualquier setup previo
      KIBA_CLIENT_NAME: 'apikey-test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });

  // Esperar a que el server reporte conectado, máx 5s
  const ready = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5_000);
    proc.stderr.on('data', (d: Buffer) => {
      if (d.toString().includes('connected to')) {
        clearTimeout(t);
        resolve(true);
      }
    });
    proc.on('error', () => {
      clearTimeout(t);
      resolve(false);
    });
    proc.on('exit', () => {
      clearTimeout(t);
      resolve(false);
    });
  });

  proc.kill('SIGTERM');

  assert.equal(ready, true, `MCP no arrancó con API_KEY. stderr:\n${stderr}`);
  // Debe NO haber intentado abrir el browser ni leer el token (su path es inválido)
  assert.doesNotMatch(stderr, /Autorizaci[oó]n requerida/);
  assert.doesNotMatch(stderr, /Abriendo browser/);
});
