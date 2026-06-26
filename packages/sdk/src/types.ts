import type { Keypair } from '@solana/web3.js';

export interface AgentConfig {
  /** Wallet del agente (Solana keypair) */
  wallet: Keypair;
  /** Identificador del servicio: 'yield-hunter', 'translate-en-es', etc. (max 32) */
  service: string;
  /**
   * Precio base por llamada en SOL (decimal, ej. 0.01).
   * - Si NO se define `priceFn`: cada call cobra exactamente este monto (modelo flat).
   * - Si se define `priceFn`: este es el FLOOR mínimo on-chain. El agente puede cobrar
   *   más pero nunca menos (el contrato rechaza con AmountBelowPrice).
   */
  pricePerCall: number;
  /**
   * Función opcional para pricing dinámico.
   *
   * Recibe el payload de la request y devuelve cuántos SOL cobrar por ESTA llamada
   * específica. Permite cobrar según complejidad/tamaño/tipo de la operación
   * — ej. translator cobra por chars, code-reviewer por líneas, etc.
   *
   * El precio devuelto se eleva automáticamente al floor (`pricePerCall`) si fuera menor.
   * Ejemplo:
   *   priceFn: (req) => 0.001 + (req?.text?.length ?? 0) * 0.00001
   */
  priceFn?: (request: unknown) => number | Promise<number>;
  /**
   * Descripción humana opcional del modelo de pricing — solo informativa, va en
   * el manifest. Útil para que el cliente entienda cómo se cobra.
   * Ej. "Charges 0.00001 SOL per character translated."
   */
  pricingNote?: string;
  /** Descripción libre para el catálogo (max 512) */
  description?: string;
  /** Endpoint público donde otros agentes llaman al servicio (max 256) */
  endpoint?: string;
  /** RPC override (opcional). En Stellar el cliente usa STELLAR_RPC_URL del entorno. */
  rpcUrl?: string;
}

export interface ServiceManifest {
  service: string;
  /** Precio base / floor en SOL. El precio efectivo de una call puede ser >= esto. */
  pricePerCall: number;
  /** Si true, el agente computa el precio per-request → la quote del 402 manda. */
  dynamicPricing?: boolean;
  /** Descripción humana del modelo de pricing (cuando dynamicPricing=true) */
  pricingNote?: string;
  description?: string;
  endpoint: string;
  ownerWallet: string;
  acceptedToken: 'SOL' | 'USDC' | 'XLM';
}

export interface X402Quote {
  /** Monto en lamports */
  amount: string;
  /** Wallet destino para el pago */
  payTo: string;
  /** Token usado */
  asset: 'SOL' | 'USDC' | 'XLM';
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
