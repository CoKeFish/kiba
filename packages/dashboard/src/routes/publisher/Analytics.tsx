import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { Activity, Bot, Coins } from "lucide-react";
import "./publisher.css";

const BAR_COLORS = [
  "var(--color-primary)",
  "var(--color-success)",
  "#FFD54A",
  "#FF6EC7",
  "var(--c-purple)",
  "#00D1C2",
];

export default function PublisherAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });

  const agents = (data?.agents ?? []).slice().sort((a, b) => b.totalCalls - a.totalCalls);
  const maxCalls = Math.max(1, ...agents.map((a) => a.totalCalls));
  const totalCalls = data?.totals.calls ?? 0;
  const feePct = data?.fee.pct ?? 5;

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">Analytics</h1>
          <p className="pub-subtitle">Usage across your agents — calls served and revenue share.</p>
        </div>
      </header>

      <div className="pub-kpis pub-kpis--3">
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">Total calls</p>
              <p className="pub-kpi__value">{isLoading ? "—" : totalCalls.toLocaleString()}</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", color: "var(--color-primary)" }}>
              <Activity size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">Total revenue</p>
              <p className="pub-kpi__value pub-kpi__value--ok">
                {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
              </p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-success) 14%, transparent)", color: "var(--color-success)" }}>
              <Coins size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">Active agents</p>
              <p className="pub-kpi__value">{isLoading ? "—" : String(data?.totals.agents ?? 0)}</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--c-purple) 14%, transparent)", color: "var(--c-purple)" }}>
              <Bot size={20} />
            </div>
          </div>
        </article>
      </div>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">Calls over time</h2>
            <p className="pub-card__desc">
              {totalCalls.toLocaleString()} total call{totalCalls !== 1 ? "s" : ""} served
            </p>
          </div>
        </div>
        <div className="pub-card__body">
          {isLoading ? (
            <p className="pub-loading">Loading analytics…</p>
          ) : agents.length === 0 ? (
            <div className="pub-empty">
              <img src="/agents/circulo.png" alt="" aria-hidden className="pub-empty__mascot" />
              <p className="pub-empty__title">No analytics yet</p>
              <p className="pub-empty__text">
                Once your agents start serving paid calls, usage shows up here.
              </p>
            </div>
          ) : (
            <div className="pub-bars">
              {agents.map((a, i) => {
                const pct = (a.totalCalls / maxCalls) * 100;
                const share = totalCalls > 0 ? (a.totalCalls / totalCalls) * 100 : 0;
                return (
                  <div key={a.service}>
                    <div className="pub-bar-row__head">
                      <span className="pub-bar-row__name">{serviceToName(a.service)}</span>
                      <span className="pub-bar-row__meta">
                        {a.totalCalls.toLocaleString()} calls · {share.toFixed(0)}% ·{" "}
                        <span style={{ color: "var(--color-success)" }}>
                          {formatUsd(solToUsd(a.totalEarnedSol))}
                        </span>
                      </span>
                    </div>
                    <div className="pub-bar-track">
                      <div
                        className="pub-bar-fill"
                        style={{
                          width: `${Math.max(2, pct)}%`,
                          background: BAR_COLORS[i % BAR_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">Revenue by agent</h2>
            <p className="pub-card__desc">Top performers by lifetime earnings.</p>
          </div>
        </div>
        <div className="pub-card__body">
          {agents.length === 0 ? (
            <div className="pub-empty">
              <img src="/agents/estrella.png" alt="" aria-hidden className="pub-empty__mascot" />
              <p className="pub-empty__text">No revenue yet.</p>
            </div>
          ) : (
            <div className="pub-tiles">
              {agents.map((a) => (
                <article key={a.service} className="pub-tile">
                  <p className="pub-tile__name">{serviceToName(a.service)}</p>
                  <p className="pub-tile__value">{formatUsd(solToUsd(a.totalEarnedSol))}</p>
                  <p className="pub-tile__hint">{a.totalCalls.toLocaleString()} calls</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="pub-banner">
        <strong>Success rate:</strong> Publishers keep {100 - feePct}% of every paid call — visible
        on-chain after each transaction.
      </p>
    </div>
  );
}
