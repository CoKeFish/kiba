import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "keyword" | "semantic" | "hybrid";

type Agent = {
  service: string;
  description: string;
  endpoint: string;
  pricePerCall: number;
  acceptedToken?: string;
  totalCalls?: number;
  source?: string;
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
    endpoint: "",
    pricePerCall: 0.005,
  },
  {
    service: "risk-auditor",
    description: "Audits a target protocol or token for known risk vectors.",
    endpoint: "",
    pricePerCall: 0.0075,
  },
];

const SUGGESTIONS = [
  "audit smart contract",
  "best APY DeFi",
  "yield optimizer",
  "rugpull screener",
];

const MODE_LABELS: Record<Mode, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  hybrid: "Hybrid",
};

const MATCH_COLORS: Record<Mode, string> = {
  keyword: "var(--success)",
  semantic: "var(--accent)",
  hybrid: "var(--blue-300)",
};

function serviceToName(service: string): string {
  return service
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
// Defaults coherentes con los del gateway (SOL_USD_RATE=150, XLM_USD_RATE=0.12).
// Si llega un token desconocido on-chain, asume SOL como antes para no romper.
const RATES: Record<string, number> = { SOL: 150, XLM: 0.12 };
const priceToUsd = (price: number, token?: string) =>
  (price * (RATES[token ?? "SOL"] ?? RATES.SOL)).toFixed(4);
const fmtPrice = (price: number) => price.toFixed(6);

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
    return "https://kiba-data.rodion.com.co";
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`${backendUrl}/agents`)
      .then((r) => r.json())
      .then((data: Agent[]) => {
        if (Array.isArray(data) && data.length > 0) setAgents(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();

    if (trimmed.length === 0) {
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
      {/* Search + mode toggle */}
      <div style={{ marginBottom: 16, display: "flex", flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents — try 'audit contract' or 'best APY'"
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-card)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-1)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color var(--dur-fast) var(--ease-out)",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
          />
          {loading && (
            <div style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
            }}>
              …
            </div>
          )}
        </div>

        <div style={{
          display: "inline-flex",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-default)",
          overflow: "hidden",
        }}>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: "10px 16px",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                transition: "all var(--dur-fast) var(--ease-out)",
                background: mode === m ? "var(--accent)" : "var(--bg-card)",
                color: mode === m ? "#fff" : "var(--fg-3)",
                boxShadow: mode === m ? "0 0 14px color-mix(in srgb, var(--accent) 40%, transparent)" : "none",
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Suggestion chips */}
      {!hasQuery && (
        <div style={{ marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--fg-3)", marginRight: 4 }}>Try:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              style={{
                padding: "5px 14px",
                borderRadius: "var(--radius-pill)",
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: 500,
                border: "1px solid var(--border-default)",
                color: "var(--fg-2)",
                background: "transparent",
                cursor: "pointer",
                transition: "all var(--dur-fast) var(--ease-out)",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--fg-1)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border-default)";
                e.currentTarget.style.color = "var(--fg-2)";
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {agents.length === 0 ? (
        <div style={{
          padding: "48px 0",
          textAlign: "center",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: "var(--fg-3)",
        }}>
          {loading ? "Searching…" : `No results for "${query}". Try a different query.`}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {agents.map((a) => (
            <AgentCard key={a.service} agent={a} hasQuery={hasQuery} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent: a, hasQuery }: { agent: Agent; hasQuery: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        padding: 22,
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${hovered ? "color-mix(in srgb, var(--blue-500) 50%, transparent)" : "var(--border-default)"}`,
        background: "var(--bg-card)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
        boxShadow: hovered ? "0 0 28px color-mix(in srgb, var(--blue-500) 18%, transparent)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--fg-1)",
            marginBottom: 2,
          }}>{serviceToName(a.service)}</div>
          <code style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-3)",
          }}>{a.service}</code>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--success)",
          }}>${priceToUsd(a.pricePerCall, a.acceptedToken)}</div>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-3)",
          }}>{fmtPrice(a.pricePerCall)} {a.acceptedToken ?? "SOL"}</div>
        </div>
      </div>

      <p style={{
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        color: "var(--fg-2)",
        lineHeight: 1.55,
        flex: 1,
      }}>{a.description}</p>

      {hasQuery && a.matchType && typeof a.score === "number" && (
        <div style={{
          paddingTop: 10,
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{
            padding: "3px 10px",
            borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            background: `color-mix(in srgb, ${MATCH_COLORS[a.matchType]} 14%, transparent)`,
            color: MATCH_COLORS[a.matchType],
          }}>
            {a.matchType}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-3)",
          }}>
            score {(a.score * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}
