/**
 * Helper para persistir keypairs en disco.
 *
 * Cada agente/orchestrator tiene su propia wallet. Para que sobrevivan a restarts del
 * container y mantengan su registro on-chain, persistimos el secret key en /app/data.
 */
import { Keypair } from '@solana/web3.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    const arr = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const kp = Keypair.generate();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

/**
 * Carga keypair desde env (JSON array de 64 bytes) si está seteada, o cae a
 * archivo en disco. Para hosting efímero (Railway/Fly) sin volumen persistente.
 */
export function loadKeypairFromEnvOrFile(envName: string, path: string): Keypair {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    const arr = JSON.parse(fromEnv) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return loadOrCreateKeypair(path);
}
