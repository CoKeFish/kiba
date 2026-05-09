/**
 * API Keys (long-lived bearer tokens for direct REST access from servers).
 * Distintas de los OAuth tokens (que se emiten vía PKCE flow para MCP clients).
 */
import { randomBytes, createHash } from 'node:crypto';
import { db } from './db';

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

export function createApiKey(userId: number, name: string) {
  const id = `key_${randomBytes(8).toString('hex')}`;
  const rand = randomBytes(24).toString('base64url');
  const secret = `sk_live_${rand}`;
  const prefix = `sk_live_${rand.slice(0, 6)}`;
  const hash = hashKey(secret);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, name, hash, prefix, now);

  return { id, secret, prefix, name, created_at: now };
}

export function listApiKeys(userId: number) {
  return db
    .prepare(
      `SELECT id, name, prefix, last_used_at, created_at
       FROM api_keys
       WHERE user_id = ? AND revoked = 0
       ORDER BY created_at DESC`,
    )
    .all(userId);
}

export function revokeApiKey(userId: number, id: string): boolean {
  const result = db
    .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return result.changes > 0;
}

export function getUserByApiKey(secret: string): { id: number } | null {
  const hash = hashKey(secret);
  const row = db
    .prepare('SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(hash) as { id: string; user_id: number } | undefined;
  if (!row) return null;
  // Update last_used_at (best-effort, async-style)
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(
    Math.floor(Date.now() / 1000),
    row.id,
  );
  return { id: row.user_id };
}

/**
 * List OAuth-issued tokens (apps connected via PKCE flow — Claude, Cursor, etc).
 * Different from API keys: OAuth tokens come from MCP/external clients.
 */
export function listOAuthConnections(userId: number) {
  return db
    .prepare(
      `SELECT token, client_name, created_at, expires_at
       FROM oauth_tokens
       WHERE user_id = ? AND revoked = 0 AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .all(userId, Math.floor(Date.now() / 1000)) as Array<{
    token: string;
    client_name: string;
    created_at: number;
    expires_at: number;
  }>;
}

export function revokeOAuthByPrefix(userId: number, idPrefix: string): boolean {
  // Use the first 16 chars of the token as the public id surfaced to the dashboard.
  const rows = db
    .prepare('SELECT token FROM oauth_tokens WHERE user_id = ? AND revoked = 0')
    .all(userId) as Array<{ token: string }>;
  const match = rows.find((r) => r.token.startsWith(idPrefix));
  if (!match) return false;
  db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token = ?').run(match.token);
  return true;
}

export type { ApiKeyRow };
