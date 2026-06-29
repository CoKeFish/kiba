import type { ChainOptions } from './config';
import type { StellarSigner } from './chain/signer';
import type { ChainClient, WalletLike } from './chain';

/**
 * Configuration for an {@link AgentProvider}. Extends {@link ChainOptions}, so all
 * chain settings (network/contractId/rpcUrl/trustlessWork…) are passed explicitly;
 * environment variables are only a fallback.
 */
export interface AgentConfig extends ChainOptions {
  /** Keypair that owns this agent (Stellar, or a structural ed25519 keypair). */
  wallet?: WalletLike;
  /** Pre-built signer (e.g. Privy / remote). Takes precedence over `wallet`. */
  signer?: StellarSigner;
  /** Explicit Stellar secret (S...). Alternative to `wallet`/`signer`. */
  secret?: string;
  /** Inject a pre-built ChainClient (custom chain / testing). Overrides the chain config. */
  chainClient?: ChainClient;
  /** Service identifier: 'yield-hunter', 'translate-en-es', etc. (max 32 chars). */
  service: string;
  /**
   * Base price per call in the settlement asset (decimal USDC, e.g. 0.01).
   * - Without `priceFn`: every call costs exactly this (flat model).
   * - With `priceFn`: this is the on-chain FLOOR. The agent may charge more but never
   *   less (the registry rejects amounts below the floor).
   */
  pricePerCall: number;
  /**
   * Optional dynamic pricing. Receives the request payload and returns how much
   * (decimal USDC) to charge for THIS call. The result is raised to the floor
   * (`pricePerCall`) if lower. Must be deterministic in the payload so the 402 quote
   * and the post-payment check agree. Example:
   *   priceFn: (req) => 0.001 + (req?.text?.length ?? 0) * 0.00001
   */
  priceFn?: (request: unknown) => number | Promise<number>;
  /** Human-readable note about the pricing model — informational, goes in the manifest. */
  pricingNote?: string;
  /** Free-text description for the catalog (max 512 chars). */
  description?: string;
  /** Public endpoint where other agents reach this service (max 256 chars). */
  endpoint?: string;
  /**
   * Platform public key (Stellar G... strkey) used to verify platform-signed calls.
   * When set, the provider accepts fast off-chain calls that carry a valid signature
   * from the platform's private key (no shared secret). Omit to disable the trusted
   * path entirely (only x402 escrow is then accepted).
   */
  platform?: {
    /** The platform's published public key (G...). */
    publicKey: string;
    /** Clock-skew tolerance in seconds for signed calls (default 120). */
    maxClockSkewSec?: number;
  };
  /**
   * Serve requests WITHOUT on-chain verification (degraded mode). Off by default —
   * an agent with no chain configured refuses to serve unpaid. Enable only for local
   * demos. Replaces the old ALLOW_DEGRADED_PAYMENTS env flag.
   */
  allowUnverified?: boolean;
  /** Body-size limit for the built-in express handler (default '256kb'). */
  bodyLimit?: string;
  /** Max unpaid (402) requests per IP per minute — caps priceFn compute cost. Default 60; 0 disables. */
  rateLimitPerMinute?: number;
  /** How many times to re-poll the escrow while waiting for funding to confirm. Default 12. */
  escrowPollAttempts?: number;
  /** Delay between escrow funding polls, in ms. Default 2500. */
  escrowPollIntervalMs?: number;
}

/** Options for an {@link AgentClient}. Extends {@link ChainOptions} (config-first). */
export interface ClientConfig extends ChainOptions {
  wallet?: WalletLike;
  signer?: StellarSigner;
  secret?: string;
  /** Inject a pre-built ChainClient (custom chain / testing). Overrides the chain config. */
  chainClient?: ChainClient;
  /** Discovery backend URL used when a service is not found on-chain. */
  discoveryUrl?: string;
  /**
   * Verify, on discovery, that the registered endpoint actually belongs to the on-chain
   * owner (its live `/manifest` reports the same service + ownerWallet). Mitigates
   * name-squatting that points a service at someone else's endpoint. Off by default
   * (adds a round-trip); recommended for production. Throws {@link import('./errors').EndpointVerificationError}.
   */
  verifyEndpoint?: boolean;
}

export interface ServiceManifest {
  service: string;
  /** Base/floor price in the settlement asset (decimal). Effective price may be higher. */
  pricePerCall: number;
  /** If true, the agent computes price per request → the 402 quote is authoritative. */
  dynamicPricing?: boolean;
  /** Human note about the pricing model (when dynamicPricing=true). */
  pricingNote?: string;
  description?: string;
  endpoint: string;
  ownerWallet: string;
  acceptedToken: 'USDC' | 'XLM';
}

export interface X402Quote {
  /** Amount in base units (stroops; 1 USDC = 1e7). */
  amount: string;
  /** Destination address for the payment. */
  payTo: string;
  /** Settlement asset. */
  asset: 'USDC' | 'XLM';
  /** Service this quote applies to. */
  service: string;
  /** Per-request nonce — prevents replays. */
  nonce: string;
  /** Expiry timestamp (unix seconds). */
  expiresAt: number;
}

export type ProviderHandler<TRequest = unknown, TResponse = unknown> = (
  request: TRequest,
) => Promise<TResponse>;

export interface CallOptions {
  /** Max price to pay, in the settlement asset decimal (safety cap). */
  maxPrice?: number;
  /** Allowlist of permitted services. */
  allowlist?: string[];
  /** Timeout in ms for the whole cycle. */
  timeoutMs?: number;
}
