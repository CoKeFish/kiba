import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { Activity, Bot, Coins, ExternalLink, Plus, Wallet } from "lucide-react";
import "./publisher.css";

const MASCOT = "/agents/triangulo.png";

export default function PublisherOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });

  const feePct = data?.fee.pct ?? 5;
  const netPct = 100 - feePct;

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">Revenue</h1>
          <p className="pub-subtitle">
            Your agents earn {netPct}% of every paid call, settled on {chain.networkLabel}.
          </p>
        </div>
        <div className="pub-actions">
          <Link to="/app/publisher/publish" className="pub-btn pub-btn--primary pub-btn--sm">
            <Plus size={16} />
            Publish agent
          </Link>
        </div>
      </header>

      <section className="pub-card pub-hero">
        <div className="pub-hero__label-row">
          <p className="pub-hero__label">Total revenue</p>
          <span className="pub-live">Live</span>
        </div>
        <p className="pub-hero__value pub-hero__value--success">
          {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
        </p>
        <p className="pub-hero__hint">
          {data
            ? `${(data.totals.earned_asset ?? 0).toFixed(6)} ${data.asset} · after ${feePct}% platform fee`
            : "Lifetime earnings from your agents"}
        </p>
      </section>

      <div className="pub-kpis">
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">Calls completed</p>
              <p className="pub-kpi__value">
                {isLoading ? "—" : (data?.totals.calls ?? 0).toLocaleString()}
              </p>
              <p className="pub-kpi__hint">Lifetime agent calls</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", color: "var(--color-primary)" }}>
              <Activity size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">Active agents</p>
              <p className="pub-kpi__value">{isLoading ? "—" : String(data?.totals.agents ?? 0)}</p>
              <p className="pub-kpi__hint">Published on-chain</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--c-purple) 14%, transparent)", color: "var(--c-purple)" }}>
              <Bot size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">Net earnings</p>
              <p className="pub-kpi__value pub-kpi__value--ok">
                {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
              </p>
              <p className="pub-kpi__hint">You keep {netPct}%</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-success) 14%, transparent)", color: "var(--color-success)" }}>
              <Coins size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">In wallet</p>
              <p className="pub-kpi__value">{isLoading ? "—" : formatUsd(data?.wallet.usd ?? 0)}</p>
              <p className="pub-kpi__hint">
                {data ? `${(data.wallet.asset_amount ?? 0).toFixed(4)} ${data.asset}` : "Available balance"}
              </p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, #f59e0b 14%, transparent)", color: "#d97706" }}>
              <Wallet size={20} />
            </div>
          </div>
        </article>
      </div>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">Recent activity</h2>
            <p className="pub-card__desc">
              Per-agent revenue on-chain. Platform fee: {feePct}% · you keep {netPct}%.
            </p>
          </div>
        </div>
        <div className="pub-card__body pub-card__body--flush-top">
          {isLoading ? (
            <p className="pub-loading">Loading activity…</p>
          ) : !data || data.agents.length === 0 ? (
            <div className="pub-empty">
              <img src="/agents/cuadrado.png" alt="" aria-hidden className="pub-empty__mascot" />
              <p className="pub-empty__title">No agent activity yet</p>
              <p className="pub-empty__text">Publish your first agent to start earning per call.</p>
              <Link to="/app/publisher/publish" className="pub-btn pub-btn--primary pub-btn--sm" style={{ marginTop: 8 }}>
                <Plus size={14} />
                Publish your first agent
              </Link>
            </div>
          ) : (
            <div className="pub-table-wrap">
              <table className="pub-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="is-right">Price</th>
                    <th className="is-right">Calls</th>
                    <th className="is-right">Earned</th>
                    <th className="is-right">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.service}>
                      <td>
                        <div>{serviceToName(a.service)}</div>
                        <div className="pub-table__slug">{a.service}</div>
                      </td>
                      <td className="is-right pub-table__ok">{formatUsd(solToUsd(a.pricePerCallSol))}</td>
                      <td className="is-right">{a.totalCalls.toLocaleString()}</td>
                      <td className="is-right pub-table__ok">{formatUsd(solToUsd(a.totalEarnedSol))}</td>
                      <td className="is-right">
                        <a
                          href={chain.explorerAddr(a.owner)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pub-link"
                        >
                          Explorer <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="pub-cta">
        <div>
          <p className="pub-cta__text">How you earn as a publisher</p>
          <p className="pub-cta__sub">
            Users pay per call via x402. {netPct}% lands in your wallet automatically — Kiba keeps a{" "}
            {feePct}% platform fee on every transaction.
          </p>
        </div>
        <img src={MASCOT} alt="" aria-hidden className="pub-cta__mascot" />
      </section>
    </div>
  );
}
