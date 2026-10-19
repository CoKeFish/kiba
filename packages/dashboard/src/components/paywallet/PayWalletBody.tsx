/**
 * Vista de la wallet de pagos (sin dependencias de Privy: el firmante llega por props).
 * Ver PayWallet.tsx para el modelo.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type PreparedTx, type SpendStatus } from "@/lib/api";
import { chain } from "@/lib/chain";

export interface PayWalletSigner {
  kind: "privy" | "external";
  /** Dirección de la wallet (puede abrir el login de Privy o el selector de wallets). */
  address(): Promise<string>;
  /** Firma una transacción preparada por el gateway y devuelve el cuerpo para /v1/spend/submit. */
  sign(tx: PreparedTx, address: string): Promise<{ hash: string; signature: string } | { xdr: string }>;
}

type Step = "login" | "account" | "trustline" | "permit" | "withdraw" | "revoke" | "migrate";
type Panel = null | "topup" | "withdraw";

/** USDC con 2–4 decimales, truncando (un saldo nunca debe mostrarse redondeado hacia arriba). */
const usdc = (baseUnits: number) =>
  (Math.trunc(baseUnits / 1e3) / 1e4).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const truncate = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);
const RENEW_WARNING_S = 30 * 86_400;

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
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const linked = Boolean(st.address);
  const active = linked && st.allowanceBaseUnits > 0;
  const signer = st.kind === "privy" ? privy : external;
  const available = Math.max(0, Math.min(st.balanceBaseUnits, st.allowanceBaseUnits) - Math.max(st.debtBaseUnits, 0));
  const expiringSoon = active && st.expiresAt !== null && st.expiresAt - Date.now() / 1000 < RENEW_WARNING_S;

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

  /** Firma y envía una transacción preparada. */
  const signAndSend = async (s: PayWalletSigner, tx: PreparedTx, address: string) =>
    api.spendSubmit(await s.sign(tx, address));

  const permit = async (s: PayWalletSigner, address: string) => {
    setStep("permit");
    const p = await api.spendPrepare({ address, kind: s.kind });
    return signAndSend(s, p, address);
  };

  const activate = (s: PayWalletSigner) =>
    run(async () => {
      setStep("login");
      const address = await s.address();
      setStep("account");
      const a = await api.spendActivate(address);
      if (!a.ready && a.tx) {
        setStep("trustline");
        await signAndSend(s, a.tx, address);
      }
      const r = await permit(s, address);
      return { text: t("paywallet.activated"), hash: r.hash };
    });

  const renew = () =>
    run(async () => {
      if (!signer || !st.address) return;
      const r = await permit(signer, st.address);
      return { text: t("paywallet.renewed"), hash: r.hash };
    });

  const revoke = () =>
    run(async () => {
      if (!signer || !st.address) return;
      setStep("revoke");
      const p = await api.spendPrepare({ address: st.address, amount: 0, kind: signer.kind });
      const r = await signAndSend(signer, p, st.address);
      setConfirmRevoke(false);
      return { text: t("paywallet.revoked"), hash: r.hash };
    });

  const withdraw = () =>
    run(async () => {
      if (!signer || !st.address) return;
      const n = amount.trim() === "" ? undefined : Number(amount);
      if (n !== undefined && !(n > 0)) throw new Error(t("paywallet.err_amount"));
      setStep("withdraw");
      const w = await api.spendWithdraw(to.trim(), n);
      const r = await signAndSend(signer, w, st.address);
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

  const busy = step !== null;
  const stepLabel = step ? t(`paywallet.step.${step}`) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Wallet size={16} className="text-[var(--color-primary)]" />
          {t("paywallet.title")}
          {linked && (
            <Badge tone={st.blocked ? "danger" : active ? "success" : "neutral"}>
              {st.blocked ? t("paywallet.state.blocked") : active ? t("paywallet.state.active") : t("paywallet.state.inactive")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("paywallet.description")}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {!linked ? (
          <div className="space-y-4">
            <ul className="text-sm text-[var(--color-fg-muted)] list-disc pl-5 space-y-1">
              <li>{t("paywallet.point_dedicated")}</li>
              <li>{t("paywallet.point_free_spend")}</li>
              <li>{t("paywallet.point_yours")}</li>
              <li>{t("paywallet.point_no_xlm")}</li>
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              {privy && (
                <Button size="sm" onClick={() => activate(privy)} disabled={busy}>
                  <ShieldCheck size={14} />
                  {t("paywallet.create")}
                </Button>
              )}
              <button
                type="button"
                onClick={() => activate(external)}
                disabled={busy}
                className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] underline disabled:opacity-50"
              >
                {t("paywallet.use_external")}
              </button>
            </div>
            {privy && <p className="text-xs text-[var(--color-fg-muted)]">{t("paywallet.create_hint")}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] flex-wrap">
              <span>{st.kind === "privy" ? t("paywallet.kind_privy") : t("paywallet.kind_external")}</span>
              <a
                href={chain.explorerAddr(st.address!)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline inline-flex items-center gap-1"
              >
                {truncate(st.address!)} <ExternalLink size={11} />
              </a>
              <CopyButton value={st.address!} />
              {privySession && (
                <button type="button" onClick={() => void privySession.logout()} className="ml-auto underline hover:text-[var(--color-fg)]">
                  {t("paywallet.privy_logout")}
                </button>
              )}
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label={t("paywallet.balance")} value={`${usdc(st.balanceBaseUnits)} USDC`} strong />
              <Stat label={t("paywallet.available")} value={active ? `${usdc(available)} USDC` : "—"} />
              <Stat label={t("paywallet.pending")} value={`${usdc(Math.max(st.debtBaseUnits, 0))} USDC`} />
              <Stat
                label={t("paywallet.expires")}
                value={active && st.expiresAt ? format(new Date(st.expiresAt * 1000), "MMM d yyyy") : "—"}
              />
            </dl>
            {active && !st.unlimited && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t("paywallet.capped", { amount: usdc(st.allowanceBaseUnits) })}
              </p>
            )}

            {st.blocked && (
              <Alert tone="danger">{t("paywallet.blocked_hint", { amount: usdc(st.debtBaseUnits) })}</Alert>
            )}
            {!active && <Alert tone="warning">{t("paywallet.inactive_hint")}</Alert>}
            {expiringSoon && <Alert tone="warning">{t("paywallet.expiring_hint")}</Alert>}
            {st.legacy && st.legacy.balanceBaseUnits > 0 && (
              <div className="rounded-md border border-[var(--color-border)] p-3 text-sm space-y-2">
                <p>{t("paywallet.legacy_hint", { amount: usdc(st.legacy.balanceBaseUnits) })}</p>
                <Button size="sm" variant="subtle" onClick={migrate} disabled={busy}>
                  {t("paywallet.legacy_move", { amount: usdc(st.legacy.balanceBaseUnits) })}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={panel === "topup" ? "default" : "subtle"} onClick={() => setPanel(panel === "topup" ? null : "topup")}>
                <ArrowDownToLine size={14} />
                {t("paywallet.topup")}
              </Button>
              <Button
                size="sm"
                variant={panel === "withdraw" ? "default" : "subtle"}
                onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")}
                disabled={busy || st.balanceBaseUnits <= 0}
              >
                <ArrowUpFromLine size={14} />
                {t("paywallet.withdraw")}
              </Button>
              <Button size="sm" variant={expiringSoon || !active ? "default" : "subtle"} onClick={renew} disabled={busy}>
                <ShieldCheck size={14} />
                {active ? t("paywallet.renew") : t("paywallet.reactivate")}
              </Button>
              {active &&
                (confirmRevoke ? (
                  <span className="inline-flex items-center gap-2 text-xs">
                    {t("paywallet.revoke_confirm")}
                    <Button size="sm" variant="subtle" onClick={revoke} disabled={busy}>
                      {t("paywallet.revoke_yes")}
                    </Button>
                    <button type="button" className="underline" onClick={() => setConfirmRevoke(false)}>
                      {t("paywallet.cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(true)}
                    className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] underline"
                  >
                    {t("paywallet.revoke")}
                  </button>
                ))}
            </div>

            {panel === "topup" && (
              <div className="rounded-md border border-[var(--color-border)] p-4 flex flex-col sm:flex-row gap-4 items-start">
                <div className="rounded bg-white p-2">
                  <QRCodeSVG value={st.address!} size={112} />
                </div>
                <div className="text-sm space-y-2 min-w-0">
                  <p>{t("paywallet.topup_hint")}</p>
                  <p className="font-mono text-xs break-all">{st.address}</p>
                  <CopyButton value={st.address!} label={t("paywallet.copy_address")} />
                  <p className="text-xs text-[var(--color-fg-muted)]">{t("paywallet.topup_kit_hint")}</p>
                </div>
              </div>
            )}

            {panel === "withdraw" && (
              <div className="rounded-md border border-[var(--color-border)] p-4 space-y-3">
                <p className="text-sm">{t("paywallet.withdraw_hint")}</p>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={t("paywallet.withdraw_to")}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-[var(--color-primary)]"
                  aria-label={t("paywallet.withdraw_to")}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
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
                  <Button size="sm" onClick={withdraw} disabled={busy || !/^G[A-Z2-7]{55}$/.test(to.trim())}>
                    {t("paywallet.withdraw_button")}
                  </Button>
                </div>
                <p className="text-xs text-[var(--color-fg-muted)]">{t("paywallet.withdraw_note")}</p>
              </div>
            )}

            {st.charges.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1.5">{t("paywallet.charges")}</p>
                <ul className="space-y-1 text-xs">
                  {st.charges.slice(0, 5).map((c, i) => (
                    <li key={i} className="flex items-center gap-2 flex-wrap">
                      <span className="text-[var(--color-fg-muted)] w-28">{format(new Date(c.createdAt * 1000), "MMM d, HH:mm")}</span>
                      <span className="font-mono w-24">{usdc(c.amount)} USDC</span>
                      <Badge tone={c.status === "settled" ? "success" : c.status === "failed" ? "danger" : "neutral"}>
                        {t(`paywallet.charge_status.${c.status}`)}
                      </Badge>
                      {c.txHash && c.status === "settled" && (
                        <a
                          href={chain.explorerTx(c.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                        >
                          {t("paywallet.view_tx")} <ExternalLink size={11} />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {busy && (
          <p className="text-sm text-[var(--color-fg-muted)] inline-flex items-center gap-2" role="status">
            <Loader2 size={14} className="animate-spin" />
            {stepLabel}
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

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-fg-muted)]">{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}

function Alert({ tone, children }: { tone: "danger" | "warning"; children: React.ReactNode }) {
  return (
    <p className={`text-sm flex items-start gap-2 ${tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-warning)]"}`}>
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
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
