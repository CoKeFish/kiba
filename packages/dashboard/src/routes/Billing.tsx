import { useState } from "react";
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
        `+ ${formatKibixLabel(usdToKibix(amount))} added · new balance ${formatKibixLabel(baseUnitsToKibix(newBaseUnits))} (≈ ${formatUsd(baseUnitsToUsd(newBaseUnits))})`,
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
      setError("Amount must be positive");
      return;
    }
    if (n > 1000) {
      setError("Single topup capped at $1000 in demo mode");
      return;
    }
    mutation.mutate(n);
  }

  return (
    <div className="billing-page">
      <header className="billing-head">
        <h1 className="billing-title">Billing</h1>
        <p className="billing-subtitle">Top up credits and review your invoices.</p>
      </header>

      <div className="billing-grid">
        <div>
          <section className="billing-card billing-balance">
            <div className="billing-balance__row">
              <div>
                <p className="billing-balance__label">Available balance</p>
                <p className="billing-balance__value">
                  {balance ? formatKibixLabel(usdToKibix(balance.balance_usd)) : "—"}
                </p>
                <p className="billing-balance__hint">
                  {balance
                    ? `≈ ${formatUsd(balance.balance_usd)} · ${KIBIX_LABEL} are spent on agent calls`
                    : `${KIBIX_LABEL} are spent on agent calls`}
                </p>
              </div>
              <div className="billing-balance__icon">
                <Wallet size={22} strokeWidth={2} />
              </div>
            </div>
          </section>

          <section className="billing-tip">
            <p>
              <strong>Kibix power your agents</strong> — Top up anytime to keep your agents running
              smoothly.
            </p>
            <img src={MASCOTS.circulo} alt="" aria-hidden className="billing-tip__mascot" />
          </section>
        </div>

        <section className="billing-card billing-topup">
          <img src={MASCOTS.triangulo} alt="" aria-hidden className="billing-topup__mascot" />
          <h2 className="billing-card__title">
            <Zap size={18} strokeWidth={2.25} />
            Top up
          </h2>
          <p className="billing-card__desc">
            Pay in dollars — we convert to {KIBIX_LABEL} instantly ($1 ={" "}
            {formatKibix(usdToKibix(1))} {KIBIX_LABEL}). Demo mode adds them instantly; production
            would route through Stripe Checkout.
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
              Custom ($)
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
              ? "Processing…"
              : `Add ${formatKibixLabel(usdToKibix(amount))} (${formatUsd(amount)})`}
          </button>
        </section>
      </div>

      <BrebTopup />

      {wallet && (
        <section className="billing-card">
          <h2 className="billing-card__title">
            <Wallet size={18} strokeWidth={2.25} />
            Recargar tu wallet on-chain
          </h2>
          <p className="billing-card__desc">
            Envía USDC directo a tu wallet Stellar de Kiba desde una wallet externa (Freighter,
            xBull, Albedo…). Se acredita on-chain al instante, sin memo ni QR.
          </p>
          <RechargeWalletKit
            walletAddress={wallet.pubkey}
            onFunded={() => {
              qc.invalidateQueries({ queryKey: ["balance"] });
              qc.invalidateQueries({ queryKey: ["wallet"] });
            }}
          />
        </section>
      )}

      <section className="billing-card">
        <div className="billing-invoices__head">
          <div>
            <h2 className="billing-card__title">
              <FileText size={18} strokeWidth={2.25} />
              Invoices
            </h2>
            <p className="billing-card__desc" style={{ marginBottom: 0 }}>
              {topups.length === 0
                ? "No top-ups yet"
                : `${topups.length} top-up${topups.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="billing-invoices__body">
          {topups.length === 0 ? (
            <div className="billing-empty">
              <img src={MASCOTS.morado} alt="" aria-hidden className="billing-empty__mascot" />
              <p className="billing-empty__text">Your top-ups will appear here.</p>
            </div>
          ) : (
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Amount ({KIBIX_LABEL})</th>
                    <th>Amount (USD)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {topups.map((t) => (
                    <tr key={t.id}>
                      <td className="billing-table__muted">
                        {format(new Date(t.created_at * 1000), "MMM d, yyyy HH:mm")}
                      </td>
                      <td>
                        <div>{t.service || "fake-stripe"}</div>
                        {t.tx_signature && (
                          <a
                            href={explorerUrl(t.tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="billing-link billing-table__mono"
                            style={{ fontSize: 11 }}
                          >
                            {shortSig(t.tx_signature)}
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </td>
                      <td>
                        <span className="billing-badge">topup</span>
                      </td>
                      <td className="billing-table__mono billing-table__ok">
                        + {formatKibixLabel(baseUnitsToKibix(t.amount_lamports))}
                      </td>
                      <td className="billing-table__muted">
                        ≈ {formatUsd(lamportsToUsd(t.amount_lamports))}
                      </td>
                      <td className="billing-table__ok">Completed</td>
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
