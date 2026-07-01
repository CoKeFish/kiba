/**
 * API Keys (long-lived bearer tokens for direct REST access from servers).
 * Distintas de los OAuth tokens (que se emiten vía PKCE flow para MCP clients).
 */
import { randomBytes, createHash } from 'node:crypto';
import { db } from './db';
import { revokeRefreshFamilyForToken } from './oauth';

interface ApiKeyRow {
  id: string;
  user_id: number;
  name: string;
  key_hash: string;
  prefix: string;
  revoked: number;
  last_used_at: number | null;
  created_at: number;
}

function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export async function createApiKey(userId: number, name: string, expiresInDays = 365) {
  const id = `key_${randomBytes(8).toString('hex')}`;
  const rand = randomBytes(24).toString('base64url');
  const secret = `sk_live_${rand}`;
  const prefix = `sk_live_${rand.slice(0, 6)}`;
  const hash = hashKey(secret);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expiresInDays * 24 * 60 * 60;

  await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, name, hash, prefix, now, expiresAt);

  return { id, secret, prefix, name, created_at: now, expires_at: expiresAt };
}

export async function listApiKeys(userId: number) {
  return db
    .prepare(
      `SELECT id, name, prefix, last_used_at, created_at, expires_at
       FROM api_keys
       WHERE user_id = ? AND revoked = 0
       ORDER BY created_at DESC`,
    )
    .all(userId);
}

export async function revokeApiKey(userId: number, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return result.changes > 0;
}

export async function getUserByApiKey(secret: string): Promise<{ id: number } | null> {
  const hash = hashKey(secret);
  const row = (await db
    .prepare('SELECT id, user_id, expires_at FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(hash)) as { id: string; user_id: number; expires_at: number | null } | undefined;
  if (!row) return null;
  if (row.expires_at != null && row.expires_at < Math.floor(Date.now() / 1000)) return null;
  // Update last_used_at (best-effort)
  await db
    .prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), row.id);
  return { id: row.user_id };
}

/**
 * List OAuth-issued tokens (apps connected via PKCE flow — Claude, Cursor, etc).
 * Different from API keys: OAuth tokens come from MCP/external clients.
 */
export async function listOAuthConnections(userId: number) {
  return (await db
    .prepare(
      `SELECT token, client_name, created_at, expires_at
       FROM oauth_tokens
       WHERE user_id = ? AND revoked = 0 AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .all(userId, Math.floor(Date.now() / 1000))) as Array<{
    token: string;
    client_name: string;
    created_at: number;
    expires_at: number;
  }>;
}

export async function revokeOAuthByPrefix(userId: number, idPrefix: string): Promise<boolean> {
  // Use the first 16 chars of the token as the public id surfaced to the dashboard.
  const rows = (await db
    .prepare('SELECT token FROM oauth_tokens WHERE user_id = ? AND revoked = 0')
    .all(userId)) as Array<{ token: string }>;
  const match = rows.find((r) => r.token.startsWith(idPrefix));
  if (!match) return false;
  await db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token = ?').run(match.token);
  // Cascada: el "disconnect" del dashboard también quema la familia de refresh;
  // si no, la conexión podría renovarse de vuelta a la vida con su refresh token.
  await revokeRefreshFamilyForToken(match.token);
  return true;
}

export type { ApiKeyRow };
