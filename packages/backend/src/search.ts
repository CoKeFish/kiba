/**
 * Capa de búsqueda. Tres modos:
 *   - keyword:  FTS5 + BM25
 *   - semantic: cosine sobre embeddings (si está disponible)
 *   - hybrid:   normaliza ambos scores y los combina (default)
 *
 * "Score" expuesto al cliente es siempre [0, 1] para que sea comparable entre modos.
 */
import type Database from 'better-sqlite3';
import {
  type AgentRecord,
  searchKeywordRaw,
  listAgentsWithEmbeddings,
  getAgentByService,
  listAgents,
} from './db';
import { embed, isReady as semanticReady, isEnabled as semanticEnabled, cosineSim } from './embeddings';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SearchHit {
  agent: AgentRecord;
  score: number;
  matchType: 'keyword' | 'semantic' | 'hybrid';
}

const HYBRID_KEYWORD_WEIGHT = 0.6;
const HYBRID_SEMANTIC_WEIGHT = 0.4;

/** Min-max normalization a [0, 1]. Empty input → []. Single → [1]. */
function normalize(scores: number[]): number[] {
  if (scores.length === 0) return [];
  if (scores.length === 1) return [1];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 1);
  return scores.map((s) => (s - min) / (max - min));
}

export async function searchKeyword(
  db: Database.Database,
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  const raw = searchKeywordRaw(db, query, limit);
  if (raw.length === 0) return [];
  const norm = normalize(raw.map((r) => r.score));
  const out: SearchHit[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = getAgentByService(db, raw[i].service);
    if (a) out.push({ agent: a, score: norm[i], matchType: 'keyword' });
  }
  return out;
}

export async function searchSemantic(
  db: Database.Database,
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  if (!semanticEnabled()) return [];
  const qVec = await embed(query);
  if (!qVec) return [];

  const candidates = listAgentsWithEmbeddings(db);
  if (candidates.length === 0) return [];

  const scored: { service: string; score: number }[] = [];
  for (const c of candidates) {
    scored.push({ service: c.service, score: cosineSim(qVec, c.embedding) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const out: SearchHit[] = [];
  for (const s of top) {
    const a = getAgentByService(db, s.service);
    if (a) {
      // cosine ya está en [-1, 1]; reescalamos a [0, 1]
      out.push({ agent: a, score: (s.score + 1) / 2, matchType: 'semantic' });
    }
  }
  return out;
}

export async function searchHybrid(
  db: Database.Database,
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  // Fan-out con un over-fetch razonable para que la fusión tenga material
  const overFetch = Math.max(limit * 3, 20);
  const [kw, sem] = await Promise.all([
    searchKeyword(db, query, overFetch),
    searchSemantic(db, query, overFetch),
  ]);

  if (sem.length === 0) {
    // semántico no disponible o no indexado → keyword puro
    return kw.slice(0, limit).map((h) => ({ ...h, matchType: 'keyword' }));
  }
  if (kw.length === 0) {
    return sem.slice(0, limit).map((h) => ({ ...h, matchType: 'semantic' }));
  }

  // Fusión por servicio
  const merged = new Map<string, { agent: AgentRecord; kw: number; sem: number }>();
  for (const h of kw) {
    merged.set(h.agent.service, { agent: h.agent, kw: h.score, sem: 0 });
  }
  for (const h of sem) {
    const existing = merged.get(h.agent.service);
    if (existing) existing.sem = h.score;
    else merged.set(h.agent.service, { agent: h.agent, kw: 0, sem: h.score });
  }

  const fused: SearchHit[] = [];
  for (const m of merged.values()) {
    const score = HYBRID_KEYWORD_WEIGHT * m.kw + HYBRID_SEMANTIC_WEIGHT * m.sem;
    const matchType: SearchHit['matchType'] =
      m.kw > 0 && m.sem > 0 ? 'hybrid' : m.kw > 0 ? 'keyword' : 'semantic';
    fused.push({ agent: m.agent, score, matchType });
  }
  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit);
}

export async function search(
  db: Database.Database,
  opts: { q?: string; mode?: SearchMode; limit?: number },
): Promise<SearchHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const q = opts.q?.trim();

  // Sin query: devolver el listado por reputación (fallback default)
  if (!q) {
    return listAgents(db, { limit }).map((a) => ({
      agent: a,
      score: 1,
      matchType: 'keyword' as const,
    }));
  }

  const mode: SearchMode = opts.mode ?? 'hybrid';
  switch (mode) {
    case 'keyword':
      return searchKeyword(db, q, limit);
    case 'semantic':
      return searchSemantic(db, q, limit);
    case 'hybrid':
    default:
      return searchHybrid(db, q, limit);
  }
}

export function searchStatus() {
  return {
    semantic: {
      enabled: semanticEnabled(),
      ready: semanticReady(),
    },
  };
}
