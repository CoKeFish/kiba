/**
 * Recargar la wallet Privy del usuario conectando una wallet externa (Stellar Wallets Kit)
 * y enviándole USDC directo. Sin memo, sin QR: el saldo on-chain sube y se relee de Horizon.
 *
 * Se monta en Billing junto a los demás métodos de recarga. `walletAddress` = destino = la
 * dirección Privy que expone `/v1/wallet`. Sigue el patrón de BrebTopup (mismo `Card`/`Button`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { chain } from "@/lib/chain";

// `@/lib/stellar-wallet` arrastra @stellar/stellar-sdk + el Wallets Kit (~900 kB). Se importa
// dinámicamente al interactuar, para no inflar el bundle inicial del dashboard.

const QUICK_USDC = [1, 5, 10, 25];

function truncate(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function RechargeWalletKit({
  walletAddress,
  onFunded,
}: {
  walletAddress: string;
  onFunded?: () => void;
}) {
  const { t } = useTranslation();
  const [addr, setAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(5);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const connect = async () => {
    setErr(null);
    setConnecting(true);
    try {
      const { connectStellarWallet } = await import("@/lib/stellar-wallet");
      setAddr(await connectStellarWallet());
    } catch (e) {
      setErr((e as Error).message || t("payments.wallet.connect_error"));
    } finally {
      setConnecting(false);
    }
  };

  const send = async () => {
    if (!addr || amount <= 0) return;
    setErr(null);
    setSending(true);
    try {
      const { sendUsdc } = await import("@/lib/stellar-wallet");
      const h = await sendUsdc({ source: addr, destination: walletAddress, amount });
      setHash(h);
      onFunded?.();
    } catch (e) {
      setErr((e as Error).message || t("payments.wallet.send_error"));
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setHash(null);
    setErr(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet size={16} className="text-[var(--color-primary)]" />
          {t("payments.wallet.title")}
        </CardTitle>
        <CardDescription>{t("payments.wallet.description")}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {hash ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
              <div>
                <div className="font-medium text-[var(--color-success)]">
                  {t("payments.wallet.sent_title")}
                </div>
                <p className="text-[var(--color-fg-muted)]">{t("payments.wallet.sent_body")}</p>
                <a
                  href={chain.explorerTx(hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline mt-1"
                >
                  {t("payments.wallet.view_tx")} <ExternalLink size={12} />
                </a>
              </div>
            </div>
            <Button variant="subtle" size="sm" onClick={reset}>
              {t("payments.wallet.another_topup")}
            </Button>
          </div>
        ) : !addr ? (
          <Button size="sm" onClick={connect} disabled={connecting}>
            <Wallet size={14} />
            {connecting ? t("payments.wallet.connecting") : t("payments.wallet.connect")}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[var(--color-fg-muted)]">
                {t("payments.wallet.connected_label")}{" "}
                <span className="font-mono">{truncate(addr)}</span>
              </span>
              <button
                type="button"
                onClick={() => setAddr(null)}
                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] underline"
              >
                {t("payments.wallet.change")}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {QUICK_USDC.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setAmount(u)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    amount === u
                      ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-fg)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {u} USDC
                </button>
              ))}
              <input
                type="number"
                min={0.1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                aria-label={t("payments.wallet.amount_aria")}
              />
            </div>

            <Button size="sm" onClick={send} disabled={sending || amount <= 0}>
              <Send size={14} className={sending ? "animate-pulse" : ""} />
              {sending ? t("payments.wallet.sending") : t("payments.wallet.send_button", { amount })}
            </Button>
          </div>
        )}

        {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
      </CardBody>
    </Card>
  );
}
