/**
 * Factory de ChainClient. Selecciona la implementación de cadena a partir de la
 * config/entorno:
 *   - CHAIN=stellar → StellarChainClient (Soroban)
 *   - en otro caso  → SolanaChainClient (si hay PROGRAM_ID válido)
 *
 * Devuelve `null` en "modo degradado" (sin cadena configurada): el agente sigue
 * sirviendo y el cliente sigue haciendo el handshake x402, pero sin liquidación
 * on-chain. Esto preserva el comportamiento previo cuando falta la config.
 */
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import { Keypair as StellarKeypair, Networks } from '@stellar/stellar-sdk';
import { KibaProgram } from '../program';
import { SolanaChainClient } from './solana';
import { StellarChainClient } from './stellar';
import type { ChainClient } from './types';

const RPC_DEFAULT = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export interface ChainClientConfig {
  wallet: Keypair;
  rpcUrl?: string;
  programId?: PublicKey | string;
  /** Prefijo para logs en modo degradado / airdrop. */
  label?: string;
}

/**
 * Crea el ChainClient apropiado, o `null` si no hay cadena configurada.
 */
export function createChainClient(config: ChainClientConfig): ChainClient | null {
  const label = config.label ?? 'chain';

  if ((process.env.CHAIN ?? '').toLowerCase() === 'stellar') {
    return createStellarChainClient(config, label);
  }

  return createSolanaChainClient(config, label);
}

function createSolanaChainClient(
  config: ChainClientConfig,
  label: string,
): ChainClient | null {
  const connection = new Connection(config.rpcUrl ?? RPC_DEFAULT, 'confirmed');

  const programIdStr =
    (typeof config.programId === 'string'
      ? config.programId
      : config.programId?.toBase58()) ?? process.env.PROGRAM_ID;

  if (!programIdStr || programIdStr.length < 32) {
    console.warn(`[${label}] PROGRAM_ID no configurado — modo degradado (sin verificación on-chain)`);
    return null;
  }

  try {
    const program = new KibaProgram(new PublicKey(programIdStr), connection);
    return new SolanaChainClient({ connection, program, wallet: config.wallet, label });
  } catch (e) {
    console.warn(`[${label}] PROGRAM_ID inválido, modo degradado:`, (e as Error).message);
    return null;
  }
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
    // El wallet del SDK es un keypair ed25519 (Solana). Stellar también usa
    // ed25519 → derivamos el mismo par desde el seed de 32 bytes. Misma clave,
    // dos codificaciones de dirección (base58 vs strkey G...).
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
} from './types';
export { SolanaChainClient } from './solana';
export { StellarChainClient, type StellarChainClientConfig } from './stellar';
