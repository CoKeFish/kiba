import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "keyword" | "semantic" | "hybrid";

type Agent = {
  service: string;
  description: string;
  endpoint: string;
  pricePerCall: number; // SOL
  totalCalls?: number;
  source?: string;
  // Solo presentes cuando hay query
  score?: number;
  matchType?: Mode;
};

type SearchResponse = {
  query: string;
  mode: Mode;
  count: number;
  results: Agent[];
};

const FALLBACK: Agent[] = [
  {
    service: "yield-hunter",
    description: "Compares USDC yields across major Solana DeFi protocols.",
    endpoint: "http://localhost:5001",
    pricePerCall: 0.005,
  },
  {
    service: "risk-auditor",
    description: "Audits a target protocol or token for known risk vectors.",
    endpoint: "http://localhost:5002",
    pricePerCall: 0.0075,
  },
];

const SUGGESTIONS = [
  "auditar contrato inteligente",
  "best APY DeFi",
  "ganancias defi",
  "rugpull screener",
];

function serviceToName(service: string): string {
  return service
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
const solToUsd = (sol: number) => (sol * 150).toFixed(4);
const fmtSol = (sol: number) => sol.toFixed(6);

const MODE_LABELS: Record<Mode, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  hybrid: "Hybrid",
};

const MATCH_COLORS: Record<Mode, string> = {
  keyword: "var(--color-solana-green)",
  semantic: "var(--color-solana-purple)",
  hybrid: "var(--color-solana-cyan, #5cf)",
};

export default function AgentsCatalog() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [agents, setAgents] = useState<Agent[]>(FALLBACK);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const backendUrl = useMemo(() => {
    if (typeof window !== "undefined" && (window as any).__BACKEND_URL__) {
      return (window as any).__BACKEND_URL__ as string;
    }
    return "http://localhost:4000";
  }, []);

  // Carga inicial: lista completa
  useEffect(() => {
    setLoading(true);
    fetch(`${backendUrl}/agents`)
      .then((r) => r.json())
      .then((data: Agent[]) => {
        if (Array.isArray(data) && data.length > 0) setAgents(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Búsqueda con debounce
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();

    if (trimmed.length === 0) {
      // Volver a la lista completa
      debounceRef.current = window.setTimeout(() => {
        setLoading(true);
        fetch(`${backendUrl}/agents`)
          .then((r) => r.json())
          .then((data: Agent[]) => {
            if (Array.isArray(data)) setAgents(data);
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      }, 100);
      return;
    }

    debounceRef.current = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ q: trimmed, mode, limit: "20" });
      fetch(`${backendUrl}/agents?${params}`)
        .then((r) => r.json())
        .then((data: SearchResponse) => {
          if (data && Array.isArray(data.results)) setAgents(data.results);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, mode, backendUrl]);

  const hasQuery = query.trim().length > 0;

  return (
    <div>
      {/* Search bar */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents — try 'auditar contrato' or 'best APY'"
            className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-solana-purple)] transition-colors"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-fg-muted)]">
              ⏳
            </div>
          )}
        </div>

        <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-2 transition-colors ${
                mode === m
                  ? "bg-[var(--color-solana-purple)] text-white"
                  : "bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Suggestions */}
      {!hasQuery && (
        <div className="mb-6 flex flex-wrap gap-2">
          <span className="text-xs text-[var(--color-fg-muted)] mr-1 self-center">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              className="px-3 py-1 rounded-full text-xs border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-solana-purple)] hover:text-[var(--color-fg)] transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {agents.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--color-fg-muted)]">
          {loading ? "Searching…" : `No agents matched "${query}". Try a different phrasing.`}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {agents.map((a) => (
            <div
              key={a.service}
              className="p-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-solana-purple)] transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-base">{serviceToName(a.service)}</h3>
                  <code className="text-xs text-[var(--color-fg-muted)]">{a.service}</code>
                </div>
                <div className="text-right text-sm shrink-0">
                  <div style={{ color: "var(--color-solana-green)" }} className="font-mono">
                    ${solToUsd(a.pricePerCall)}
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)] font-mono">
                    {fmtSol(a.pricePerCall)} SOL
                  </div>
                </div>
              </div>
              <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">{a.description}</p>

              {hasQuery && a.matchType && typeof a.score === "number" && (
                <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center gap-2 text-xs">
                  <span
                    className="px-2 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${MATCH_COLORS[a.matchType]} 15%, transparent)`,
                      color: MATCH_COLORS[a.matchType],
                    }}
                  >
                    {a.matchType}
                  </span>
                  <span className="text-[var(--color-fg-muted)] font-mono">
                    score {(a.score * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
