import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatUsd,
  lamportsToUsd,
  formatKibs,
  formatKibsLabel,
  usdToKibs,
  baseUnitsToKibs,
  KIBS_LABEL,
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
  if (!email) return "there";
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0] ?? local;
  if (!first) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default function Overview() {
  const { user } = useAuth();
  const { data: balance } = useQuery({ queryKey: ["balance"], queryFn: api.balance });
  const { data: txs = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api.transactions(5),
  });

  const callTxs = txs.filter((t) => t.type === "call");
  const totalSpend = callTxs.reduce((acc, t) => acc + lamportsToUsd(t.amount_lamports), 0);
  const name = displayName(user?.email);

  return (
    <div className="overview-page">
      <header className="overview-head">
        <div className="overview-title-wrap">
          <OverviewSparks />
          <h1 className="overview-title">Overview</h1>
        </div>
        <p className="overview-subtitle">A snapshot of your Kiba account.</p>
      </header>

      <section className="overview-welcome">
        <div className="overview-welcome__dots" aria-hidden="true" />
        <div className="overview-welcome__copy">
          <p className="overview-welcome__greeting">Welcome back, {name}! 👋</p>
          <p className="overview-welcome__tagline">Ready to build something amazing?</p>
          <Link to="/app/agents" className="overview-explore-btn">
            <Bot size={17} strokeWidth={2.25} />
            Explore agents
          </Link>
        </div>
        <img
          src={MASCOTS.purple}
          alt=""
          aria-hidden
          className="overview-welcome__mascot"
        />
      </section>

      <div className="overview-kpis">
        <article className="overview-kpi">
          <div className="overview-kpi__row">
            <div>
              <p className="overview-kpi__label">Balance</p>
              <p className="overview-kpi__value">
                {balance ? formatKibsLabel(usdToKibs(balance.balance_usd)) : "—"}
              </p>
              <p className="overview-kpi__hint">
                {balance
                  ? `= ${formatUsd(balance.balance_usd)} · spendable ${KIBS_LABEL}`
                  : `Spendable ${KIBS_LABEL}`}
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
              <p className="overview-kpi__label">Calls (last 5)</p>
              <p className="overview-kpi__value">{callTxs.length}</p>
              <p className="overview-kpi__hint">
                {callTxs.length > 0 ? "Recent activity logged" : "No calls yet"}
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
              <p className="overview-kpi__label">Spend (last 5 calls)</p>
              <p className="overview-kpi__value">{formatKibsLabel(usdToKibs(totalSpend))}</p>
              <p className="overview-kpi__hint">= {formatUsd(totalSpend, 4)} on recent calls</p>
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
            <h2 className="overview-tx-title">Recent transactions</h2>
            <p className="overview-tx-desc">Latest 5 calls, top-ups and refunds.</p>
          </div>
          <Link to="/app/transactions" className="overview-tx-link">
            View all <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="overview-tx-body">
          {txs.length === 0 ? (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--color-fg-muted)", fontFamily: "var(--font-sans)" }}
            >
              No activity yet. Make your first call from a connected channel.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {txs.map((t) => {
                const kibs = formatKibs(baseUnitsToKibs(t.amount_lamports));
                const usd = formatUsd(lamportsToUsd(t.amount_lamports));
                const isTopup = t.type === "topup";

                return (
                  <li key={t.id} className="overview-tx-row">
                    <div className="overview-tx-left">
                      {isTopup && (
                        <span className="overview-tx-plus">
                          <Plus size={16} strokeWidth={2.5} />
                        </span>
                      )}
                      <span className="overview-tx-badge">
                        {isTopup ? "Top up" : t.type}
                      </span>
                      <div className="overview-tx-meta">
                        <p className="overview-tx-service">{t.service || "—"}</p>
                        <p className="overview-tx-time">
                          {formatDistanceToNow(new Date(t.created_at * 1000), { addSuffix: true })}
                          {t.tx_signature && (
                            <>
                              {" · "}
                              <a
                                href={explorerUrl(t.tx_signature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                                style={{ color: "inherit" }}
                              >
                                {shortSig(t.tx_signature)}
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="overview-tx-amount">
                      <div>
                        {isTopup ? "+" : "-"}
                        {kibs} {KIBS_LABEL}
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
            <p className="overview-help__title">Need help getting started?</p>
            <p className="overview-help__text">Check out our docs or reach out to our team.</p>
          </div>
          <div className="overview-help__actions">
            <a
              href="https://github.com/CoKeFish/kiba/tree/main/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="overview-help-btn"
            >
              <BookOpen size={16} />
              View docs
            </a>
            <a href="mailto:support@kiba.dev" className="overview-help-btn">
              <MessageCircle size={16} />
              Contact support
            </a>
          </div>
        </div>
        <img src={MASCOTS.purple} alt="" aria-hidden className="overview-help__mascot" />
      </section>
    </div>
  );
}
