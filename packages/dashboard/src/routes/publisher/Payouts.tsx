import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { Check, Copy, ExternalLink, Info, Wallet } from "lucide-react";
import "./publisher.css";

export default function PublisherPayouts() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });
  const [copied, setCopied] = useState(false);

  const pubkey = data?.wallet.pubkey ?? "";
  const feePct = data?.fee.pct ?? 5;
  const netPct = 100 - feePct;

  const copy = () => {
    navigator.clipboard?.writeText(pubkey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">{t("publisher.payouts.title")}</h1>
          <p className="pub-subtitle">
            {t("publisher.payouts.subtitle", { network: chain.networkLabel, netPct })}
          </p>
        </div>
      </header>

      <div className="pub-kpis pub-kpis--2">
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.payouts.kpi_available")}</p>
              <p className="pub-kpi__value">
                {isLoading ? "—" : formatUsd(data?.wallet.usd ?? 0)}
              </p>
              <p className="pub-kpi__hint">
                {data ? `${(data.wallet.asset_amount ?? 0).toFixed(4)} ${data.asset}` : ""}
              </p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", color: "var(--color-primary)" }}>
              <Wallet size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.payouts.kpi_lifetime")}</p>
              <p className="pub-kpi__value pub-kpi__value--ok">
                {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
              </p>
              <p className="pub-kpi__hint">{t("publisher.payouts.kpi_lifetime_hint", { feePct })}</p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-success) 14%, transparent)", color: "var(--color-success)" }}>
              <Wallet size={20} />
            </div>
          </div>
        </article>
      </div>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">{t("publisher.payouts.wallet_title")}</h2>
            <p className="pub-card__desc">
              {t("publisher.payouts.wallet_desc", { netPct })}
            </p>
          </div>
        </div>
        <div className="pub-card__body">
          <div className="pub-wallet-row">
            <span>{pubkey || "—"}</span>
            <button type="button" className="pub-icon-btn" onClick={copy} disabled={!pubkey} aria-label={t("publisher.payouts.copy_address")}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {pubkey && (
              <a
                href={chain.explorerAddr(pubkey)}
                target="_blank"
                rel="noopener noreferrer"
                className="pub-icon-btn"
                aria-label={t("publisher.payouts.open_explorer")}
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>

          <div className="pub-info" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Info size={18} style={{ flexShrink: 0, color: "var(--color-primary)", marginTop: 2 }} />
            <div>
              {t("publisher.payouts.info", { asset: data?.asset ?? chain.asset })}
            </div>
          </div>

          <button type="button" className="pub-btn pub-btn--primary" style={{ marginTop: 16 }} disabled>
            {t("publisher.payouts.request_payout")}
          </button>
        </div>
      </section>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">{t("publisher.payouts.history_title")}</h2>
            <p className="pub-card__desc">{t("publisher.payouts.history_desc")}</p>
          </div>
        </div>
        <div className="pub-card__body">
          {!data || data.totals.calls === 0 ? (
            <div className="pub-empty">
              <img src="/agents/corazon.png" alt="" aria-hidden className="pub-empty__mascot" />
              <p className="pub-empty__title">{t("publisher.payouts.empty_title")}</p>
              <p className="pub-empty__text">
                {t("publisher.payouts.empty_text")}
              </p>
            </div>
          ) : (
            <div className="pub-table-wrap">
              <table className="pub-table">
                <thead>
                  <tr>
                    <th>{t("publisher.payouts.th_agent")}</th>
                    <th className="is-right">{t("publisher.payouts.th_calls")}</th>
                    <th className="is-right">{t("publisher.payouts.th_earned")}</th>
                    <th>{t("publisher.payouts.th_status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.service}>
                      <td>{serviceToName(a.service)}</td>
                      <td className="is-right">{a.totalCalls.toLocaleString()}</td>
                      <td className="is-right pub-table__ok">
                        {formatUsd(solToUsd(a.totalEarnedSol))}
                      </td>
                      <td>
                        <span className="pub-badge">{t("publisher.payouts.badge_paid")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
