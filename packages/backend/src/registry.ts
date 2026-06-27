/**
 * RegistryReader — lectura del registro de agentes (Stellar/Soroban).
 *
 * Soroban no tiene enumeración de cuentas → leemos una lista conocida de servicios
 * (env STELLAR_SERVICES) con get_agent vía la abstracción ChainClient del SDK.
 */
import { Keypair } from '@solana/web3.js';
import { createChainClient, type ChainClient } from '@kiba/sdk';
import type { AgentRecord } from './db';

export interface RegistryReader {
  /** Unidades base por token del activo (1e7 stroops para XLM). */
  readonly baseUnitsPerToken: number;
  readonly asset: string;
  readonly label: string;
  /**
   * Enumera todos los agentes visibles del registro.
   * `failed` = servicios cuya lectura ERRÓ (≠ "ausente"): el indexer NO debe borrarlos,
   * para no perder agentes vivos ante un fallo parcial de RPC.
   */
  listAgents(): Promise<{ agents: AgentRecord[]; failed: string[] }>;
  /** Suscripción opcional a cambios live. Devuelve un unsubscribe. */
  subscribe?(onChange: () => void): () => void;
}

const DEFAULT_SERVICES = [
  'yield-hunter',
  'risk-auditor',
  'translator-pro',
  'price-oracle',
  'code-reviewer',
  'firecrawl',
];

class StellarRegistryReader implements RegistryReader {
  readonly baseUnitsPerToken: number;
  readonly asset: string;
  readonly label = 'stellar';

  constructor(
    private readonly chain: ChainClient,
    private readonly services: string[],
  ) {
    this.baseUnitsPerToken = chain.baseUnitsPerToken;
    this.asset = chain.asset;
  }

  async listAgents(): Promise<{ agents: AgentRecord[]; failed: string[] }> {
    const now = Math.floor(Date.now() / 1000);
    const out: AgentRecord[] = [];
    const failed: string[] = [];
    for (const service of this.services) {
      try {
        const a = await this.chain.fetchAgent(service);
        if (!a) continue;
        out.push({
          pda: `stellar:${a.service}`,
          service: a.service,
          owner_wallet: a.ownerAddress,
          price_per_call: Number(a.pricePerCallBaseUnits),
          endpoint: a.endpoint,
          description: a.description,
          // El contrato acumula stats en cada claim; el SDK las expone. Antes se
          // hardcodeaban a 0, así que el backend nunca reflejaba la actividad real.
          total_calls: a.totalCalls != null ? Number(a.totalCalls) : 0,
          total_earned: a.totalEarnedBaseUnits != null ? Number(a.totalEarnedBaseUnits) : 0,
          // `createdAt` viene del contrato (register_agent lo fija una vez;
          // update_agent lo preserva). Fallback al timestamp del indexer si el
          // cliente de cadena no lo expone — preserva el comportamiento previo.
          created_at: a.createdAt != null ? Number(a.createdAt) : now,
          updated_at: now,
          source: 'chain',
          deleted: 0,
        });
      } catch (err) {
        failed.push(service);
        console.warn(`[registry:stellar] get_agent(${service}) falló:`, (err as Error).message);
      }
    }
    // Si fallaron TODAS las lecturas es un fallo de RPC (no "0 agentes"): lanzar para
    // que el indexer NO reconcilie y NO borre el catálogo por un parpadeo de RPC.
    if (this.services.length > 0 && failed.length === this.services.length) {
      throw new Error(
        `[registry:stellar] todas las lecturas fallaron (${failed.length}/${this.services.length}) — RPC caído`,
      );
    }
    // `failed` (fallo parcial) viaja al indexer para que NO borre esos servicios.
    return { agents: out, failed };
  }
  // Sin subscribe: el heartbeat del indexer re-snapshotea periódicamente.
}

/**
 * Construye el RegistryReader (Stellar). Devuelve null en modo demo
 * (sin STELLAR_CONTRACT_ID) → el indexer siembra FALLBACK_AGENTS.
 */
export function createRegistryReader(): RegistryReader | null {
  const chain = (process.env.CHAIN ?? 'stellar').toLowerCase();
  if (chain !== 'stellar') {
    console.warn(`[registry] CHAIN=${chain} no soportado (solo stellar) — modo demo`);
    return null;
  }
  if (!process.env.STELLAR_CONTRACT_ID) {
    console.warn('[registry] falta STELLAR_CONTRACT_ID — modo demo');
    return null;
  }
  // Keypair efímero: las lecturas Soroban no requieren cuenta fondeada.
  const cc = createChainClient({ wallet: Keypair.generate(), label: 'backend' });
  if (!cc) return null;
  const services = (process.env.STELLAR_SERVICES ?? DEFAULT_SERVICES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`[registry] Stellar reader sobre ${services.length} servicios`);
  return new StellarRegistryReader(cc, services);
}
