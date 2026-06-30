import { useState } from "react";
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
            <h1 className="platform-title">Platform Revenue</h1>
            <p className="platform-subtitle">Loading marketplace stats…</p>
          </div>
        </header>
        <p className="platform-loading">Fetching on-chain treasury data…</p>
      </div>
    );
  }

  const { treasury, fee, marketplace, lifetime } = data;
  const agentHint =
    marketplace.total_agents > marketplace.total_agents_on_chain
      ? `+ ${marketplace.total_agents - marketplace.total_agents_on_chain} fallback`
      : "Active and verified";

  return (
    <div className="platform-page">
      <header className="platform-head">
        <div>
          <h1 className="platform-title">Platform Revenue</h1>
          <p className="platform-subtitle">
            Treasury overview and the {fee.pct}% commission Kiba earns on agent usage.
          </p>
        </div>
        <button
          type="button"
          className="platform-refresh"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? "is-spinning" : ""} />
          Refresh
        </button>
      </header>

      <section className="platform-treasury">
        <div className="platform-treasury__top">
          <div className="platform-treasury__label-row">
            <p className="platform-treasury__label">Kiba treasury</p>
            <span className="platform-live">Live</span>
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
              <span className="platform-treasury__addr-label">Treasury address</span>
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
                aria-label="Copy treasury address"
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
              <p className="platform-kpi__label">Agents on-chain</p>
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
              <p className="platform-kpi__label">Total calls</p>
              <p className="platform-kpi__value">
                {marketplace.total_calls.toLocaleString()}
              </p>
              <p className="platform-kpi__hint">Lifetime agent calls</p>
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
              <p className="platform-kpi__label">Lifetime volume</p>
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
              <p className="platform-kpi__label">Lifetime fees ({fee.pct}%)</p>
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
          How the {fee.pct}% commission works
        </h2>
        <p className="platform-commission__desc">
          Hardcoded in the smart contract. No off-chain accounting needed.
        </p>

        <div className="platform-steps">
          <article className="platform-step">
            <img src={MASCOTS.cuadrado} alt="" aria-hidden className="platform-step__mascot" />
            <h3 className="platform-step__title">Agents get calls</h3>
            <p className="platform-step__text">
              Users call agents on the Kiba platform and pay for the service.
            </p>
          </article>
          <article className="platform-step">
            <img src={MASCOTS.triangulo} alt="" aria-hidden className="platform-step__mascot" />
            <h3 className="platform-step__title">Value flows on-chain</h3>
            <p className="platform-step__text">
              Payments are settled on-chain in {chain.asset}. Agents receive{" "}
              {(100 - fee.pct).toFixed(0)}% of the payment.
            </p>
          </article>
          <article className="platform-step">
            <img src={MASCOTS.circulo} alt="" aria-hidden className="platform-step__mascot" />
            <h3 className="platform-step__title">Kiba earns {fee.pct}%</h3>
            <p className="platform-step__text">
              Kiba automatically collects a {fee.pct}% commission and routes it to the treasury.
            </p>
          </article>
        </div>

        <p className="platform-banner">
          <strong>Transparent. On-chain. Sustainable.</strong> All fees are visible on-chain and
          used to improve the platform for everyone.
        </p>
      </section>

      <section className="platform-cta">
        <div>
          <p className="platform-cta__text">
            Treasury funds are used to support ecosystem growth, platform reliability, and future
            rewards for the community.
          </p>
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="platform-cta-btn">
            Learn more
            <ExternalLink size={14} />
          </a>
        </div>
        <img src={MASCOTS.morado} alt="" aria-hidden className="platform-cta__mascot" />
      </section>
    </div>
  );
}
