/**
 * @kiba/sdk
 *
 * SDK público para integrar agentes IA al marketplace Kiba.
 *
 * APIs:
 *   - AgentProvider: para agentes que OFRECEN un servicio (handshake x402)
 *   - AgentClient:   para agentes que CONSUMEN un servicio (descubrimiento + pago automático)
 */

export { AgentProvider } from './provider';
export { AgentClient } from './client';
export type { X402Step, X402Trace } from './client';
export type {
  AgentConfig,
  ServiceManifest,
  X402Quote,
  ProviderHandler,
  CallOptions,
} from './types';
export { PLATFORM_FEE_BPS, BPS_DENOMINATOR, computeFeeSplit } from './fees';
export { loadOrCreateKeypair, loadKeypairFromEnvOrFile } from './keypair-store';

// Abstracción de cadena: la interfaz ChainClient y su factory. AgentClient y
// AgentProvider operan la blockchain solo a través de esto. Para sumar una nueva
// cadena (ej. Stellar), se implementa ChainClient y se enruta en createChainClient.
export { createChainClient, StellarChainClient } from './chain';
export type {
  ChainClient,
  ChainAgentInfo,
  ChainEscrowInfo,
  RegisterAgentArgs,
  UpdateAgentArgs,
  OpenEscrowArgs,
  FetchEscrowArgs,
  ClaimPaymentArgs,
  StellarChainClientConfig,
} from './chain';
export type { ChainClientConfig } from './chain/index';
