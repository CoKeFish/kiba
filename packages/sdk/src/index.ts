/**
 * @agent-bazaar/sdk
 *
 * SDK público para integrar agentes IA al marketplace Agent Bazaar.
 *
 * APIs:
 *   - AgentProvider: para agentes que OFRECEN un servicio (handshake x402)
 *   - AgentClient:   para agentes que CONSUMEN un servicio (descubrimiento + pago automático)
 *   - AgentBazaarProgram: cliente low-level del programa Anchor (PDAs, instr builders)
 */

export { AgentProvider } from './provider';
export { AgentClient } from './client';
export type { X402Step, X402Trace } from './client';
export { AgentBazaarProgram } from './program';
export type {
  AgentConfig,
  ServiceManifest,
  X402Quote,
  ProviderHandler,
  CallOptions,
} from './types';
export type { AgentAccount, EscrowAccount, EscrowState } from './anchor-helpers';
export {
  getAgentPda,
  getEscrowPda,
  PLATFORM_FEE_BPS,
  PLATFORM_TREASURY,
  BPS_DENOMINATOR,
  computeFeeSplit,
} from './anchor-helpers';
export { loadOrCreateKeypair, loadKeypairFromEnvOrFile } from './keypair-store';
