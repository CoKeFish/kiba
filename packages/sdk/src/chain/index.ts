/**
 * Factory de ChainClient (Stellar/Soroban). Devuelve `null` en "modo degradado"
 * (sin STELLAR_CONTRACT_ID): el agente sigue sirviendo y el cliente sigue el
 * handshake x402, pero sin liquidación on-chain.
 */
import { type Keypair } from '@solana/web3.js';
import { Keypair as StellarKeypair, Networks } from '@stellar/stellar-sdk';
import { StellarChainClient } from './stellar';
import type { ChainClient } from './types';

export interface ChainClientConfig {
  wallet: Keypair;
  rpcUrl?: string;
  /** Prefijo para logs en modo degradado. */
  label?: string;
}

/**
 * Crea el ChainClient (Stellar/Soroban), o `null` si no hay cadena configurada.
 */
export function createChainClient(config: ChainClientConfig): ChainClient | null {
  return createStellarChainClient(config, config.label ?? 'chain');
}

function createStellarChainClient(
  config: ChainClientConfig,
  label: string,
): ChainClient | null {
  const contractId = process.env.STELLAR_CONTRACT_ID;
  if (!contractId) {
    console.warn(`[${label}] CHAIN=stellar pero falta STELLAR_CONTRACT_ID — modo degradado`);
    return null;
  }

  const rpcUrl = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
  const friendbotUrl = process.env.STELLAR_FRIENDBOT_URL ?? 'https://friendbot.stellar.org';
  const horizonUrl = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

  let keypair: StellarKeypair;
  if (process.env.STELLAR_SECRET) {
    keypair = StellarKeypair.fromSecret(process.env.STELLAR_SECRET);
  } else {
    // El wallet del SDK es un keypair ed25519 (contenedor de claves de
    // @solana/web3.js). Stellar también usa ed25519 → derivamos el mismo par
    // desde el seed de 32 bytes. Misma clave, dirección en strkey (G...).
    const seed = Buffer.from(config.wallet.secretKey.slice(0, 32));
    keypair = StellarKeypair.fromRawEd25519Seed(seed);
  }

  return new StellarChainClient({
    keypair,
    contractId,
    rpcUrl,
    networkPassphrase,
    friendbotUrl,
    horizonUrl,
    label,
  });
}

export type {
  ChainClient,
  ChainAgentInfo,
  ChainEscrowInfo,
  RegisterAgentArgs,
  UpdateAgentArgs,
  OpenEscrowArgs,
  FetchEscrowArgs,
  ClaimPaymentArgs,
  RefundEscrowArgs,
} from './types';
export { StellarChainClient, type StellarChainClientConfig } from './stellar';
