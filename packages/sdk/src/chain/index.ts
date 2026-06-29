/**
 * ChainClient factory (Stellar/Soroban). Returns `null` in "degraded mode" (no
 * contractId resolved): the agent still serves and the client still runs the x402
 * handshake, but without on-chain settlement.
 *
 * Config-first: all chain settings come from explicit options, falling back to
 * environment, then the network preset (see {@link resolveChainConfig}). Nothing is
 * read at module load, so two clients with different config can coexist in one
 * process.
 */
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import { StellarChainClient } from './stellar';
import { LocalKeypairSigner, type StellarSigner } from './signer';
import type { ChainClient } from './types';
import { resolveChainConfig, type ChainOptions } from '../config';

/**
 * A wallet accepted by the SDK. Either a Stellar `Keypair`, or any object exposing
 * a 64-byte ed25519 `secretKey` (e.g. a `@solana/web3.js` Keypair) whose first 32
 * bytes are the seed — the Stellar address is derived from that seed, so the same
 * key yields the same `G...` address it always had.
 */
export type WalletLike = StellarKeypair | { secretKey: Uint8Array };

export interface ChainClientConfig extends ChainOptions {
  /** Keypair (Stellar, or a structural ed25519 keypair). Used to derive a local signer. */
  wallet?: WalletLike;
  /** Pre-built signer (e.g. Privy, remote signing). Takes precedence over `secret`/`wallet`. */
  signer?: StellarSigner;
  /** Explicit Stellar secret (S...). Precedence: signer > secret > STELLAR_SECRET env > wallet. */
  secret?: string;
  /** Log prefix for degraded-mode warnings. */
  label?: string;
}

function isStellarKeypair(w: WalletLike): w is StellarKeypair {
  return (
    typeof (w as StellarKeypair).rawSecretKey === 'function' &&
    typeof (w as StellarKeypair).publicKey === 'function'
  );
}

/** Derive a local Stellar signer from a Stellar or structural ed25519 keypair. */
export function walletToSigner(wallet: WalletLike): LocalKeypairSigner {
  if (isStellarKeypair(wallet)) return new LocalKeypairSigner(wallet);
  const seed = Buffer.from(wallet.secretKey.slice(0, 32));
  return new LocalKeypairSigner(StellarKeypair.fromRawEd25519Seed(seed));
}

/**
 * Create the Stellar/Soroban ChainClient, or `null` if no chain is configured
 * (no contractId) or no signer can be derived.
 */
export function createChainClient(config: ChainClientConfig): ChainClient | null {
  const label = config.label ?? 'chain';
  const contractId = config.contractId ?? process.env.STELLAR_CONTRACT_ID;
  if (!contractId) {
    console.warn(`[${label}] no contractId (pass contractId or set STELLAR_CONTRACT_ID) — degraded mode`);
    return null;
  }

  // Signer precedence: explicit signer > explicit secret > STELLAR_SECRET env > wallet.
  let signer: StellarSigner;
  if (config.signer) {
    signer = config.signer;
  } else if (config.secret) {
    signer = new LocalKeypairSigner(StellarKeypair.fromSecret(config.secret));
  } else if (process.env.STELLAR_SECRET) {
    signer = new LocalKeypairSigner(StellarKeypair.fromSecret(process.env.STELLAR_SECRET));
  } else if (config.wallet) {
    signer = walletToSigner(config.wallet);
  } else {
    console.warn(`[${label}] no signer/secret/wallet — cannot create ChainClient`);
    return null;
  }

  const resolved = resolveChainConfig(config);
  if (!resolved.tw) {
    console.warn(
      `[${label}] Trustless Work not configured (no apiKey) — x402 escrow cannot settle`,
    );
  }

  return new StellarChainClient({
    signer,
    contractId,
    rpcUrl: resolved.rpcUrl,
    networkPassphrase: resolved.networkPassphrase,
    friendbotUrl: resolved.friendbotUrl,
    horizonUrl: resolved.horizonUrl,
    label,
    asset: resolved.asset,
    assetIssuer: resolved.assetIssuer,
    baseUnitsPerToken: resolved.baseUnitsPerToken,
    tw: resolved.tw,
  });
}

export type {
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
} from './types';
export { StellarChainClient, type StellarChainClientConfig } from './stellar';
export { TrustlessWorkEscrowClient, type TrustlessWorkConfig } from './trustless-work';
export { LocalKeypairSigner, type StellarSigner } from './signer';
