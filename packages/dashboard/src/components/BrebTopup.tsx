/**
 * Recarga fiat (Colombia) sobre el payment provider del gateway.
 *
 * Dos modos según el provider activo:
 *   - sandbox (bre-b-sandbox): QR + llave Bre-B + botón "simular pago" (webhook simulado).
 *   - redirect (wompi): redirige al Web Checkout real de Wompi; al volver con `?id=`
 *     verifica la transacción contra la API y acredita los Kibix.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { api, type PaymentCharge } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatKibix, formatUsd } from "@/lib/format";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const QUICK_COP = [20_000, 50_000, 100_000, 200_000];
const PENDING_KEY = "kiba.payments.pending";

export function BrebTopup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amountCop, setAmountCop] = useState<number>(50_000);
  const [charge, setCharge] = useState<PaymentCharge | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<string>("");

  const { data: config } = useQuery({ queryKey: ["payments-config"], queryFn: api.paymentsConfig });
  const methods = config?.methods ?? [];

  // Selecciona el primer método cuando llega la config.
  useEffect(() => {
    if (!selectedProvider && methods.length > 0) setSelectedProvider(methods[0].provider);
  }, [methods, selectedProvider]);

  const selected = methods.find((m) => m.provider === selectedProvider) ?? methods[0];
  const isRedirect = selected?.mode === "redirect";
  const isStripe = selected?.provider === "stripe";

  const kibixFor = (cop: number) =>
    config ? Math.round((cop / config.cop_usd_rate) * config.kibix_per_usd) : 0;

  const create = useMutation({
    mutationFn: () =>
      api.createCharge(
        selected?.provider ?? "bre-b-sandbox",
        amountCop,
        `${window.location.origin}/app/billing`,
      ),
    onSuccess: (c) => {
      if (c.detail.checkoutUrl) {
        // Redirect provider (Wompi): guardamos el cobro y vamos al checkout.
        try {
          localStorage.setItem(PENDING_KEY, JSON.stringify({ chargeId: c.id }));
        } catch {
          /* ignore */
        }
        window.location.href = c.detail.checkoutUrl;
      } else {
        setCharge(c);
      }
    },
  });

  const simulate = useMutation({
    mutationFn: (id: string) => api.simulateBreb(id),
    onSuccess: (r) => {
      setCharge(r.charge);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  // Depósito cripto (Stellar): verifica on-chain por memo y acredita si llegó.
  const verifyDeposit = useMutation({
    mutationFn: (id: string) => api.verifyPayment(id, ""),
    onSuccess: (r) => {
      setCharge(r.charge);
      if (r.charge.status === "paid") {
        qc.invalidateQueries({ queryKey: ["balance"] });
        qc.invalidateQueries({ queryKey: ["transactions"] });
      }
    },
  });

  // Retorno del checkout de Wompi: ?id=<txId> + cobro guardado → verificar y acreditar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Wompi devuelve ?id=<txId>; Stripe ?session_id=<id>; PayPal ?token=<orderId>.
    const txId = params.get("id") || params.get("session_id") || params.get("token");
    let pending: { chargeId?: string } = {};
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
    } catch {
      /* ignore */
    }
    if (!txId || !pending.chargeId) return;

    (async () => {
      setVerifyMsg(t("payments.breb.verifying"));
      try {
        const r = await api.verifyPayment(pending.chargeId!, txId);
        setCharge(r.charge);
        if (r.charge.status === "paid") {
          qc.invalidateQueries({ queryKey: ["balance"] });
          qc.invalidateQueries({ queryKey: ["transactions"] });
          setVerifyMsg(null);
        } else {
          setVerifyMsg(t("payments.breb.payment_status_retry", { status: r.status }));
        }
      } catch (e) {
        setVerifyMsg((e as Error).message);
      } finally {
        localStorage.removeItem(PENDING_KEY);
        // Limpia el ?id= de la URL sin recargar.
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
  }, [qc]);

  const copyLlave = () => {
    const llave = charge?.detail.llave;
    if (!llave) return;
    navigator.clipboard?.writeText(llave).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Poll del estado mientras está pendiente. Depósito cripto (Stellar) → verifica
  // on-chain por memo; sandbox QR → lee el estado del cobro.
  useEffect(() => {
    if (!charge || charge.status !== "pending" || charge.detail.checkoutUrl) return;
    const isDeposit = !!charge.detail.depositAddress;
    const timer = setInterval(async () => {
      try {
        const fresh = isDeposit
          ? (await api.verifyPayment(charge.id, "")).charge
          : await api.getCharge(charge.id);
        if (fresh.status !== "pending") {
          setCharge(fresh);
          qc.invalidateQueries({ queryKey: ["balance"] });
          qc.invalidateQueries({ queryKey: ["transactions"] });
        }
      } catch {
        /* ignore */
      }
    }, isDeposit ? 6000 : 3000);
    return () => clearInterval(timer);
  }, [charge, qc]);

  const copyText = (text?: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const reset = () => {
    setCharge(null);
    setVerifyMsg(null);
    create.reset();
    simulate.reset();
    verifyDeposit.reset();
  };

  // ── Estado: pagado ──
  if (charge && charge.status === "paid") {
    return (
      <Card className="border-[var(--color-success)]">
        <CardBody className="space-y-3 text-center py-8">
          <CheckCircle2 className="w-10 h-10 text-[var(--color-success)] mx-auto" />
          <div className="text-lg font-semibold">{t("payments.breb.paid_title")}</div>
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t("payments.breb.paid_credited_before")}{" "}
            <span className="text-[var(--color-success)] font-semibold">
              {formatKibix(charge.kibix)} Kibix
            </span>{" "}
            {t("payments.breb.paid_credited_after", { cop: COP.format(charge.amount_cop) })}
          </p>
          <Button variant="subtle" size="sm" onClick={reset} className="mx-auto">
            {t("payments.breb.another_topup")}
          </Button>
        </CardBody>
      </Card>
    );
  }

  // ── Estado: verificando el retorno de Wompi ──
  if (verifyMsg) {
    return (
      <Card>
        <CardBody className="space-y-3 text-center py-8">
          <RefreshCw className="w-7 h-7 text-[var(--color-primary)] mx-auto animate-spin" />
          <p className="text-sm text-[var(--color-fg-muted)]">{verifyMsg}</p>
          <Button variant="ghost" size="sm" onClick={reset} className="mx-auto">
            {t("payments.breb.back")}
          </Button>
        </CardBody>
      </Card>
    );
  }

  // ── Estado: depósito cripto pendiente (Stellar USDC) ──
  if (charge && charge.detail.depositAddress) {
    const d = charge.detail;
    // QR escaneable por wallets Stellar (SEP-0007): prefiere monto + memo.
    const sep7 =
      `web+stellar:pay?destination=${d.depositAddress}` +
      `&amount=${d.amountUsdc ?? charge.amount_usd}` +
      `&asset_code=${d.asset ?? "USDC"}` +
      (charge.detail.memo ? `&memo=${encodeURIComponent(charge.detail.memo)}&memo_type=MEMO_TEXT` : "");
    return (
      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>{t("payments.breb.deposit_title", { network: d.network ?? "Stellar" })}</CardTitle>
            <CardDescription>
              {t("payments.breb.deposit_send_before")}{" "}
              <span className="text-[var(--color-fg)] font-medium">
                {(d.amountUsdc ?? charge.amount_usd).toFixed(2)} {d.asset ?? "USDC"}
              </span>{" "}
              → {formatKibix(charge.kibix)} Kibix
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
            <div className="rounded-2xl border border-[var(--color-border)] p-3 bg-white shrink-0">
              <QRCodeSVG value={sep7} size={148} level="M" />
            </div>
            <div className="space-y-3 flex-1 w-full min-w-0">
              <div>
                <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-wider mb-1">
                  {t("payments.breb.address_label", { network: d.network ?? "Stellar" })}
                </div>
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2">
                  <span className="font-mono text-xs flex-1 truncate">{d.depositAddress}</span>
                  <Button variant="ghost" size="sm" onClick={() => copyText(d.depositAddress)}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-wider mb-1">
                  {t("payments.breb.memo_label")}
                </div>
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-warning)] px-3 py-2">
                  <span className="font-mono text-sm flex-1 truncate">{charge.detail.memo}</span>
                  <Button variant="ghost" size="sm" onClick={() => copyText(charge.detail.memo)}>
                    <Copy className="w-3 h-3" />
                    {copied ? t("payments.breb.copied") : t("payments.breb.copy")}
                  </Button>
                </div>
                <p className="text-xs text-[var(--color-warning)] mt-1">
                  {t("payments.breb.memo_warning")}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--color-border)]">
            <span className="inline-flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {t("payments.breb.waiting_onchain")}
            </span>
            <Button
              size="sm"
              onClick={() => verifyDeposit.mutate(charge.id)}
              disabled={verifyDeposit.isPending}
            >
              {verifyDeposit.isPending
                ? t("payments.breb.verifying_short")
                : t("payments.breb.already_sent_verify")}
            </Button>
          </div>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            {t("payments.breb.deposit_note", { network: d.network ?? "Stellar" })}
          </p>
        </CardBody>
      </Card>
    );
  }

  // ── Estado: cobro QR pendiente (sandbox) ──
  if (charge && charge.detail.qrPayload) {
    return (
      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>{t("payments.breb.qr_title")}</CardTitle>
            <CardDescription>
              {COP.format(charge.amount_cop)} ·{" "}
              <span className="text-[var(--color-fg)] font-medium">
                {formatKibix(charge.kibix)} Kibix
              </span>
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
            <div className="rounded-2xl border border-[var(--color-border)] p-3 bg-white shrink-0">
              <QRCodeSVG value={charge.detail.qrPayload} size={148} level="M" />
            </div>
            <div className="space-y-3 flex-1 w-full">
              <div className="flex items-start gap-2 text-sm text-[var(--color-fg-muted)]">
                <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-primary)]" />
                <span>{t("payments.breb.qr_instructions")}</span>
              </div>
              <div>
                <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-wider mb-1">
                  {t("payments.breb.llave_label")}
                </div>
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2">
                  <span className="font-mono text-sm flex-1">{charge.detail.llave}</span>
                  <Button variant="ghost" size="sm" onClick={copyLlave}>
                    <Copy className="w-3 h-3" />
                    {copied ? t("payments.breb.copied") : t("payments.breb.copy")}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-[var(--color-fg-subtle)]">
                {t("payments.breb.reference_label")}{" "}
                <span className="font-mono">{charge.reference}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--color-border)]">
            <span className="inline-flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {t("payments.breb.waiting_payment")}
            </span>
            <Button size="sm" onClick={() => simulate.mutate(charge.id)} disabled={simulate.isPending}>
              {simulate.isPending
                ? t("payments.breb.simulating")
                : t("payments.breb.simulate_payment")}
            </Button>
          </div>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            {t("payments.breb.sandbox_note")}
          </p>
          {simulate.isError && (
            <p className="text-sm text-[var(--color-danger)]">{(simulate.error as Error).message}</p>
          )}
        </CardBody>
      </Card>
    );
  }

  // ── Estado: elegir monto ──
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("payments.breb.recharge_title")}</CardTitle>
        <CardDescription>
          {t("payments.breb.recharge_desc")}
          {isStripe
            ? t("payments.breb.recharge_desc_stripe")
            : selected?.country === "CO"
              ? t("payments.breb.recharge_desc_co")
              : ""}
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Selector de método (Bre-B / Tarjeta / …) */}
        {methods.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => {
              const active = m.provider === selected?.provider;
              return (
                <button
                  key={m.provider}
                  type="button"
                  onClick={() => {
                    setSelectedProvider(m.provider);
                    create.reset();
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-fg)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {m.label}
                  {m.country ? ` · ${m.country}` : ""}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {QUICK_COP.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setAmountCop(c)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                amountCop === c
                  ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-fg)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-primary)]"
              }`}
            >
              {COP.format(c)}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-fg-muted)]">COP</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={amountCop}
              onChange={(e) => setAmountCop(Math.floor(Number(e.target.value) || 0))}
              className="w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
            />
          </div>
        </div>

        {amountCop >= 1000 && (
          <div className="text-sm text-[var(--color-fg-muted)]">
            {COP.format(amountCop)} →{" "}
            <span className="font-semibold text-[var(--color-fg)]">
              {formatKibix(kibixFor(amountCop))} Kibix
            </span>{" "}
            <span className="text-xs">
              (≈ {formatUsd(config ? amountCop / config.cop_usd_rate : 0)})
            </span>
          </div>
        )}

        {create.isError && (
          <p className="text-sm text-[var(--color-danger)]">{(create.error as Error).message}</p>
        )}

        <Button onClick={() => create.mutate()} disabled={create.isPending || amountCop < 1000}>
          {isRedirect ? <ExternalLink className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
          {create.isPending
            ? isRedirect
              ? t("payments.breb.redirecting")
              : t("payments.breb.generating")
            : t("payments.breb.pay_with", {
                label: selected?.label ?? (isRedirect ? t("payments.breb.checkout_fallback") : "Bre-B"),
              })}
        </Button>
      </CardBody>
    </Card>
  );
}
