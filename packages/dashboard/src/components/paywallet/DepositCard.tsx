/**
 * Depósito retirable: el usuario deja en un canal de pago de Stellar lo que quiera gastar.
 *
 * El depósito sigue siendo suyo: Kiba solo cobra lo consumido. Depositar, recargar y el retiro
 * con espera los firma el usuario con su wallet (Privy o externa); retirar liquida el canal y
 * devuelve el resto a la wallet en la misma transacción. Las transacciones las arma el gateway.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, ExternalLink, Loader2, PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type ChannelStatus, type PreparedTx } from "@/lib/api";
import { chain } from "@/lib/chain";
import { Alert, CopyButton, truncate, usdc, type PayWalletSigner } from "./PayWalletBody";

type Step = "login" | "account" | "trustline" | "open" | "topup" | "liquidate" | "close_start" | "refund";
type Confirm = null | "withdraw" | "exit";

const inputClass =
  "w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]";

export function DepositCard({ privy, external }: { privy: PayWalletSigner | null; external: PayWalletSigner }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: st } = useQuery({ queryKey: ["channel"], queryFn: api.channel, refetchInterval: 15_000 });
  const [step, setStep] = useState<Step | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fundAddress, setFundAddress] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; hash?: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  if (!st?.enabled) return null;
  const ch = st.channel;
  const live = ch && ch.state !== "closed" ? ch : null;
  const signer = live ? (live.kind === "privy" && privy ? privy : external) : null;
  const busy = step !== null;
  const refundReady = live?.state === "closing" && live.refundAt !== null && live.refundAt <= Date.now() / 1000;
  // Sin uso, el depósito se devuelve a la wallet: se avisa en los últimos días.
  const idleSoon =
    live?.state === "open" &&
    live.idleReturnAt !== null &&
    live.idleReturnAt - Date.now() / 1000 < st.idleNoticeDays * 86_400;

  const run = async (fn: () => Promise<{ text: string; hash?: string } | void>) => {
    setErr(null);
    setDone(null);
    setFundAddress(null);
    try {
      const r = await fn();
      if (r) setDone(r);
    } catch (e) {
      if ((e as Error).name !== "Cancelled") setErr((e as Error).message || t("paywallet.err_generic"));
    } finally {
      setStep(null);
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["channel"] });
      qc.invalidateQueries({ queryKey: ["spend"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    }
  };

  const signAndSend = async (s: PayWalletSigner, tx: PreparedTx, address: string) =>
    api.spendSubmit(await s.sign(tx, address));

  /** Monto escrito por el usuario, en USDC. Vacío = el mínimo. */
  const parsedAmount = (fallback: number) => {
    const n = amount.trim() === "" ? fallback : Number(amount);
    if (!(n > 0)) throw new Error(t("deposit.err_amount"));
    return n;
  };

  const open = (s: PayWalletSigner) =>
    run(async () => {
      const n = parsedAmount(st.minDepositBaseUnits / 1e7);
      setStep("login");
      const address = await s.address();
      setStep("account");
      const a = await api.spendActivate(address);
      if (!a.ready && a.tx) {
        setStep("trustline");
        await signAndSend(s, a.tx, address);
      }
      setStep("open");
      let p;
      try {
        p = await api.channelOpen({ address, amount: n, kind: s.kind });
      } catch (e) {
        // Wallet recién creada o sin fondos: mostrar adónde enviar el USDC.
        setFundAddress(address);
        throw e;
      }
      const r = await signAndSend(s, p, address);
      setAmount("");
      return { text: t("deposit.opened"), hash: r.hash };
    });

  const topUp = () =>
    run(async () => {
      if (!signer || !live) return;
      const n = parsedAmount(0);
      setStep("topup");
      const r = await signAndSend(signer, await api.channelTopUp(n), live.address);
      setAmount("");
      setTopUpOpen(false);
      return { text: t("deposit.topped"), hash: r.hash };
    });

  const liquidate = () =>
    run(async () => {
      setStep("liquidate");
      const r = await api.channelLiquidate();
      return {
        text: t("deposit.liquidated", { amount: usdc(r.refundedBaseUnits), paid: usdc(r.paidBaseUnits) }),
        hash: r.hash,
      };
    });

  const exitStart = () =>
    run(async () => {
      if (!signer || !live) return;
      setStep("close_start");
      const r = await signAndSend(signer, await api.channelCloseStart(), live.address);
      return { text: t("deposit.exit_started"), hash: r.hash };
    });

  const refund = () =>
    run(async () => {
      if (!signer || !live) return;
      setStep("refund");
      const p = await api.channelRefund();
      const r = await signAndSend(signer, p, live.address);
      return { text: t("deposit.refunded", { amount: usdc(p.amountBaseUnits) }), hash: r.hash };
    });

  const waitText = (ledgers: number) => {
    const mins = Math.round((ledgers * 5) / 60);
    return mins >= 120 ? t("deposit.wait_h", { n: Math.round(mins / 60) }) : t("deposit.wait_min", { n: Math.max(1, mins) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <PiggyBank size={16} className="text-[var(--color-primary)]" />
          {t("deposit.title")}
          {live && (
            <Badge tone={live.state === "open" ? "success" : "neutral"}>{t(`deposit.state.${live.state}`)}</Badge>
          )}
        </CardTitle>
        <CardDescription>{t("deposit.description")}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {!live ? (
          <div className="space-y-4">
            {ch?.state === "closed" && (
              <p className="text-xs text-[var(--color-fg-muted)]">
                {t(ch.closedReason === "idle" ? "deposit.last_closed_idle" : "deposit.last_closed")}
              </p>
            )}
            <ul className="text-sm text-[var(--color-fg-muted)] list-disc pl-5 space-y-1">
              <li>{t("deposit.point_yours")}</li>
              <li>{t("deposit.point_pay_used")}</li>
              <li>{t("deposit.point_withdraw")}</li>
              <li>{t("deposit.point_no_xlm")}</li>
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="deposit-amount"
                type="number"
                min={st.minDepositBaseUnits / 1e7}
                step="0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(st.minDepositBaseUnits / 1e7)}
                className={inputClass}
                aria-label={t("deposit.amount_label")}
              />
              <span className="text-xs text-[var(--color-fg-muted)]">USDC</span>
              <Button size="sm" onClick={() => open(privy ?? external)} disabled={busy}>
                <ArrowDownToLine size={14} />
                {t("deposit.open")}
              </Button>
            </div>
            <p className="text-xs text-[var(--color-fg-muted)]">
              {t("deposit.min_hint", { amount: usdc(st.minDepositBaseUnits) })}
            </p>
            {privy && (
              <button
                type="button"
                onClick={() => open(external)}
                disabled={busy}
                className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] underline disabled:opacity-50"
              >
                {t("paywallet.use_external")}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] flex-wrap">
              <span>{live.kind === "privy" ? t("paywallet.kind_privy") : t("paywallet.kind_external")}</span>
              <a
                href={chain.explorerAddr(live.address)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline inline-flex items-center gap-1"
              >
                {truncate(live.address)} <ExternalLink size={11} />
              </a>
            </div>

            <dl className="grid grid-cols-3 gap-3 text-sm">
              <Figure label={t("deposit.available")} value={usdc(live.availableBaseUnits)} strong />
              <Figure label={t("deposit.deposited")} value={usdc(live.depositedBaseUnits)} />
              <Figure label={t("deposit.spent")} value={usdc(live.spentBaseUnits)} />
            </dl>

            {idleSoon && (
              <Alert tone="warning">
                {t("deposit.idle_hint", { date: format(new Date(live.idleReturnAt! * 1000), "MMM d") })}
              </Alert>
            )}

            {live.state === "closing" && live.refundAt !== null && (
              <Alert tone="warning">
                {refundReady
                  ? t("deposit.closing_ready")
                  : t("deposit.closing_hint", { date: format(new Date(live.refundAt * 1000), "MMM d, HH:mm") })}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2 items-center">
              {live.state === "open" && (
                <Button size="sm" variant={topUpOpen ? "default" : "subtle"} onClick={() => setTopUpOpen(!topUpOpen)} disabled={busy}>
                  <ArrowDownToLine size={14} />
                  {t("deposit.topup")}
                </Button>
              )}
              {live.state !== "liquidating" && (
                <Button size="sm" variant={confirm === "withdraw" ? "default" : "subtle"} onClick={() => setConfirm("withdraw")} disabled={busy}>
                  <ArrowUpFromLine size={14} />
                  {t("deposit.withdraw")}
                </Button>
              )}
              {refundReady && (
                <Button size="sm" variant="subtle" onClick={refund} disabled={busy}>
                  {t("deposit.refund")}
                </Button>
              )}
              {live.state === "open" && (
                <button
                  type="button"
                  onClick={() => setConfirm("exit")}
                  disabled={busy}
                  className="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] underline disabled:opacity-50"
                >
                  {t("deposit.exit")}
                </button>
              )}
            </div>

            {topUpOpen && live.state === "open" && (
              <div className="rounded-md border border-[var(--color-border)] p-4 flex flex-wrap items-center gap-2">
                <input
                  id="deposit-topup-amount"
                  type="number"
                  min={0}
                  step="0.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputClass}
                  aria-label={t("deposit.amount_label")}
                />
                <span className="text-xs text-[var(--color-fg-muted)]">USDC</span>
                <Button size="sm" onClick={topUp} disabled={busy || !(Number(amount) > 0)}>
                  {t("deposit.topup")}
                </Button>
              </div>
            )}

            {confirm === "withdraw" && (
              <div className="rounded-md border border-[var(--color-border)] p-4 space-y-3 text-sm">
                <p>
                  {t("deposit.withdraw_confirm", {
                    spent: usdc(Math.max(0, live.spentBaseUnits - live.settledBaseUnits)),
                    amount: usdc(live.availableBaseUnits),
                  })}
                </p>
                <div className="flex gap-2 items-center">
                  <Button size="sm" onClick={liquidate} disabled={busy}>
                    {t("deposit.withdraw_yes")}
                  </Button>
                  <button type="button" className="text-xs underline" onClick={() => setConfirm(null)}>
                    {t("paywallet.cancel")}
                  </button>
                </div>
              </div>
            )}

            {confirm === "exit" && (
              <div className="rounded-md border border-[var(--color-border)] p-4 space-y-3 text-sm">
                <p>{t("deposit.exit_hint", { wait: waitText(live.waitLedgers) })}</p>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant="subtle" onClick={exitStart} disabled={busy}>
                    {t("deposit.exit_yes")}
                  </Button>
                  <button type="button" className="text-xs underline" onClick={() => setConfirm(null)}>
                    {t("paywallet.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {ch && st.moves.length > 0 && <Moves moves={st.moves} />}

        {busy && (
          <p className="text-sm text-[var(--color-fg-muted)] inline-flex items-center gap-2" role="status">
            <Loader2 size={14} className="animate-spin" />
            {t(`deposit.step.${step}`)}
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
        {fundAddress && (
          <div className="rounded-md border border-[var(--color-border)] p-3 text-sm space-y-2">
            <p>{t("deposit.need_usdc")}</p>
            <p className="font-mono text-xs break-all">{fundAddress}</p>
            <CopyButton value={fundAddress} label={t("paywallet.copy_address")} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-fg-muted)]">{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-lg font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

function Moves({ moves }: { moves: ChannelStatus["moves"] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="text-xs text-[var(--color-fg-muted)]">{t("deposit.moves")}</p>
      <ul className="text-xs divide-y divide-[var(--color-border)]">
        {moves.map((m, i) => (
          <li key={`${m.txHash}-${m.kind}-${i}`} className="py-1.5 flex items-center gap-2 flex-wrap">
            <span className="min-w-28">{t(`deposit.move.${m.kind}`)}</span>
            <span className="tabular-nums">{m.kind === "close_start" ? "" : `${usdc(m.amount)} USDC`}</span>
            <span className="text-[var(--color-fg-muted)] ml-auto">{format(new Date(m.createdAt * 1000), "MMM d, HH:mm")}</span>
            {m.txHash && (
              <a href={chain.explorerTx(m.txHash)} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
                {t("paywallet.view_tx")} <ExternalLink size={11} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
