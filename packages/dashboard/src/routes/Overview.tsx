import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatUsd,
  lamportsToUsd,
  formatKibix,
  formatKibixLabel,
  usdToKibix,
  baseUnitsToKibix,
  KIBIX_LABEL,
  shortSig,
  explorerUrl,
} from "@/lib/format";
import {
  ArrowUpRight,
  Receipt,
  Wallet,
  Activity,
  Bot,
  BookOpen,
  MessageCircle,
  Plus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ConnectPanel } from "@/components/ConnectPanel";
import "./overview.css";

const MASCOTS = {
  purple: "/agents/morado.png",
  square: "/agents/cuadrado.png",
} as const;

function OverviewSparks() {
  return (
    <svg className="overview-sparks" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <path d="M11 10V3" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 10L17 6" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 10L15 16" stroke="var(--c-purple)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function displayName(email?: string) {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default function Overview() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: balance } = useQuery({ queryKey: ["balance"], queryFn: api.balance });
  const { data: txs = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api.transactions(5),
  });

  const callTxs = txs.filter((t) => t.type === "call");
  const totalSpend = callTxs.reduce((acc, t) => acc + lamportsToUsd(t.amount_lamports), 0);
  const name = displayName(user?.email) || t("overview.default_name");

  return (
    <div className="overview-page">
      <header className="overview-head">
        <div className="overview-title-wrap">
          <OverviewSparks />
          <h1 className="overview-title">{t("overview.title")}</h1>
        </div>
        <p className="overview-subtitle">{t("overview.subtitle")}</p>
      </header>

      <section className="overview-welcome">
        <div className="overview-welcome__dots" aria-hidden="true" />
        <div className="overview-welcome__copy">
          <p className="overview-welcome__greeting">{t("overview.welcome_greeting", { name })}</p>
          <p className="overview-welcome__tagline">{t("overview.welcome_tagline")}</p>
          <Link to="/app/agents" className="overview-explore-btn">
            <Bot size={17} strokeWidth={2.25} />
            {t("overview.explore_agents")}
          </Link>
        </div>
        <img
          src={MASCOTS.purple}
          alt=""
          aria-hidden
          className="overview-welcome__mascot"
        />
      </section>

      <ConnectPanel compact />

      <div className="overview-kpis">
        <article className="overview-kpi">
          <div className="overview-kpi__row">
            <div>
              <p className="overview-kpi__label">{t("overview.kpi_balance_label")}</p>
              <p className="overview-kpi__value">
                {balance ? formatKibixLabel(usdToKibix(balance.balance_usd)) : "—"}
              </p>
              <p className="overview-kpi__hint">
                {balance
                  ? t("overview.kpi_balance_hint", {
                      usd: formatUsd(balance.balance_usd),
                      label: KIBIX_LABEL,
                    })
                  : t("overview.kpi_balance_hint_empty", { label: KIBIX_LABEL })}
              </p>
            </div>
            <div
              className="overview-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                color: "var(--color-primary)",
              }}
            >
              <Wallet size={22} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="overview-kpi">
          <div className="overview-kpi__row">
            <div>
              <p className="overview-kpi__label">{t("overview.kpi_calls_label")}</p>
              <p className="overview-kpi__value">{callTxs.length}</p>
              <p className="overview-kpi__hint">
                {callTxs.length > 0
                  ? t("overview.kpi_calls_hint_active")
                  : t("overview.kpi_calls_hint_empty")}
              </p>
            </div>
            <div
              className="overview-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--c-purple) 14%, transparent)",
                color: "var(--c-purple)",
              }}
            >
              <Activity size={22} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="overview-kpi">
          <div className="overview-kpi__row">
            <div>
              <p className="overview-kpi__label">{t("overview.kpi_spend_label")}</p>
              <p className="overview-kpi__value">{formatKibixLabel(usdToKibix(totalSpend))}</p>
              <p className="overview-kpi__hint">
                {t("overview.kpi_spend_hint", { usd: formatUsd(totalSpend, 4) })}
              </p>
            </div>
            <div
              className="overview-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--color-success) 14%, transparent)",
                color: "var(--color-success)",
              }}
            >
              <Receipt size={22} strokeWidth={2} />
            </div>
          </div>
        </article>
      </div>

      <section className="overview-tx-card">
        <div className="overview-tx-head">
          <div>
            <h2 className="overview-tx-title">{t("overview.tx_title")}</h2>
            <p className="overview-tx-desc">{t("overview.tx_desc")}</p>
          </div>
          <Link to="/app/transactions" className="overview-tx-link">
            {t("overview.tx_view_all")} <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="overview-tx-body">
          {txs.length === 0 ? (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--color-fg-muted)", fontFamily: "var(--font-sans)" }}
            >
              {t("overview.tx_empty")}
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {txs.map((tx) => {
                const kibix = formatKibix(baseUnitsToKibix(tx.amount_lamports));
                const usd = formatUsd(lamportsToUsd(tx.amount_lamports));
                const isTopup = tx.type === "topup";

                return (
                  <li key={tx.id} className="overview-tx-row">
                    <div className="overview-tx-left">
                      {isTopup && (
                        <span className="overview-tx-plus">
                          <Plus size={16} strokeWidth={2.5} />
                        </span>
                      )}
                      <span className="overview-tx-badge">
                        {isTopup ? t("overview.tx_badge_topup") : tx.type}
                      </span>
                      <div className="overview-tx-meta">
                        <p className="overview-tx-service">{tx.service || "—"}</p>
                        <p className="overview-tx-time">
                          {formatDistanceToNow(new Date(tx.created_at * 1000), { addSuffix: true })}
                          {tx.tx_signature && (
                            <>
                              {" · "}
                              <a
                                href={explorerUrl(tx.tx_signature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                                style={{ color: "inherit" }}
                              >
                                {shortSig(tx.tx_signature)}
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="overview-tx-amount">
                      <div>
                        {isTopup ? "+" : "-"}
                        {kibix} {KIBIX_LABEL}
                      </div>
                      <div className="overview-tx-amount-sub">= {usd}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="overview-help">
        <img src={MASCOTS.square} alt="" aria-hidden className="overview-help__mascot" />
        <div className="overview-help__center">
          <div>
            <p className="overview-help__title">{t("overview.help_title")}</p>
            <p className="overview-help__text">{t("overview.help_text")}</p>
          </div>
          <div className="overview-help__actions">
            <a
              href="https://github.com/CoKeFish/kiba/tree/main/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="overview-help-btn"
            >
              <BookOpen size={16} />
              {t("overview.help_view_docs")}
            </a>
            <a href="mailto:support@kiba.dev" className="overview-help-btn">
              <MessageCircle size={16} />
              {t("overview.help_contact")}
            </a>
          </div>
        </div>
        <img src={MASCOTS.purple} alt="" aria-hidden className="overview-help__mascot" />
      </section>
    </div>
  );
}
