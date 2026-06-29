/**
 * Configuration resolution for @kiba/sdk.
 *
 * The SDK is config-first: every constructor takes explicit options and the chain
 * settings resolve as `options.X ?? process.env.X ?? networkPreset.X`. Nothing is
 * read from the environment at module load, so two instances with different config
 * can coexist in one process (e.g. a testnet and a mainnet client side by side).
 *
 * `network: 'testnet' | 'mainnet'` selects a preset (RPC, passphrase, Horizon,
 * friendbot, Trustless Work API, USDC issuer). Individual fields can still be
 * overridden one by one.
 */
import { Networks } from '@stellar/stellar-sdk';
import { ConfigError } from './errors';

export type Network = 'testnet' | 'mainnet';

/** Base units per token: Stellar uses 7 decimals (stroops), for XLM and issued USDC alike. */
export const BASE_UNITS_PER_TOKEN = 1e7;

/** Default settlement asset across the marketplace. */
export const DEFAULT_ASSET: 'USDC' = 'USDC';

export interface NetworkPreset {
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  /** Friendbot funds test accounts. Absent on mainnet — accounts must be pre-funded. */
  friendbotUrl?: string;
  trustlessWorkApiUrl: string;
  /** Circle USDC issuer (G...) for this network. */
  usdcIssuer: string;
  usdcSymbol: 'USDC';
}

/**
 * Per-network defaults. Testnet is verified end-to-end; mainnet values are sensible
 * defaults but should be confirmed against your RPC/Trustless Work plan before use
 * (mainnet Soroban RPC usually needs a provider key; there is no friendbot).
 */
export const NETWORK_PRESETS: Record<Network, NetworkPreset> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    friendbotUrl: 'https://friendbot.stellar.org',
    trustlessWorkApiUrl: 'https://dev.api.trustlesswork.com',
    // Circle USDC on Stellar testnet.
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    usdcSymbol: 'USDC',
  },
  mainnet: {
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: Networks.PUBLIC,
    horizonUrl: 'https://horizon.stellar.org',
    friendbotUrl: undefined, // no friendbot on mainnet: accounts must be funded
    trustlessWorkApiUrl: 'https://api.trustlesswork.com',
    // Circle USDC on Stellar mainnet (centre.io / Circle).
    usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    usdcSymbol: 'USDC',
  },
};

/** Trustless Work escrow options (the x402 settlement layer). */
export interface TrustlessWorkOptions {
  /** API key (BackOffice dApp). Without it, escrow cannot settle. */
  apiKey?: string;
  /** API base URL. Defaults to the network preset. */
  apiUrl?: string;
  /** Platform address (G...): receives the fee and resolves disputes. Required if TW is active. */
  platformAddress?: string;
  /** Platform fee as a percentage (5 = 5%). Defaults to 5. */
  fee?: number;
  /** Trustline token moved by the escrow. Defaults to the network's USDC. */
  trustline?: { address: string; symbol: string };
}

/** Chain options shared by AgentClient and AgentProvider. */
export interface ChainOptions {
  /** Network preset: 'testnet' (default) or 'mainnet'. */
  network?: Network;
  /** Registry contract id (C...). Without it the SDK runs in degraded (no-chain) mode. */
  contractId?: string;
  /** Soroban RPC URL override. */
  rpcUrl?: string;
  /** Network passphrase override. */
  networkPassphrase?: string;
  /** Horizon URL override. */
  horizonUrl?: string;
  /** Friendbot URL override. Pass `null` to disable friendbot explicitly (e.g. mainnet). */
  friendbotUrl?: string | null;
  /** Settlement asset. Defaults to USDC. */
  asset?: 'USDC' | 'XLM';
  /** Issued-asset issuer (G...). Defaults to the network's USDC issuer. */
  assetIssuer?: string;
  /** Trustless Work escrow configuration. */
  trustlessWork?: TrustlessWorkOptions;
}

