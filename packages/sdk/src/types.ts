import type { Keypair, PublicKey } from '@solana/web3.js';

export interface AgentConfig {
  /** Wallet del agente (Solana keypair) */
  wallet: Keypair;
  /** Identificador del servicio: 'yield-hunter', 'translate-en-es', etc. (max 32) */
  service: string;
  /** Precio por llamada en SOL (decimal, ej. 0.01) */
  pricePerCall: number;
  /** Descripción libre para el catálogo (max 512) */
  description?: string;
  /** Endpoint público donde otros agentes llaman al servicio (max 256) */
  endpoint?: string;
  /** RPC de Solana — default: env SOLANA_RPC_URL o devnet */
  rpcUrl?: string;
  /** Program ID del Agent Bazaar registry — default: env PROGRAM_ID */
  programId?: PublicKey | string;
}

export interface ServiceManifest {
  service: string;
  pricePerCall: number;
  description?: string;
  endpoint: string;
  ownerWallet: string;
  acceptedToken: 'SOL' | 'USDC';
}

export interface X402Quote {
  /** Monto en lamports */
  amount: string;
  /** Wallet destino para el pago */
  payTo: string;
  /** Token usado */
  asset: 'SOL' | 'USDC';
  /** Servicio al que aplica este quote */
  service: string;
  /** Nonce u64 — único por solicitud, evita replays */
  nonce: string;
  /** Timestamp de expiración (unix segundos) */
  expiresAt: number;
}

export type ProviderHandler<TRequest = unknown, TResponse = unknown> = (
  request: TRequest,
) => Promise<TResponse>;

export interface CallOptions {
  /** Máximo SOL a pagar (cap de seguridad) */
  maxPrice?: number;
  /** Lista blanca de servicios permitidos */
  allowlist?: string[];
  /** Timeout en ms para todo el ciclo */
  timeoutMs?: number;
}
