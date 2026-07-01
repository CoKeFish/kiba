import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { Activity, Bot, Coins, ExternalLink, Plus, Wallet } from "lucide-react";
import "./publisher.css";

const MASCOT = "/agents/triangulo.png";

export default function PublisherOverview() {
  const { t } = useTranslation();
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
          <h1 className="pub-title">{t("publisher.overview.title")}</h1>
          <p className="pub-subtitle">
            {t("publisher.overview.subtitle", { netPct, network: chain.networkLabel })}
          </p>
        </div>
        <div className="pub-actions">
          <Link to="/app/publisher/publish" className="pub-btn pub-btn--primary pub-btn--sm">
            <Plus size={16} />
            {t("publisher.overview.publish_agent")}
          </Link>
        </div>
      </header>

      <section className="pub-card pub-hero">
        <div className="pub-hero__label-row">
          <p className="pub-hero__label">{t("publisher.overview.total_revenue")}</p>
          <span className="pub-live">{t("publisher.overview.live")}</span>
        </div>
        <p className="pub-hero__value pub-hero__value--success">
          {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
        </p>
        <p className="pub-hero__hint">
          {data
            ? t("publisher.overview.hero_hint", {
                amount: (data.totals.earned_asset ?? 0).toFixed(6),
                asset: data.asset,
                feePct,
              })
            : t("publisher.overview.hero_hint_empty")}
        </p>
      </section>

      <div className="pub-kpis">
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.overview.kpi_calls")}</p>
              <p className="pub-kpi__value">
                {isLoading ? "—" : (data?.totals.calls ?? 0).toLocaleString()}
              </p>
              <p className="pub-kpi__hint">{t("publisher.overview.kpi_calls_hint")}</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", color: "var(--color-primary)" }}>
              <Activity size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.overview.kpi_agents")}</p>
              <p className="pub-kpi__value">{isLoading ? "—" : String(data?.totals.agents ?? 0)}</p>
              <p className="pub-kpi__hint">{t("publisher.overview.kpi_agents_hint")}</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--c-purple) 14%, transparent)", color: "var(--c-purple)" }}>
              <Bot size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.overview.kpi_net")}</p>
              <p className="pub-kpi__value pub-kpi__value--ok">
                {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
              </p>
              <p className="pub-kpi__hint">{t("publisher.overview.kpi_net_hint", { netPct })}</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-success) 14%, transparent)", color: "var(--color-success)" }}>
              <Coins size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.overview.kpi_wallet")}</p>
              <p className="pub-kpi__value">{isLoading ? "—" : formatUsd(data?.wallet.usd ?? 0)}</p>
              <p className="pub-kpi__hint">
                {data ? `${(data.wallet.asset_amount ?? 0).toFixed(4)} ${data.asset}` : t("publisher.overview.kpi_wallet_hint_empty")}
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
            <h2 className="pub-card__title">{t("publisher.overview.activity_title")}</h2>
            <p className="pub-card__desc">
              {t("publisher.overview.activity_desc", { feePct, netPct })}
            </p>
          </div>
        </div>
        <div className="pub-card__body pub-card__body--flush-top">
          {isLoading ? (
            <p className="pub-loading">{t("publisher.overview.loading_activity")}</p>
          ) : !data || data.agents.length === 0 ? (
            <div className="pub-empty">
              <img src="/agents/cuadrado.png" alt="" aria-hidden className="pub-empty__mascot" />
              <p className="pub-empty__title">{t("publisher.overview.empty_title")}</p>
              <p className="pub-empty__text">{t("publisher.overview.empty_text")}</p>
              <Link to="/app/publisher/publish" className="pub-btn pub-btn--primary pub-btn--sm" style={{ marginTop: 8 }}>
                <Plus size={14} />
                {t("publisher.overview.publish_first")}
              </Link>
            </div>
          ) : (
            <div className="pub-table-wrap">
              <table className="pub-table">
                <thead>
                  <tr>
                    <th>{t("publisher.overview.th_agent")}</th>
                    <th className="is-right">{t("publisher.overview.th_price")}</th>
                    <th className="is-right">{t("publisher.overview.th_calls")}</th>
                    <th className="is-right">{t("publisher.overview.th_earned")}</th>
                    <th className="is-right">{t("publisher.overview.th_links")}</th>
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
                          {t("publisher.overview.explorer")} <ExternalLink size={12} />
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
          <p className="pub-cta__text">{t("publisher.overview.cta_title")}</p>
          <p className="pub-cta__sub">
            {t("publisher.overview.cta_sub", { netPct, feePct })}
          </p>
        </div>
        <img src={MASCOT} alt="" aria-hidden className="pub-cta__mascot" />
      </section>
    </div>
  );
}
