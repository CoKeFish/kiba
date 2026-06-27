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
    description: "Compares USDC yields across major DeFi protocols.",
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

// Agentes con página de documentación dedicada en /agents/<service>.
const DOCS_ROUTES: Record<string, string> = {
  firecrawl: "/agents/firecrawl",
};

function serviceToName(service: string): string {
  return service
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
const AVATARS = ["/agents/star.png", "/agents/triangle.png", "/agents/heart.png", "/agents/blob.png", "/agents/circle.png"];
const SERVICE_AVATARS: Record<string, string> = {
  "translator-pro": "/agents/heart.png",
  "price-oracle": "/agents/triangle.png",
  "yield-hunter": "/agents/circle.png",
  "risk-auditor": "/agents/blob.png",
  "code-reviewer": "/agents/star.png",
};
function serviceToAvatar(service: string): string {
  if (SERVICE_AVATARS[service]) return SERVICE_AVATARS[service];
  let h = 0;
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
// Tasa USD demo: USDC ≈ 1.0 (activo de liquidación vía Trustless Work). Token
// desconocido → asume USDC. (XLM queda solo por compat de datos antiguos.)
const RATES: Record<string, number> = { USDC: 1.0, XLM: 0.12 };
const priceToUsd = (price: number, token?: string) =>
  (price * (RATES[token ?? "USDC"] ?? RATES.USDC)).toFixed(4);
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
              background: "var(--bg-inset)",
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
                background: mode === m ? "var(--accent)" : "var(--bg-inset)",
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

      {/* Results — wide list cards */}
      <style>{`
        @keyframes acard-in-left {
          from { opacity: 0; transform: translateX(-28px) rotate(-1.5deg); }
          to { opacity: 1; transform: none; }
        }
        @keyframes acard-in-right {
          from { opacity: 0; transform: translateX(28px) rotate(1.5deg); }
          to { opacity: 1; transform: none; }
        }
        .acard {
          display: grid; grid-template-columns: 56px 1fr auto; gap: 18px; align-items: center;
          background: var(--bg-card); border: 1px solid var(--border-default);
          border-radius: 18px; padding: 16px 22px; position: relative; overflow: hidden;
          transition: transform .25s cubic-bezier(0.34, 1.45, 0.64, 1), border-color .2s var(--ease-out), box-shadow .2s var(--ease-out);
          animation: acard-in-left .5s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .acard:nth-child(even) { animation-name: acard-in-right; }
        .acard:hover { border-color: var(--accent); transform: translateX(8px) rotate(0.3deg); box-shadow: 0 8px 28px color-mix(in srgb, var(--accent) 14%, transparent); }
        @media (prefers-reduced-motion: reduce) { .acard { animation: none; } .acard:hover { transform: none; } }
        @media (max-width: 620px) { .acard { grid-template-columns: 48px 1fr; } .acard-right { grid-column: 2; text-align: left !important; } }
      `}</style>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {agents.map((a, i) => (
            <AgentCard key={a.service} agent={a} hasQuery={hasQuery} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

const ACCENTS = ["var(--c-pink)", "var(--c-yellow)", "var(--c-green)", "var(--c-purple)", "var(--c-teal)"];
const AVATAR_BG = ["#FFF0F9", "#FFFBE6", "#F0FFF0", "#F0EDFF", "#E6FFFE"];

function AgentCard({ agent: a, hasQuery, index }: { agent: Agent; hasQuery: boolean; index: number }) {
  const accent = ACCENTS[index % ACCENTS.length];
  const avatarBg = AVATAR_BG[index % AVATAR_BG.length];
  return (
    <div className="acard" style={{ animationDelay: `${Math.min(index, 8) * 0.06}s` }}>
      {/* Accent bar */}
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accent }} />

      {/* Avatar */}
      <div style={{
        width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
        background: avatarBg,
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}>
        <img src={serviceToAvatar(a.service)} alt="" style={{ width: 46, height: 46, objectFit: "contain" }} />
      </div>

      {/* Body */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800,
          letterSpacing: "-0.02em", color: "var(--fg-1)", marginBottom: 3,
        }}>{serviceToName(a.service)}</div>
        <p style={{
          fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5,
        }}>{a.description}</p>
        {DOCS_ROUTES[a.service] && (
          <a
            href={DOCS_ROUTES[a.service]}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 700,
              color: accent,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginTop: 6,
            }}
          >
            Read the docs →
          </a>
        )}
      </div>

      {/* Right: price + badge */}
      <div className="acard-right" style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--accent)",
        }}>${priceToUsd(a.pricePerCall, a.acceptedToken)}</div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 2,
        }}>{fmtPrice(a.pricePerCall)} {a.acceptedToken ?? "XLM"}</div>
        {hasQuery && a.matchType && typeof a.score === "number" && (
          <span style={{
            display: "inline-block", marginTop: 8,
            padding: "3px 10px", borderRadius: 999,
            fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 700,
            background: `color-mix(in srgb, ${MATCH_COLORS[a.matchType]} 15%, transparent)`,
            color: MATCH_COLORS[a.matchType],
          }}>
            {a.matchType} · {(a.score * 100).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
