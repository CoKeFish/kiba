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
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { type AgentBazaarProgram, type AgentAccount } from '@agent-bazaar/sdk';
import {
  type AgentRecord,
  upsertAgent,
  setAgentEmbedding,
  markDeleted,
  listAgents,
  getDb,
} from './db';
import { embed, isEnabled as semanticEnabled } from './embeddings';

export interface IndexerEvent {
  type: 'snapshot' | 'agent_added' | 'agent_updated' | 'agent_removed' | 'program_event';
  agent?: { service: string };
  signature?: string;
  logs?: string[];
}

export type EventListener = (e: IndexerEvent) => void;

const HEARTBEAT_MS = 5 * 60 * 1000;
const PROGRAM_INSTR_REGEX =
  /Program log: Instruction: (RegisterAgent|UpdateAgent|DeregisterAgent|ClaimPayment|RefundEscrow)/i;

/**
 * Catálogo de demo agents en mezcla ES/EN — la mezcla intencional valida
 * el discovery cross-lingüe (queries en español encuentran descriptions en inglés
 * sólo gracias al modo semantic).
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
    pda: 'fallback:meme-screener',
    service: 'meme-screener',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 15_000_000, // 0.015 SOL
    endpoint: 'http://demo-agents:5005',
    description:
      'Detecta posibles rugpulls y honeypots en memecoins recién lanzados en Solana, evaluando liquidez, holders y ownership renunciado',
    total_calls: 67,
    total_earned: 1_005_000_000,
    created_at: NOW_TS,
    updated_at: NOW_TS,
    source: 'fallback',
    deleted: 0,
  },
  {
    pda: 'fallback:tweet-digest',
    service: 'tweet-digest',
    owner_wallet: 'PHASE_1_PLACEHOLDER',
    price_per_call: 3_000_000, // 0.003 SOL
    endpoint: 'http://demo-agents:5006',
    description:
      'Summarizes long Twitter / X threads into concise bullet points with key takeaways',
    total_calls: 524,
    total_earned: 1_572_000_000,
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
    endpoint: 'http://demo-agents:5007',
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

function chainAgentToRecord(pda: PublicKey, a: AgentAccount, now: number): AgentRecord {
  return {
    pda: pda.toBase58(),
    service: a.service,
    owner_wallet: a.owner.toBase58(),
    price_per_call: Number(a.pricePerCall),
    endpoint: a.endpoint,
    description: a.description,
    total_calls: Number(a.totalCalls),
    total_earned: Number(a.totalEarned),
    created_at: Number(a.createdAt),
    updated_at: now,
    source: 'chain',
    deleted: 0,
  };
}

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
  private program: AgentBazaarProgram | null;
  private connection: Connection | null;
  private listeners = new Set<EventListener>();
  private logsSubId: number | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(program: AgentBazaarProgram | null, connection: Connection | null) {
    this.program = program;
    this.connection = connection;
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

    if (!this.program) {
      console.log('[indexer] sin PROGRAM_ID — sembrando FALLBACK_AGENTS');
      for (const a of FALLBACK_AGENTS) {
        upsertAgent(db, { ...a, updated_at: now });
        void embedAgent(a.service, a.description);
      }
      return;
    }

    try {
      const onChain = await this.program.fetchAllAgents();
      console.log(`[indexer] bootstrap: ${onChain.length} agentes on-chain`);
      const seen = new Set<string>();
      for (const { pda, data } of onChain) {
        const rec = chainAgentToRecord(pda, data, now);
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
    if (!this.program || !this.connection) return;
    try {
      this.logsSubId = this.connection.onLogs(
        this.program.programId,
        (logs) => {
          const interesting = logs.logs.some((l) => PROGRAM_INSTR_REGEX.test(l));
          if (!interesting) return;
          this.emit({
            type: 'program_event',
            signature: logs.signature,
            logs: logs.logs.slice(0, 10),
          });
          // Re-snapshot async
          void this.bootstrap();
        },
        'confirmed',
      );
      console.log(`[indexer] suscrito a logs del programa`);
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
    if (this.logsSubId !== null && this.connection) {
      try {
        await this.connection.removeOnLogsListener(this.logsSubId);
      } catch {
        /* ignore */
      }
      this.logsSubId = null;
    }
  }
}
