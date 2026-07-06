import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type SettlementRef } from "@/lib/api";
import { formatUsd, shortSig } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName } from "@/components/AgentManager";
import { Check, Coins, Copy, ExternalLink, Info, Loader2, TrendingUp, Wallet } from "lucide-react";
import "./publisher.css";

/** URL del explorer para una ref on-chain de settlement (tx / contract). null = sin link. */
function refUrl(r: SettlementRef): string | null {
  if (r.kind === "tx") return chain.explorerTx(r.ref);
  if (r.kind === "contract") return chain.explorerContract(r.ref);
  return null;
}

export default function PublisherPayouts() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });
  const { data: settleData } = useQuery({
    queryKey: ["publisher-settlements"],
    queryFn: () => api.publisherSettlements(),
    refetchInterval: 20_000,
  });
  const [copied, setCopied] = useState<string | null>(null);

  const feePct = data?.fee.pct ?? 5;
  const netPct = 100 - feePct;
  const autoSettleOn = data?.auto_settle ?? false;

  // Toggle opt-in a la liquidación automática por lotes (cron).
  const autoSettleMut = useMutation({
    mutationFn: (enabled: boolean) => api.setAutoSettle(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["publisher-overview"] }),
  });

  // Liquidación bajo demanda (on-chain vía TW; puede tardar ~1 min).
  const settleMut = useMutation({
    mutationFn: () => api.publisherSettle(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publisher-overview"] });
      qc.invalidateQueries({ queryKey: ["publisher-settlements"] });
    },
  });

  const settleSummary = (() => {
    if (settleMut.isError) return { kind: "error" as const, text: t("publisher.payouts.settle_error") };
    const s = settleMut.data?.settlements;
    if (!s) return null;
    const settled = s.filter((x) => x.status === "settled").length;
    if (settled > 0) return { kind: "ok" as const, text: t("publisher.payouts.settle_success", { count: settled }) };
    return { kind: "muted" as const, text: t("publisher.payouts.settle_none") };
  })();

  // Wallets OWNER (donde caen los payouts); fallback a la custodial si aún no hay agentes.
  const wallets =
    data?.payout?.wallets && data.payout.wallets.length > 0
      ? data.payout.wallets
      : data?.wallet.pubkey
        ? [{ address: data.wallet.pubkey, base_units: 0, asset_amount: 0, usd: 0 }]
        : [];
  const availableUsd = data?.payout?.total_usd ?? data?.wallet.usd ?? 0;
  const availableAsset = data?.payout?.total_asset_amount ?? data?.wallet.asset_amount ?? 0;
  const pendingAsset = data?.totals.pending_asset ?? 0;
  const pendingUsd = data?.totals.pending_usd ?? 0;
  const asset = data?.asset ?? chain.asset;
  // Umbral mínimo para liquidar (viene del gateway; fallback 0.01).
  const minAsset = data?.min_payout?.asset_amount ?? 0.01;

  const settlements = settleData?.settlements ?? [];

  const copy = (address: string) => {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(address);
      setTimeout(() => setCopied(null), 1500);
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

      <div className="pub-kpis pub-kpis--3">
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.payouts.kpi_to_settle")}</p>
              <p className="pub-kpi__value">{isLoading ? "—" : formatUsd(pendingUsd)}</p>
              <p className="pub-kpi__hint">
                {t("publisher.payouts.kpi_to_settle_hint", { min: minAsset.toFixed(2), asset })}
              </p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, var(--color-primary) 14%, transparent)", color: "var(--color-primary)" }}>
              <Coins size={20} />
            </div>
          </div>
        </article>
        <article className="pub-kpi">
          <div className="pub-kpi__row">
            <div>
              <p className="pub-kpi__label">{t("publisher.payouts.kpi_in_wallet")}</p>
              <p className="pub-kpi__value">{isLoading ? "—" : formatUsd(availableUsd)}</p>
              <p className="pub-kpi__hint">
                {data ? `${availableAsset.toFixed(4)} ${asset} · ${t("publisher.payouts.kpi_in_wallet_hint")}` : ""}
              </p>
            </div>
            <div className="pub-kpi__icon" style={{ background: "color-mix(in srgb, #f59e0b 14%, transparent)", color: "#d97706" }}>
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
              <TrendingUp size={20} />
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
          {wallets.map((w) => (
            <div className="pub-wallet-row" key={w.address}>
              <span>{w.address}</span>
              <button type="button" className="pub-icon-btn" onClick={() => copy(w.address)} aria-label={t("publisher.payouts.copy_address")}>
                {copied === w.address ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <a
                href={chain.explorerAddr(w.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="pub-icon-btn"
                aria-label={t("publisher.payouts.open_explorer")}
              >
                <ExternalLink size={14} />
              </a>
            </div>
          ))}
          {wallets.length === 0 && <div className="pub-wallet-row"><span>—</span></div>}

          <div className="pub-info" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Info size={18} style={{ flexShrink: 0, color: "var(--color-primary)", marginTop: 2 }} />
            <div>
              {t("publisher.payouts.info", { asset, min: minAsset.toFixed(2) })}
            </div>
          </div>

          <label className="pub-auto-settle">
            <input
              type="checkbox"
              checked={autoSettleOn}
              disabled={autoSettleMut.isPending || !data}
              onChange={(e) => autoSettleMut.mutate(e.target.checked)}
            />
            <span>
              <span className="pub-auto-settle__title">{t("publisher.payouts.auto_settle_title")}</span>
              <span className="pub-auto-settle__desc">
                {t("publisher.payouts.auto_settle_desc", { netPct })}
              </span>
            </span>
          </label>

          <button
            type="button"
            className="pub-btn pub-btn--primary"
            style={{ marginTop: 16 }}
            onClick={() => settleMut.mutate()}
            disabled={settleMut.isPending}
          >
            {settleMut.isPending ? (
              <>
                <Loader2 size={14} className="pub-spin" /> {t("publisher.payouts.settling")}
              </>
            ) : (
              t("publisher.payouts.request_payout")
            )}
          </button>
          {settleSummary ? (
            <p
              className="pub-settle-msg"
              style={{
                color:
                  settleSummary.kind === "ok"
                    ? "var(--color-success)"
                    : settleSummary.kind === "error"
                      ? "var(--color-danger, #ef4444)"
                      : "var(--color-fg-muted)",
              }}
            >
              {settleSummary.text}
            </p>
          ) : (
            !settleMut.isPending && (
              <p className="pub-settle-msg" style={{ color: "var(--color-fg-muted)" }}>
                {pendingAsset <= 0
                  ? t("publisher.payouts.nothing_pending")
                  : pendingAsset < minAsset
                    ? t("publisher.payouts.below_min", {
                        amount: pendingAsset.toFixed(4),
                        min: minAsset.toFixed(2),
                        asset,
                      })
                    : t("publisher.payouts.pending_hint", {
                        amount: pendingAsset.toFixed(4),
                        asset,
                      })}
              </p>
            )
          )}
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
          {settlements.length === 0 ? (
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
                    <th>{t("publisher.payouts.th_date")}</th>
                    <th>{t("publisher.payouts.th_agent")}</th>
                    <th className="is-right">{t("publisher.payouts.th_amount")}</th>
                    <th>{t("publisher.payouts.th_status")}</th>
                    <th className="is-right">{t("publisher.payouts.th_link")}</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => {
                    const link = s.refs.map((r) => ({ r, url: refUrl(r) })).find((x) => x.url);
                    const badgeKey =
                      s.status === "settled"
                        ? "publisher.payouts.badge_paid"
                        : s.status === "pending"
                          ? "publisher.payouts.badge_pending"
                          : "publisher.payouts.badge_failed";
                    return (
                      <tr key={s.id}>
                        <td>{new Date(s.created_at * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</td>
                        <td>{serviceToName(s.service)}</td>
                        <td className="is-right pub-table__ok">{formatUsd(s.net_usd)}</td>
                        <td>
                          <span className="pub-badge" data-status={s.status}>{t(badgeKey)}</span>
                        </td>
                        <td className="is-right">
                          {link?.url ? (
                            <a href={link.url} target="_blank" rel="noopener noreferrer" className="pub-link">
                              {shortSig(link.r.ref)} <ExternalLink size={12} />
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
