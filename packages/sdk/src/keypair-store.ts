/**
 * Persist Stellar keypairs to disk.
 *
 * Each agent has its own wallet. To survive container restarts and keep its on-chain
 * registration, we persist the key seed. New keypairs are stored as the 32-byte
 * ed25519 seed; legacy 64-byte secretKeys (Solana-style) and `S...` secrets are also
 * accepted on load. The Stellar `G...` address derives from the first 32 bytes, so a
 * legacy file keeps the exact same address.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) {
    return parseKeypair(readFileSync(path, 'utf8'));
  }
  const kp = Keypair.random();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.rawSecretKey())), { mode: 0o600 });
  return kp;
}

/**
 * Load a keypair from env (a JSON array of bytes, or an `S...` secret) if set, else
 * fall back to a file on disk. For ephemeral hosting (Railway/Fly) without a volume.
 */
export function loadKeypairFromEnvOrFile(envName: string, path: string): Keypair {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return parseKeypair(fromEnv);
  return loadOrCreateKeypair(path);
}

function parseKeypair(raw: string): Keypair {
  const trimmed = raw.trim();
  // `S...` Stellar secret string (a JSON byte array starts with '[').
  if (trimmed[0] === 'S') {
    return Keypair.fromSecret(trimmed);
  }
  // JSON byte array: 32-byte seed or 64-byte ed25519 secretKey (first 32 = seed).
  const arr = JSON.parse(trimmed) as number[];
  return Keypair.fromRawEd25519Seed(Buffer.from(arr.slice(0, 32)));
}
