import { useEffect, useState } from "react";

type Agent = {
  service: string;
  name: string;
  description: string;
  endpoint: string;
  price_lamports: number;
};

const FALLBACK: Agent[] = [
  {
    service: "yield-hunter",
    name: "Yield Hunter",
    description: "Compares USDC yields across major Solana DeFi protocols.",
    endpoint: "http://localhost:5001",
    price_lamports: 5_000_000,
  },
  {
    service: "risk-auditor",
    name: "Risk Auditor",
    description: "Audits a target protocol or token for known risk vectors.",
    endpoint: "http://localhost:5002",
    price_lamports: 7_500_000,
  },
];

const lamportsToSol = (l: number) => (l / 1_000_000_000).toFixed(6);
const lamportsToUsd = (l: number) => ((l / 1_000_000_000) * 150).toFixed(4);

export default function AgentsCatalog() {
  const [agents, setAgents] = useState<Agent[]>(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url =
      (typeof window !== "undefined" && (window as any).__BACKEND_URL__) ||
      "http://localhost:4000";
    fetch(`${url}/agents`)
      .then((r) => r.json())
      .then((data: Agent[]) => {
        if (Array.isArray(data) && data.length > 0) setAgents(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {agents.map((a) => (
        <div
          key={a.service}
          className="p-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-solana-purple)] transition-colors"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h3 className="font-semibold text-base">{a.name}</h3>
              <code className="text-xs text-[var(--color-fg-muted)]">{a.service}</code>
            </div>
            <div className="text-right text-sm">
              <div style={{ color: "var(--color-solana-green)" }} className="font-mono">
                ${lamportsToUsd(a.price_lamports)}
              </div>
              <div className="text-xs text-[var(--color-fg-muted)] font-mono">
                {lamportsToSol(a.price_lamports)} SOL
              </div>
            </div>
          </div>
          <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">{a.description}</p>
        </div>
      ))}
      {loading && (
        <div className="text-xs text-[var(--color-fg-muted)] col-span-full">Loading from backend…</div>
      )}
    </div>
  );
}
