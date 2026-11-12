/**
 * La tesorería de Kiba (master wallet) y lecturas de saldo en la red.
 *
 * Kiba no tiene wallets de usuarios: cada usuario vincula la suya y firma él (ver spend.ts).
 * Aquí solo vive la clave de la tesorería, que es de Kiba.
 */
import { Keypair } from '@solana/web3.js';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import {
  LocalKeypairSigner,
  LocalPlatformSigner,
  type StellarSigner,
  type PlatformCallSigner,
} from 'kiba-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getBalance, lamportsToSol, lamportsToUsd } from './billing';
import { ASSET, chainClientFor, chainClientForSigner } from './chain';
import { db } from './db';

/** Nombre de la unidad base de la cadena activa (stroops en Stellar). */
export const BASE_UNIT_NAME: 'lamports' | 'stroops' = 'stroops';

const MASTER_KEYPAIR_PATH = process.env.MASTER_KEYPAIR_PATH || '/app/data/master-wallet.json';

/** Carga/crea el keypair (64-byte secretKey ed25519) de la treasury en disco. */
function loadOrCreateSolanaKeypair(path: string): Keypair {
  if (existsSync(path)) {
    const arr = JSON.parse(readFileSync(path, 'utf8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const kp = Keypair.generate();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

function loadMasterWallet(): Keypair {
  const fromEnv = process.env.MASTER_WALLET_SECRET;
  if (fromEnv) {
    const arr = JSON.parse(fromEnv) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return loadOrCreateSolanaKeypair(MASTER_KEYPAIR_PATH);
}

const masterWallet = loadMasterWallet();

export function getMasterWallet(): Keypair {
  return masterWallet;
}

/**
 * Firmante de la plataforma para las llamadas de confianza (asimétrico): firma cada
 * llamada con la clave PRIVADA; los agentes verifican con la clave PÚBLICA publicada
 * (sin secreto compartido). Usa KIBA_PLATFORM_SECRET (S...) si está; si no, deriva el
 * keypair Stellar del seed de la treasury (misma identidad on-chain que el platformAddress).
 */
let platformSigner: PlatformCallSigner | null = null;
export function getPlatformSigner(): PlatformCallSigner {
  if (platformSigner) return platformSigner;
  const secret = process.env.KIBA_PLATFORM_SECRET;
  const kp = secret
    ? StellarKeypair.fromSecret(secret)
    : StellarKeypair.fromRawEd25519Seed(Buffer.from(masterWallet.secretKey.slice(0, 32)));
  platformSigner = new LocalPlatformSigner(kp);
  return platformSigner;
}

/** Clave PÚBLICA de la plataforma (G...) que los agentes configuran para verificar. */
export function platformPublicKey(): string {
  return getPlatformSigner().publicKey();
}

export function masterWalletPubkey(): string {
  // Dirección nativa de la cadena activa (Stellar deriva del seed).
  const cc = chainClientFor(masterWallet, 'master');
  return cc?.ownerAddress ?? masterWallet.publicKey.toBase58();
}

/**
 * Saldo on-chain (unidades base) del activo de liquidación de una dirección arbitraria
 * (p.ej. la wallet owner de un agente, donde aterrizan los payouts). 0 si no hay cadena o
 * falla. Leer un balance no requiere firmar; se usa la master keypair solo para construir el
 * cliente.
 */
export async function addressOnChainBalance(address: string): Promise<number> {
  const cc = chainClientFor(getMasterWallet(), 'balance-of');
  if (!cc?.getBalanceOfAddress) return 0;
  try {
    return Number(await cc.getBalanceOfAddress(address));
  } catch (err) {
    console.warn('[wallets] address balance query failed:', (err as Error).message);
    return 0;
  }
}

/** Saldo on-chain de una custodial, en unidades base del activo activo. */
export async function getOnChainBalance(wallet: Keypair): Promise<number> {
  const cc = chainClientFor(wallet);
  if (!cc) return 0;
  try {
    return Number(await cc.getBalanceBaseUnits());
  } catch (err) {
    console.warn('[wallets] balance query failed:', (err as Error).message);
    return 0;
  }
}

/**
 * Balances de un user, en USD + unidades base + activo nativo (XLM).
 *
 * `*_lamports` y `*_sol` se conservan como aliases legacy: los valores numéricos
 * son los mismos que los nuevos `*_base_units` y `*_asset_amount` — para no romper
 * integraciones existentes que aún leen los nombres viejos.
 */
export interface UserBalances {
  // Chain-agnostic (preferido).
  asset: 'SOL' | 'XLM' | 'USDC';
  baseUnitName: 'lamports' | 'stroops';
  creditBaseUnits: number;
  creditUsd: number;
  walletBaseUnits: number;
  walletAssetAmount: number;
  walletUsd: number;
  totalBaseUnits: number;
  totalAssetAmount: number;
  totalUsd: number;

  // Legacy (deprecated): mismos números que los *_base_units/*_asset_amount.
  /** @deprecated use creditBaseUnits */ creditLamports: number;
  /** @deprecated use walletBaseUnits */ walletLamports: number;
  /** @deprecated use walletAssetAmount */ walletSol: number;
  /** @deprecated use totalBaseUnits */ totalLamports: number;
  /** @deprecated use totalAssetAmount */ totalSol: number;
}

export async function getUserBalances(userId: number): Promise<UserBalances> {
  const creditLamports = await getBalance(userId);
  let walletLamports = 0;
  try {
    // Lo que queda por gastar del depósito retirable. Import diferido: channel.ts importa este módulo.
    const { channelAvailable } = await import('./channel.js');
    walletLamports = (await channelAvailable(userId)) ?? 0;
  } catch (err) {
    console.warn(`[wallets] on-chain balance failed for user ${userId}:`, (err as Error).message);
  }
  const totalLamports = creditLamports + walletLamports;
  const walletSol = lamportsToSol(walletLamports);
  const totalSol = lamportsToSol(totalLamports);
  return {
    asset: ASSET,
    baseUnitName: BASE_UNIT_NAME,
    creditBaseUnits: creditLamports,
    creditUsd: lamportsToUsd(creditLamports),
    walletBaseUnits: walletLamports,
    walletAssetAmount: walletSol,
    walletUsd: lamportsToUsd(walletLamports),
    totalBaseUnits: totalLamports,
    totalAssetAmount: totalSol,
    totalUsd: lamportsToUsd(totalLamports),
    // Legacy aliases.
    creditLamports,
    walletLamports,
    walletSol,
    totalLamports,
    totalSol,
  };
}

/**
 * Asegura que la TREASURY de la plataforma (master wallet) exista y tenga fondos
 * on-chain. Es quien liquida los escrows pagados con CRÉDITO (la custodial del
 * usuario NO se toca en ese modo). En testnet, friendbot la crea+fondea (10k XLM)
 * una vez; idempotente si ya existe.
 */
export async function ensureTreasuryFunded(): Promise<void> {
  const cc = chainClientFor(masterWallet, 'treasury');
  if (!cc) return;
  try {
    await cc.ensureFunds(0, 0);
  } catch (err) {
    console.warn('[wallets] ensureTreasuryFunded:', (err as Error).message);
  }
}
