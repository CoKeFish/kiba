/**
 * La wallet del usuario (sin dependencias de Privy: el firmante llega por props).
 *
 * Aparece cuando el usuario ya firmó algo con una wallet. Sirve para lo que no es el depósito:
 * recibir USDC en ella, enviarlo a otra dirección y traer el saldo de la wallet anterior.
 * Ver PayWallet.tsx para el modelo.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type PreparedTx, type SpendStatus } from "@/lib/api";
import { chain } from "@/lib/chain";

export interface PayWalletSigner {
  kind: "privy" | "external";
  /** Dirección de la wallet (puede abrir el login de Privy o el selector de wallets). */
  address(): Promise<string>;
  /** Firma una transacción preparada por el gateway y devuelve el cuerpo para /v1/spend/submit. */
  sign(tx: PreparedTx, address: string): Promise<{ hash: string; signature: string } | { xdr: string }>;
}

type Step = "withdraw" | "migrate";
type Panel = null | "receive" | "send";

/** USDC con 2–4 decimales, truncando (un saldo nunca debe mostrarse redondeado hacia arriba). */
export const usdc = (baseUnits: number) =>
  (Math.trunc(baseUnits / 1e3) / 1e4).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const truncate = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);

export function PayWalletBody({
  st,
  privy,
  external,
  privySession,
}: {
  st: SpendStatus;
  privy: PayWalletSigner | null;
  external: PayWalletSigner;
  privySession?: { logout: () => Promise<void> } | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; hash?: string } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  if (!st.address) return null;
  const address = st.address;
  const signer = st.kind === "privy" && privy ? privy : external;
  const busy = step !== null;

  const run = async (fn: () => Promise<{ text: string; hash?: string } | void>) => {
    setErr(null);
    setDone(null);
    try {
      const r = await fn();
      if (r) setDone(r);
    } catch (e) {
      if ((e as Error).name !== "Cancelled") setErr((e as Error).message || t("paywallet.err_generic"));
    } finally {
      setStep(null);
      qc.invalidateQueries({ queryKey: ["spend"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    }
  };

  const send = () =>
    run(async () => {
      const n = amount.trim() === "" ? undefined : Number(amount);
      if (n !== undefined && !(n > 0)) throw new Error(t("paywallet.err_amount"));
      setStep("withdraw");
      const w = await api.spendWithdraw(to.trim(), n);
      const r = await api.spendSubmit(await signer.sign(w, address));
      setPanel(null);
      setTo("");
      setAmount("");
      return { text: t("paywallet.withdrawn", { amount: usdc(w.amountBaseUnits) }), hash: r.hash };
    });

  const migrate = () =>
    run(async () => {
      setStep("migrate");
      const r = await api.spendMigrate();
      return { text: t("paywallet.migrated", { amount: usdc(r.amountBaseUnits) }), hash: r.hash };
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Wallet size={16} className="text-[var(--color-primary)]" />
          {t("paywallet.title")}
        </CardTitle>
        <CardDescription>{t("paywallet.description")}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] flex-wrap">
          <span>{st.kind === "privy" ? t("paywallet.kind_privy") : t("paywallet.kind_external")}</span>
          <a
            href={chain.explorerAddr(address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono hover:underline inline-flex items-center gap-1"
          >
            {truncate(address)} <ExternalLink size={11} />
          </a>
          <CopyButton value={address} />
          {privySession && (
            <button type="button" onClick={() => void privySession.logout()} className="ml-auto underline hover:text-[var(--color-fg)]">
              {t("paywallet.privy_logout")}
            </button>
          )}
        </div>

        <p className="text-sm">
          <span className="text-[var(--color-fg-muted)]">{t("paywallet.balance")}: </span>
          <span className="tabular-nums font-semibold">{usdc(st.balanceBaseUnits)} USDC</span>
        </p>

        {st.legacy && st.legacy.balanceBaseUnits > 0 && (
          <div className="rounded-md border border-[var(--color-border)] p-3 text-sm space-y-2">
            <p>{t("paywallet.legacy_hint", { amount: usdc(st.legacy.balanceBaseUnits) })}</p>
            <Button size="sm" variant="subtle" onClick={migrate} disabled={busy}>
              {t("paywallet.legacy_move", { amount: usdc(st.legacy.balanceBaseUnits) })}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={panel === "receive" ? "default" : "subtle"} onClick={() => setPanel(panel === "receive" ? null : "receive")}>
            <ArrowDownToLine size={14} />
            {t("paywallet.topup")}
          </Button>
          <Button
            size="sm"
            variant={panel === "send" ? "default" : "subtle"}
            onClick={() => setPanel(panel === "send" ? null : "send")}
            disabled={busy || st.balanceBaseUnits <= 0}
          >
            <ArrowUpFromLine size={14} />
            {t("paywallet.withdraw")}
          </Button>
        </div>

        {panel === "receive" && (
          <div className="rounded-md border border-[var(--color-border)] p-4 flex flex-col sm:flex-row gap-4 items-start">
            <div className="rounded bg-white p-2">
              <QRCodeSVG value={address} size={112} />
            </div>
            <div className="text-sm space-y-2 min-w-0">
              <p>{t("paywallet.topup_hint")}</p>
              <p className="font-mono text-xs break-all">{address}</p>
              <CopyButton value={address} label={t("paywallet.copy_address")} />
            </div>
          </div>
        )}

        {panel === "send" && (
          <div className="rounded-md border border-[var(--color-border)] p-4 space-y-3">
            <p className="text-sm">{t("paywallet.withdraw_hint", { amount: usdc(st.balanceBaseUnits) })}</p>
            <input
              id="wallet-send-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t("paywallet.withdraw_to")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-[var(--color-primary)]"
              aria-label={t("paywallet.withdraw_to")}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="wallet-send-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("paywallet.withdraw_all")}
                className="w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                aria-label={t("paywallet.withdraw_amount")}
              />
              <span className="text-xs text-[var(--color-fg-muted)]">USDC</span>
              <Button size="sm" onClick={send} disabled={busy || !/^G[A-Z2-7]{55}$/.test(to.trim())}>
                {t("paywallet.withdraw_button")}
              </Button>
            </div>
            <p className="text-xs text-[var(--color-fg-muted)]">{t("paywallet.withdraw_note")}</p>
          </div>
        )}

        {busy && (
          <p className="text-sm text-[var(--color-fg-muted)] inline-flex items-center gap-2" role="status">
            <Loader2 size={14} className="animate-spin" />
            {t(`paywallet.step.${step}`)}
          </p>
        )}
        {done && (
          <p className="text-sm inline-flex items-center gap-2 flex-wrap text-[var(--color-success)]" role="status">
            <CheckCircle2 size={16} />
            {done.text}
            {done.hash && (
              <a href={chain.explorerTx(done.hash)} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                {t("paywallet.view_tx")} <ExternalLink size={11} />
              </a>
            )}
          </p>
        )}
        {err && <Alert tone="danger">{err}</Alert>}
      </CardBody>
    </Card>
  );
}

export function Alert({ tone, children }: { tone: "danger" | "warning"; children: React.ReactNode }) {
  return (
    <p className={`text-sm flex items-start gap-2 ${tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-warning)]"}`}>
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      aria-label={t("paywallet.copy_address")}
    >
      <Copy size={12} />
      {copied ? t("paywallet.copied") : label}
    </button>
  );
}
