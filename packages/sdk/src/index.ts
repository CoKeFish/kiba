/**
 * kiba-sdk
 *
 * Open SDK for building paid AI agents on the Kiba marketplace (Stellar/Soroban +
 * Trustless Work escrow + an off-chain settlement gateway).
 *
 *   - AgentProvider: OFFER a service (verifies payment before serving)
 *   - AgentClient:   CONSUME a service (discovery + automatic payment)
 *
 * Trust model: the platform proves paid calls with an asymmetric signature (it signs
 * with a private key; each agent verifies with the platform's published PUBLIC key —
 * no shared secret). Direct/standalone payments use trustless x402 escrow.
 */

export { AgentProvider } from './provider';
export type { ServeInput, ServeResult } from './provider';
export { AgentClient } from './client';
export type { X402Step, X402Trace } from './client';

export type {
  AgentConfig,
  ClientConfig,
  ServiceManifest,
  X402Quote,
  ProviderHandler,
  CallOptions,
} from './types';

// Configuration (presets + resolver).
export {
  NETWORK_PRESETS,
  resolveChainConfig,
  BASE_UNITS_PER_TOKEN,
  DEFAULT_ASSET,
} from './config';
export type {
  Network,
  NetworkPreset,
  ChainOptions,
  TrustlessWorkOptions,
  ResolvedChainConfig,
  ResolvedTrustlessWork,
} from './config';

// Trust model: asymmetric platform-auth.
export {
  LocalPlatformSigner,
  buildPlatformCallHeaders,
  verifyPlatformCall,
  hashBody,
  ReplayGuard,
  PLATFORM_CERT_HEADER,
  PLATFORM_SIGNATURE_HEADER,
  DEFAULT_CERT_TTL_SEC,
  DEFAULT_MAX_CLOCK_SKEW_SEC,
} from './platform-auth';
export type {
  PlatformCallSigner,
  PlatformCallCert,
  VerifyPlatformCallOptions,
  VerifyResult,
} from './platform-auth';

// Typed errors.
export {
  KibaError,
  ConfigError,
  ServiceNotFoundError,
  PaymentRequiredError,
  EscrowError,
  PlatformAuthError,
  EndpointVerificationError,
  AgentCallError,
} from './errors';

// Fees + keypair persistence.
export { PLATFORM_FEE_BPS, BPS_DENOMINATOR, computeFeeSplit } from './fees';
export { loadOrCreateKeypair, loadKeypairFromEnvOrFile } from './keypair-store';

// Chain abstraction: AgentClient/AgentProvider operate the blockchain only through
// the ChainClient interface. To add a chain, implement ChainClient and route it here.
export {
  createChainClient,
  walletToSigner,
  StellarChainClient,
  LocalKeypairSigner,
} from './chain';
export type {
  WalletLike,
  ChainClient,
  ChainAgentInfo,
  ChainEscrowInfo,
  EscrowRoles,
  RegisterAgentArgs,
  UpdateAgentArgs,
  OpenEscrowArgs,
  OpenEscrowResult,
  FetchEscrowArgs,
  ClaimPaymentArgs,
  RefundEscrowArgs,
  SettlePayoutArgs,
  StellarChainClientConfig,
  StellarSigner,
} from './chain';
export type { ChainClientConfig } from './chain/index';
