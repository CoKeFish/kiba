/**
 * StellarSigner — abstrae QUIÉN firma una transacción Stellar.
 *
 * Desacopla la firma del Keypair local: el SDK deja de asumir que tiene la clave
 * privada en memoria. Dos implementaciones:
 *  - LocalKeypairSigner: firma con un Keypair en proceso (treasury, agentes y el
 *    camino de back-compat de createChainClient).
 *  - (en el gateway) PrivyStellarSigner: firma remoto vía la API de Privy
 *    (raw_sign); la clave vive en el TEE de Privy y nunca toca el proceso de Kiba.
 *
 * Modelo de firma de Stellar: la firma es ed25519 sobre `tx.hash()`. LocalKeypairSigner
 * usa `tx.sign(keypair)`; un firmante remoto firma `tx.hash()` y añade el resultado con
 * `tx.addSignature(publicKey, signatureBase64)`.
 */
import { type Keypair, type Transaction, type FeeBumpTransaction } from '@stellar/stellar-sdk';

export interface StellarSigner {
  /** Dirección Stellar (G...) de quien firma. */
  publicKey(): string;
  /** Firma la transacción en sitio (añade su DecoratedSignature). */
  signTransaction(tx: Transaction | FeeBumpTransaction): Promise<void>;
}

/** Firma con un Keypair en proceso (la clave vive en memoria del SDK). */
export class LocalKeypairSigner implements StellarSigner {
  constructor(private readonly keypair: Keypair) {}

  publicKey(): string {
    return this.keypair.publicKey();
  }

  async signTransaction(tx: Transaction | FeeBumpTransaction): Promise<void> {
    tx.sign(this.keypair);
  }
}
