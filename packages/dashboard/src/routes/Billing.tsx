import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  formatUsd,
  lamportsToUsd,
  baseUnitsToUsd,
  formatKibix,
  formatKibixLabel,
  usdToKibix,
  baseUnitsToKibix,
  KIBIX_LABEL,
  shortSig,
  explorerUrl,
} from "@/lib/format";
import { format } from "date-fns";
import {
  AlertCircle,
  CreditCard,
  ExternalLink,
  FileText,
  Wallet,
  Zap,
} from "lucide-react";
import { BrebTopup } from "@/components/BrebTopup";
import { RechargeWalletKit } from "@/components/RechargeWalletKit";
import "./billing.css";

const QUICK_AMOUNTS = [5, 10, 25, 50, 100];

const MASCOTS = {
  circulo: "/agents/circulo.png",
  triangulo: "/agents/triangulo.png",
  morado: "/agents/morado.png",
} as const;

export default function Billing() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: balance } = useQuery({ queryKey: ["balance"], queryFn: api.balance });
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: api.wallet });
  const { data: txs = [] } = useQuery({
    queryKey: ["transactions", "billing"],
    queryFn: () => api.transactions(200),
  });
  const topups = txs.filter((t) => t.type === "topup");

  const [amount, setAmount] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (n: number) => api.topup(n),
    onSuccess: (data) => {
      const newBaseUnits = data.new_balance_base_units ?? data.new_balance_lamports;
      setSuccess(
        t("billing.topup_success", {
          added: formatKibixLabel(usdToKibix(amount)),
          new_balance: formatKibixLabel(baseUnitsToKibix(newBaseUnits)),
          usd: formatUsd(baseUnitsToUsd(newBaseUnits)),
        }),
      );
      setError(null);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setTimeout(() => setSuccess(null), 4000);
    },
    onError: (e: Error) => {
      setError(e.message);
      setTimeout(() => setError(null), 4000);
    },
  });

  function submit(n: number) {
    if (!Number.isFinite(n) || n <= 0) {
      setError(t("billing.err_amount_positive"));
      return;
    }
    if (n > 1000) {
      setError(t("billing.err_amount_cap"));
      return;
    }
    mutation.mutate(n);
  }

  return (
    <div className="billing-page">
      <header className="billing-head">
        <h1 className="billing-title">{t("billing.title")}</h1>
        <p className="billing-subtitle">{t("billing.subtitle")}</p>
      </header>

      <div className="billing-grid">
        <div>
          <section className="billing-card billing-balance">
            <div className="billing-balance__row">
              <div>
                <p className="billing-balance__label">{t("billing.available_balance")}</p>
                <p className="billing-balance__value">
                  {balance ? formatKibixLabel(usdToKibix(balance.balance_usd)) : "—"}
                </p>
                <p className="billing-balance__hint">
                  {balance
                    ? t("billing.balance_hint", {
                        usd: formatUsd(balance.balance_usd),
                        kibix_label: KIBIX_LABEL,
                      })
                    : t("billing.balance_hint_short", { kibix_label: KIBIX_LABEL })}
                </p>
              </div>
              <div className="billing-balance__icon">
                <Wallet size={22} strokeWidth={2} />
              </div>
            </div>
          </section>

          <section className="billing-tip">
            <p>
              <strong>{t("billing.tip_title")}</strong>
              {t("billing.tip_body")}
            </p>
            <img src={MASCOTS.circulo} alt="" aria-hidden className="billing-tip__mascot" />
          </section>
        </div>

        {wallet && (
          <RechargeWalletKit
            walletAddress={wallet.pubkey}
            onFunded={() => {
              qc.invalidateQueries({ queryKey: ["balance"] });
              qc.invalidateQueries({ queryKey: ["wallet"] });
            }}
          />
        )}
      </div>

      <section className="billing-card billing-topup">
        <img src={MASCOTS.triangulo} alt="" aria-hidden className="billing-topup__mascot" />
        <h2 className="billing-card__title">
          <Zap size={18} strokeWidth={2.25} />
          {t("billing.topup_title")}
        </h2>
        <p className="billing-card__desc">
          {t("billing.topup_desc", {
            kibix_label: KIBIX_LABEL,
            rate: formatKibix(usdToKibix(1)),
          })}
        </p>

        <div className="billing-amounts">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              type="button"
              className={`billing-amount${amount === q ? " is-active" : ""}`}
              onClick={() => setAmount(q)}
            >
              ${q}
            </button>
          ))}
          <label className="billing-custom">
            {t("billing.custom_label")}
            <input
              type="number"
              min={1}
              max={1000}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
        </div>

        {amount > 0 && (
          <div className="billing-convert">
            {formatUsd(amount)} →{" "}
            <strong>{formatKibixLabel(usdToKibix(amount))}</strong>
          </div>
        )}

        {error && (
          <div className="billing-alert billing-alert--err">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        {success && <div className="billing-alert billing-alert--ok">{success}</div>}

        <button
          type="button"
          className="billing-submit"
          onClick={() => submit(amount)}
          disabled={mutation.isPending || amount <= 0}
        >
          <CreditCard size={16} />
          {mutation.isPending
            ? t("billing.processing")
            : t("billing.add_button", {
                kibix: formatKibixLabel(usdToKibix(amount)),
                usd: formatUsd(amount),
              })}
        </button>
      </section>

      <BrebTopup />

      <section className="billing-card">
        <div className="billing-invoices__head">
          <div>
            <h2 className="billing-card__title">
              <FileText size={18} strokeWidth={2.25} />
              {t("billing.invoices_title")}
            </h2>
            <p className="billing-card__desc" style={{ marginBottom: 0 }}>
              {topups.length === 0
                ? t("billing.no_topups")
                : t("billing.topup_count", { count: topups.length })}
            </p>
          </div>
        </div>
        <div className="billing-invoices__body">
          {topups.length === 0 ? (
            <div className="billing-empty">
              <img src={MASCOTS.morado} alt="" aria-hidden className="billing-empty__mascot" />
              <p className="billing-empty__text">{t("billing.empty_text")}</p>
            </div>
          ) : (
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>{t("billing.th_date")}</th>
                    <th>{t("billing.th_description")}</th>
                    <th>{t("billing.th_type")}</th>
                    <th>{t("billing.th_amount_kibix", { kibix_label: KIBIX_LABEL })}</th>
                    <th>{t("billing.th_amount_usd")}</th>
                    <th>{t("billing.th_status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topups.map((t2) => (
                    <tr key={t2.id}>
                      <td className="billing-table__muted">
                        {format(new Date(t2.created_at * 1000), "MMM d, yyyy HH:mm")}
                      </td>
                      <td>
                        <div>{t2.service || "fake-stripe"}</div>
                        {t2.tx_signature && (
                          <a
                            href={explorerUrl(t2.tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="billing-link billing-table__mono"
                            style={{ fontSize: 11 }}
                          >
                            {shortSig(t2.tx_signature)}
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </td>
                      <td>
                        <span className="billing-badge">{t("billing.badge_topup")}</span>
                      </td>
                      <td className="billing-table__mono billing-table__ok">
                        + {formatKibixLabel(baseUnitsToKibix(t2.amount_lamports))}
                      </td>
                      <td className="billing-table__muted">
                        ≈ {formatUsd(lamportsToUsd(t2.amount_lamports))}
                      </td>
                      <td className="billing-table__ok">{t("billing.status_completed")}</td>
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
