/**
 * Indexer: mantiene la DB off-chain sincronizada con el registry on-chain.
 *
 * Tres capas redundantes (a propósito):
 *   1. Bootstrap — getProgramAccounts una vez al arrancar
 *   2. Live      — onLogs en streaming, refresca al detectar Register/Update/Deregister
 *   3. Heartbeat — re-snapshot cada N minutos, repara drift por logs perdidos
 *
 * Si no hay PROGRAM_ID, siembra con FALLBACK_AGENTS para modo demo.
 *
 * Reglas de sync:
 *   - On-chain es source of truth. Si un agente desaparece de la cadena, se marca deleted=1 aquí.
 *   - Cada upsert dispara generación de embedding (best-effort, no bloquea).
 */
import {
  type AgentRecord,
  upsertAgent,
  setAgentEmbedding,
  markDeleted,
  listAgents,
  getDb,
} from './db';
import type { RegistryReader } from './registry';
import { embed, isEnabled as semanticEnabled } from './embeddings';

export interface IndexerEvent {
  type: 'snapshot' | 'agent_added' | 'agent_updated' | 'agent_removed' | 'program_event';
  agent?: { service: string };
  signature?: string;
  logs?: string[];
}

export type EventListener = (e: IndexerEvent) => void;

const HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Catálogo de demo agents — espejo de los 5 agents reales que corre el container
 * `ab-agents` (yield-hunter, risk-auditor, translator-pro, price-oracle, code-reviewer).
 *
 * Solo se siembran si `PROGRAM_ID` no está configurado (modo demo). Cuando hay
 * program activo, el indexer lee del registry on-chain y estos quedan ignorados.
 */
const NOW_TS = Math.floor(Date.now() / 1000);
const FALLBACK_AGENTS: AgentRecord[] = [
  {
    pda: 'fallback:yield-hunter',
    service: 'yield-hunter',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 10_000_000, // 0.01 SOL
    endpoint: 'http://demo-agents:5001',
    description: 'Encuentra el mejor APY entre protocolos DeFi en Solana',
    total_calls: 142,
    total_earned: 1_420_000_000,
    created_at: NOW_TS,
    updated_at: NOW_TS,
    source: 'fallback',
    deleted: 0,
  },
  {
    pda: 'fallback:risk-auditor',
    service: 'risk-auditor',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 20_000_000, // 0.02 SOL
    endpoint: 'http://demo-agents:5002',
    description: 'Analiza el riesgo de un smart contract / protocolo Solana',
    total_calls: 89,
    total_earned: 1_780_000_000,
    created_at: NOW_TS,
    updated_at: NOW_TS,
    source: 'fallback',
    deleted: 0,
  },
  {
    pda: 'fallback:translator-pro',
    service: 'translator-pro',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 5_000_000, // 0.005 SOL
    endpoint: 'http://demo-agents:5003',
    description:
      'Professional translation across English, Spanish, French, German, Japanese and Chinese',
    total_calls: 312,
    total_earned: 1_560_000_000,
    created_at: NOW_TS,
    updated_at: NOW_TS,
    source: 'fallback',
    deleted: 0,
  },
  {
    pda: 'fallback:price-oracle',
    service: 'price-oracle',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 1_000_000, // 0.001 SOL
    endpoint: 'http://demo-agents:5004',
    description:
      'Real-time cryptocurrency prices aggregated from major exchanges (Binance, Coinbase, Kraken)',
    total_calls: 2_104,
    total_earned: 2_104_000_000,
    created_at: NOW_TS,
    updated_at: NOW_TS,
    source: 'fallback',
    deleted: 0,
  },
  {
    pda: 'fallback:code-reviewer',
    service: 'code-reviewer',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 25_000_000, // 0.025 SOL
    endpoint: 'http://demo-agents:5005',
    description:
      'Reviews TypeScript, Rust and Solidity code for bugs, style issues, and common security vulnerabilities',
    total_calls: 41,
    total_earned: 1_025_000_000,
    created_at: NOW_TS,
    updated_at: NOW_TS,
    source: 'fallback',
    deleted: 0,
  },
];