export interface ResolvedTrustlessWork {
  apiUrl: string;
  apiKey: string;
  platformAddress: string;
  platformFee: number;
  trustline: { address: string; symbol: string };
}

export interface ResolvedChainConfig {
  network: Network;
  contractId: string | null;
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  friendbotUrl?: string;
  asset: 'USDC' | 'XLM';
  assetIssuer?: string;
  baseUnitsPerToken: number;
  tw?: ResolvedTrustlessWork;
}

type Env = Record<string, string | undefined>;

function pick<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v as T;
  return undefined;
}

/**
 * Resolve chain configuration from explicit options, then environment, then the
 * network preset. `env` is injectable for testing; defaults to `process.env`.
 *
 * Throws {@link ConfigError} if Trustless Work is active (apiKey present) but no
 * platform address is provided — settling to an empty platform address would burn
 * the fee and break dispute resolution.
 */
export function resolveChainConfig(opts: ChainOptions = {}, env: Env = process.env): ResolvedChainConfig {
  const network = (pick(opts.network, env.STELLAR_NETWORK as Network) ?? 'testnet') as Network;
  const preset = NETWORK_PRESETS[network] ?? NETWORK_PRESETS.testnet;

  const asset = (opts.asset ?? 'USDC') as 'USDC' | 'XLM';
  const assetIssuer =
    asset === 'XLM'
      ? undefined
      : pick(opts.assetIssuer, env.TRUSTLESS_WORK_TRUSTLINE_ADDRESS, preset.usdcIssuer);

  // Friendbot: explicit `null` disables; otherwise option > env > preset (mainnet preset is undefined).
  const friendbotUrl =
    opts.friendbotUrl === null
      ? undefined
      : pick(opts.friendbotUrl ?? undefined, env.STELLAR_FRIENDBOT_URL, preset.friendbotUrl);

  let tw: ResolvedTrustlessWork | undefined;
  const twApiKey = pick(opts.trustlessWork?.apiKey, env.TRUSTLESS_WORK_API_KEY);
  if (twApiKey) {
    const platformAddress = pick(opts.trustlessWork?.platformAddress, env.TRUSTLESS_WORK_PLATFORM_ADDRESS);
    if (!platformAddress) {
      throw new ConfigError(
        'Trustless Work is active (apiKey set) but no platformAddress was provided. ' +
          'Set trustlessWork.platformAddress (or TRUSTLESS_WORK_PLATFORM_ADDRESS) to a funded G... address.',
      );
    }
    const feeRaw = pick(opts.trustlessWork?.fee, num(env.TRUSTLESS_WORK_PLATFORM_FEE));
    tw = {
      apiUrl: pick(opts.trustlessWork?.apiUrl, env.TRUSTLESS_WORK_API_URL, preset.trustlessWorkApiUrl)!,
      apiKey: twApiKey,
      platformAddress,
      platformFee: feeRaw ?? 5,
      trustline:
        opts.trustlessWork?.trustline ??
        {
          address: assetIssuer ?? preset.usdcIssuer,
          symbol: pick(env.TRUSTLESS_WORK_TRUSTLINE_SYMBOL, preset.usdcSymbol)!,
        },
    };
  }

  return {
    network,
    contractId: pick(opts.contractId, env.STELLAR_CONTRACT_ID) ?? null,
    rpcUrl: pick(opts.rpcUrl, env.STELLAR_RPC_URL, preset.rpcUrl)!,
    networkPassphrase: pick(opts.networkPassphrase, env.STELLAR_NETWORK_PASSPHRASE, preset.networkPassphrase)!,
    horizonUrl: pick(opts.horizonUrl, env.STELLAR_HORIZON_URL, preset.horizonUrl)!,
    friendbotUrl,
    asset,
    assetIssuer,
    baseUnitsPerToken: BASE_UNITS_PER_TOKEN,
    tw,
  };
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
