/**
 * Cliente mínimo de Privy (server wallets) para Stellar.
 *
 * Sustituye las custodiales de usuario (secret en la DB) por wallets de Privy: la
 * clave ed25519 vive en el TEE de Privy y NUNCA toca la DB de Kiba. El gateway
 * crea la wallet (`chain_type: stellar` → dirección G...) y firma transacciones
 * Stellar vía `raw_sign` (ed25519 sobre `tx.hash()`), autenticado con el app-secret.
 *
 * Verificado contra la API viva: `raw_sign` devuelve una firma que
 * `Keypair.verify(tx.hash(), sig)` de Stellar acepta (spike #1).
 *
 * Las wallets salen con `owner_id: null` (app-owned) → firmables con el app-secret.
 * Endurecimiento opcional (follow-up): owner + authorization key + policies de gasto.
 */
import { Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
import type { StellarSigner } from '@kiba/sdk';

const APP_ID = process.env.PRIVY_APP_ID ?? '';
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? '';
const API_URL = (process.env.PRIVY_API_URL ?? 'https://api.privy.io/v1').replace(/\/+$/, '');

/** true si hay credenciales de Privy configuradas. */
export function privyEnabled(): boolean {
  return Boolean(APP_ID && APP_SECRET);
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64'),
    'privy-app-id': APP_ID,
    'Content-Type': 'application/json',
  };
}

export interface PrivyWallet {
  walletId: string;
  /** Dirección Stellar (G...). */
  address: string;
}

/** Crea una server wallet Stellar (app-owned). Devuelve walletId + dirección G. */
export async function createStellarWallet(): Promise<PrivyWallet> {
  const res = await fetch(`${API_URL}/wallets`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ chain_type: 'stellar' }),
  });
  if (!res.ok) {
    throw new Error(`[privy] createWallet ${res.status}: ${await res.text()}`);
  }
  const w = (await res.json()) as { id: string; address: string };
  return { walletId: w.id, address: w.address };
}

/** Firma un hash (32 bytes) con la clave de la wallet vía raw_sign. Devuelve la firma ed25519. */
export async function rawSign(walletId: string, hash: Buffer): Promise<Buffer> {
  const res = await fetch(`${API_URL}/wallets/${walletId}/raw_sign`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ params: { hash: '0x' + hash.toString('hex') } }),
  });
  if (!res.ok) {
    throw new Error(`[privy] rawSign ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: { signature?: string } };
  const sigHex = String(body.data?.signature ?? '').replace(/^0x/, '');
  if (!sigHex) throw new Error('[privy] rawSign: respuesta sin signature');
  return Buffer.from(sigHex, 'hex');
}

/**
 * StellarSigner respaldado por una wallet de Privy. Firma remoto: pide a Privy la
 * firma ed25519 de `tx.hash()` y la adjunta con `addSignature`. La clave nunca
 * sale del TEE de Privy.
 */
export class PrivyStellarSigner implements StellarSigner {
  constructor(
    private readonly walletId: string,
    private readonly address: string,
  ) {}

  publicKey(): string {
    return this.address;
  }

  async signTransaction(tx: Transaction | FeeBumpTransaction): Promise<void> {
    const sig = await rawSign(this.walletId, tx.hash());
    tx.addSignature(this.address, sig.toString('base64'));
  }
}