function embedTextFor(a: { service: string; description: string }): string {
  return `${a.service}\n${a.description}`;
}

/**
 * Genera embedding y lo guarda. Best-effort — si falla, log y seguir.
 * Diseñado para ser fire-and-forget desde el upsert principal.
 */
async function embedAgent(service: string, description: string): Promise<void> {
  if (!semanticEnabled()) return;
  try {
    const vec = await embed(embedTextFor({ service, description }));
    if (vec) setAgentEmbedding(getDb(), service, vec);
  } catch (err) {
    console.warn(`[indexer] embed falló para ${service}:`, (err as Error).message);
  }
}

export class Indexer {
  private reader: RegistryReader | null;
  private listeners = new Set<EventListener>();
  private unsubscribe: (() => void) | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(reader: RegistryReader | null) {
    this.reader = reader;
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: IndexerEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch (err) {
        console.error('[indexer] listener throw:', err);
      }
    }
  }

  /**
   * Carga inicial. Si hay programa → fetch on-chain. Si no → siembra fallback.
   */
  async bootstrap(): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    if (!this.reader) {
      console.log('[indexer] sin cadena configurada — sembrando FALLBACK_AGENTS');
      for (const a of FALLBACK_AGENTS) {
        upsertAgent(db, { ...a, updated_at: now });
        void embedAgent(a.service, a.description);
      }
      return;
    }

    try {
      const onChain = await this.reader.listAgents();
      console.log(`[indexer] bootstrap (${this.reader.label}): ${onChain.length} agentes on-chain`);
      // Salvaguarda: lectura vacía con catálogo previo ⇒ probable fallo de RPC (no 0 agentes
      // reales) → NO reconciliar, para no borrar todo el catálogo por un parpadeo de RPC.
      if (onChain.length === 0) {
        const existingChain = listAgents(db, { limit: 1 }).filter((a) => a.source === 'chain');
        if (existingChain.length > 0) {
          console.warn(
            '[indexer] lectura on-chain vacía con catálogo previo — conservando snapshot (posible fallo de RPC)',
          );
          this.emit({ type: 'snapshot' });
          return;
        }
      }
      const seen = new Set<string>();
      for (const rec of onChain) {
        upsertAgent(db, rec);
        seen.add(rec.service);
        void embedAgent(rec.service, rec.description);
      }
      // Marca como deleted los que están en DB pero ya no on-chain (excepto fallbacks)
      const local = listAgents(db, { limit: 10_000 });
      for (const l of local) {
        if (l.source === 'chain' && !seen.has(l.service)) {
          markDeleted(db, l.service);
          this.emit({ type: 'agent_removed', agent: { service: l.service } });
        }
      }
      this.emit({ type: 'snapshot' });
    } catch (err) {
      console.error('[indexer] bootstrap falló:', (err as Error).message);
    }
  }

  /**
   * Escucha logs del programa. Cualquier instrucción interesante → re-snapshot.
   *
   * Nota: Solana logs NO incluyen los args de la instrucción, solo el nombre.
   * Por eso re-fetcheamos todo en vez de aplicar el diff puntual. Ineficiente pero correcto.
   * Para escala, migrar a Helius webhooks que sí parsea args.
   */
  subscribeToChain(): void {
    if (!this.reader?.subscribe) return;
    try {
      this.unsubscribe = this.reader.subscribe(() => {
        this.emit({ type: 'program_event' });
        void this.bootstrap();
      });
      console.log('[indexer] suscrito a cambios del registro');
    } catch (err) {
      console.error('[indexer] subscribe falló:', (err as Error).message);
    }
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.bootstrap();
    }, HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        /* ignore */
      }
      this.unsubscribe = null;
    }
  }
}
