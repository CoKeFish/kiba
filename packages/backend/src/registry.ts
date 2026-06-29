/**
 * RegistryReader — lectura del registro de agentes (Stellar/Soroban).
 *
 * Soroban no enumera el storage, así que el catálogo se descubre de forma ABIERTA por
 * eventos del contrato (`listRegisteredServices` del SDK, vía getEvents): cualquier
 * agente que se registre on-chain aparece solo, sin allowlist ni aprobación. La env
 * STELLAR_SERVICES queda solo como SEED (servicios conocidos de arranque). La vigencia
 * de cada nombre se confirma con get_agent.
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
  /**
   * Agrega nombres de servicio al set conocido (p.ej. los que ya están en la DB, para
   * que sobrevivan a reinicios aunque su evento de registro quede fuera de la ventana
   * de retención del RPC). Idempotente.
   */
  addKnownServices?(names: string[]): void;
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

  /** Set de servicios conocidos: crece con el seed (env), la DB y el descubrimiento por eventos. */
  private readonly known: Set<string>;

  constructor(
    private readonly chain: ChainClient,
    seedServices: string[],
  ) {
    this.baseUnitsPerToken = chain.baseUnitsPerToken;
    this.asset = chain.asset;
    this.known = new Set(seedServices);
  }

  addKnownServices(names: string[]): void {
    for (const n of names) if (n) this.known.add(n);
  }

  async listAgents(): Promise<{ agents: AgentRecord[]; failed: string[] }> {
    const now = Math.floor(Date.now() / 1000);
    const out: AgentRecord[] = [];
    const failed: string[] = [];

    // Descubrimiento ABIERTO: lee los eventos del contrato para encontrar cualquier
    // agente registrado (sin allowlist). Best-effort — si falla, seguimos con lo conocido.
    if (this.chain.listRegisteredServices) {
      try {
        const windowLedgers = Number(process.env.STELLAR_EVENT_WINDOW_LEDGERS) || undefined;
        const discovered = await this.chain.listRegisteredServices({ windowLedgers });
        this.addKnownServices(discovered);
      } catch (err) {
        console.warn('[registry:stellar] descubrimiento por eventos falló:', (err as Error).message);
      }
    }

    for (const service of this.known) {
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
    if (this.known.size > 0 && failed.length === this.known.size) {
      throw new Error(
        `[registry:stellar] todas las lecturas fallaron (${failed.length}/${this.known.size}) — RPC caído`,
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
  // STELLAR_SERVICES es solo un SEED de arranque; el descubrimiento real es por eventos
  // del contrato (cualquier agente registrado aparece sin estar en esta lista).
  const seed = (process.env.STELLAR_SERVICES ?? DEFAULT_SERVICES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`[registry] Stellar reader — descubrimiento por eventos (seed: ${seed.length} servicios)`);
  return new StellarRegistryReader(cc, seed);
}
