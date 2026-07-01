import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { chain } from "@/lib/chain";
import {
  formatUsd,
  formatKibixLabel,
  usdToKibix,
  shortSig,
} from "@/lib/format";
import {
  Check,
  Copy,
  ExternalLink,
  Percent,
  Phone,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import "./platform.css";

const MASCOTS = {
  cuadrado: "/agents/cuadrado.png",
  triangulo: "/agents/triangulo.png",
  circulo: "/agents/circulo.png",
  morado: "/agents/morado.png",
} as const;

const DOCS_URL = "https://github.com/CoKeFish/kiba/tree/main/docs";

function explorerWallet(addr: string): string {
  return chain.explorerAddr(addr);
}

function TreasurySparkline() {
  return (
    <div className="platform-spark" aria-hidden="true">
      <svg viewBox="0 0 140 72" fill="none">
        <path
          d="M4 58 C 28 54, 36 48, 52 42 S 78 28, 96 22 S 118 12, 136 8"
          stroke="var(--color-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="136" cy="8" r="5" fill="var(--color-primary)" />
      </svg>
    </div>
  );
}

export default function Platform() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { data, isFetching, refetch, isLoading } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: api.platformStats,
    refetchInterval: 15_000,
  });

  async function copyAddress(addr: string) {
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isLoading || !data) {
    return (
      <div className="platform-page">
        <header className="platform-head">
          <div>
            <h1 className="platform-title">{t("platform.title")}</h1>
            <p className="platform-subtitle">{t("platform.loading_subtitle")}</p>
          </div>
        </header>
        <p className="platform-loading">{t("platform.loading_body")}</p>
      </div>
    );
  }

  const { treasury, fee, marketplace, lifetime } = data;
  const agentHint =
    marketplace.total_agents > marketplace.total_agents_on_chain
      ? t("platform.agent_hint_fallback", {
          count: marketplace.total_agents - marketplace.total_agents_on_chain,
        })
      : t("platform.agent_hint_active");

  return (
    <div className="platform-page">
      <header className="platform-head">
        <div>
          <h1 className="platform-title">{t("platform.title")}</h1>
          <p className="platform-subtitle">
            {t("platform.subtitle", { pct: fee.pct })}
          </p>
        </div>
        <button
          type="button"
          className="platform-refresh"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? "is-spinning" : ""} />
          {t("platform.refresh")}
        </button>
      </header>

      <section className="platform-treasury">
        <div className="platform-treasury__top">
          <div className="platform-treasury__label-row">
            <p className="platform-treasury__label">{t("platform.treasury_label")}</p>
            <span className="platform-live">{t("platform.live")}</span>
          </div>
          <Wallet size={20} strokeWidth={2} style={{ color: "var(--color-fg-muted)" }} />
        </div>
        <div className="platform-treasury__body">
          <div className="platform-treasury__metrics">
            <p className="platform-treasury__value">
              {formatKibixLabel(usdToKibix(treasury.usd))}
            </p>
            <p className="platform-treasury__hint">
              ≈ {formatUsd(treasury.usd, 2)} · {treasury.asset_amount.toFixed(4)} {chain.asset}
            </p>
            <div className="platform-treasury__addr">
              <span className="platform-treasury__addr-label">{t("platform.treasury_address_label")}</span>
              <a
                href={explorerWallet(treasury.pubkey)}
                target="_blank"
                rel="noopener noreferrer"
                className="platform-treasury__addr-link"
              >
                {shortSig(treasury.pubkey, 5)}
                <ExternalLink size={12} />
              </a>
              <button
                type="button"
                className="platform-copy-btn"
                onClick={() => copyAddress(treasury.pubkey)}
                aria-label={t("platform.copy_treasury_aria")}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <TreasurySparkline />
        </div>
      </section>

      <div className="platform-kpis">
        <article className="platform-kpi">
          <div className="platform-kpi__row">
            <div>
              <p className="platform-kpi__label">{t("platform.kpi_agents_label")}</p>
              <p className="platform-kpi__value">
                {marketplace.total_agents_on_chain.toLocaleString()}
              </p>
              <p className="platform-kpi__hint">{agentHint}</p>
            </div>
            <div
              className="platform-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--c-purple) 14%, transparent)",
                color: "var(--c-purple)",
              }}
            >
              <Users size={20} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="platform-kpi">
          <div className="platform-kpi__row">
            <div>
              <p className="platform-kpi__label">{t("platform.kpi_calls_label")}</p>
              <p className="platform-kpi__value">
                {marketplace.total_calls.toLocaleString()}
              </p>
              <p className="platform-kpi__hint">{t("platform.kpi_calls_hint")}</p>
            </div>
            <div
              className="platform-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                color: "var(--color-primary)",
              }}
            >
              <Phone size={20} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="platform-kpi">
          <div className="platform-kpi__row">
            <div>
              <p className="platform-kpi__label">{t("platform.kpi_volume_label")}</p>
              <p className="platform-kpi__value">
                {formatKibixLabel(usdToKibix(lifetime.total_volume_usd))}
              </p>
              <p className="platform-kpi__hint">
                ≈ {formatUsd(lifetime.total_volume_usd, 2)}
              </p>
            </div>
            <div
              className="platform-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--color-success) 14%, transparent)",
                color: "var(--color-success)",
              }}
            >
              <TrendingUp size={20} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="platform-kpi">
          <div className="platform-kpi__row">
            <div>
              <p className="platform-kpi__label">{t("platform.kpi_fees_label", { pct: fee.pct })}</p>
              <p className="platform-kpi__value platform-kpi__value--fees">
                {formatKibixLabel(usdToKibix(lifetime.estimated_fees_usd))}
              </p>
              <p className="platform-kpi__hint">
                ≈ {formatUsd(lifetime.estimated_fees_usd, 2)}
              </p>
            </div>
            <div
              className="platform-kpi__icon"
              style={{
                background: "color-mix(in srgb, #f59e0b 14%, transparent)",
                color: "#d97706",
              }}
            >
              <Percent size={20} strokeWidth={2} />
            </div>
          </div>
        </article>
      </div>

      <section className="platform-commission">
        <h2 className="platform-commission__title">
          {t("platform.commission_title", { pct: fee.pct })}
        </h2>
        <p className="platform-commission__desc">
          {t("platform.commission_desc")}
        </p>

        <div className="platform-steps">
          <article className="platform-step">
            <img src={MASCOTS.cuadrado} alt="" aria-hidden className="platform-step__mascot" />
            <h3 className="platform-step__title">{t("platform.step1_title")}</h3>
            <p className="platform-step__text">
              {t("platform.step1_text")}
            </p>
          </article>
          <article className="platform-step">
            <img src={MASCOTS.triangulo} alt="" aria-hidden className="platform-step__mascot" />
            <h3 className="platform-step__title">{t("platform.step2_title")}</h3>
            <p className="platform-step__text">
              {t("platform.step2_text", {
                asset: chain.asset,
                pct: (100 - fee.pct).toFixed(0),
              })}
            </p>
          </article>
          <article className="platform-step">
            <img src={MASCOTS.circulo} alt="" aria-hidden className="platform-step__mascot" />
            <h3 className="platform-step__title">{t("platform.step3_title", { pct: fee.pct })}</h3>
            <p className="platform-step__text">
              {t("platform.step3_text", { pct: fee.pct })}
            </p>
          </article>
        </div>

        <p className="platform-banner">
          <strong>{t("platform.banner_strong")}</strong> {t("platform.banner_text")}
        </p>
      </section>

      <section className="platform-cta">
        <div>
          <p className="platform-cta__text">{t("platform.cta_text")}</p>
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="platform-cta-btn">
            {t("platform.cta_learn_more")}
            <ExternalLink size={14} />
          </a>
        </div>
        <img src={MASCOTS.morado} alt="" aria-hidden className="platform-cta__mascot" />
      </section>
    </div>
  );
}
