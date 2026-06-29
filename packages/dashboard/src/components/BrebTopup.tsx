/**
 * Recarga con Bre-B (Colombia) — UI sobre el payment provider del gateway.
 *
 * Flujo: elegir monto en COP → generar cobro → mostrar QR + llave Bre-B →
 * el usuario paga por su app bancaria. En sandbox un botón simula el webhook
 * del PSP para acreditar los Kibs y refrescar el saldo.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { api, type PaymentCharge } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatKibs, formatUsd } from "@/lib/format";
import { CheckCircle2, Copy, QrCode, RefreshCw, Smartphone, X } from "lucide-react";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const QUICK_COP = [20_000, 50_000, 100_000, 200_000];

export function BrebTopup() {
  const qc = useQueryClient();
  const [amountCop, setAmountCop] = useState<number>(50_000);
  const [charge, setCharge] = useState<PaymentCharge | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: config } = useQuery({ queryKey: ["payments-config"], queryFn: api.paymentsConfig });

  const kibsFor = (cop: number) =>
    config ? Math.round((cop / config.cop_usd_rate) * config.kibs_per_usd) : 0;

  const create = useMutation({
    mutationFn: () => api.createBrebCharge(amountCop),
    onSuccess: (c) => setCharge(c),
  });

  const simulate = useMutation({
    mutationFn: (id: string) => api.simulateBreb(id),
    onSuccess: (r) => {
      setCharge(r.charge);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  // Poll del estado mientras está pendiente (cubre el pago real por el banco).
  useEffect(() => {
    if (!charge || charge.status !== "pending") return;
    const t = setInterval(async () => {
      try {
        const fresh = await api.getCharge(charge.id);
        if (fresh.status !== "pending") {
          setCharge(fresh);
          qc.invalidateQueries({ queryKey: ["balance"] });
          qc.invalidateQueries({ queryKey: ["transactions"] });
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [charge, qc]);

  const copyLlave = () => {
    const llave = charge?.detail.llave;
    if (!llave) return;
    navigator.clipboard?.writeText(llave).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const reset = () => {
    setCharge(null);
    create.reset();
    simulate.reset();
  };

  // ── Estado: cobro pagado ──
  if (charge && charge.status === "paid") {
    return (
      <Card className="border-[var(--color-success)]">
        <CardBody className="space-y-3 text-center py-8">
          <CheckCircle2 className="w-10 h-10 text-[var(--color-success)] mx-auto" />
          <div className="text-lg font-semibold">¡Pago recibido!</div>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Acreditamos{" "}
            <span className="text-[var(--color-success)] font-semibold">
              {formatKibs(charge.kibs)} Kibs
            </span>{" "}
            a tu saldo ({COP.format(charge.amount_cop)}).
          </p>
          <Button variant="subtle" size="sm" onClick={reset} className="mx-auto">
            Hacer otra recarga
          </Button>
        </CardBody>
      </Card>
    );
  }

  // ── Estado: cobro pendiente (mostrar QR + llave) ──
  if (charge) {
    return (
      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>Paga con Bre-B</CardTitle>
            <CardDescription>
              {COP.format(charge.amount_cop)} ·{" "}
              <span className="text-[var(--color-fg)] font-medium">{formatKibs(charge.kibs)} Kibs</span>
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
            <div className="rounded-2xl border border-[var(--color-border)] p-3 bg-white shrink-0">
              {charge.detail.qrPayload ? (
                <QRCodeSVG value={charge.detail.qrPayload} size={148} level="M" />
              ) : (
                <QrCode className="w-36 h-36 text-[var(--color-fg-subtle)]" />
              )}
            </div>
            <div className="space-y-3 flex-1 w-full">
              <div className="flex items-start gap-2 text-sm text-[var(--color-fg-muted)]">
                <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-primary)]" />
                <span>
                  Abre tu app bancaria, escanea el QR o paga a la llave Bre-B. La
                  acreditación es automática.
                </span>
              </div>
              <div>
                <div className="text-xs text-[var(--color-fg-subtle)] uppercase tracking-wider mb-1">
                  Llave Bre-B
                </div>
                <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2">
                  <span className="font-mono text-sm flex-1">{charge.detail.llave}</span>
                  <Button variant="ghost" size="sm" onClick={copyLlave}>
                    <Copy className="w-3 h-3" />
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-[var(--color-fg-subtle)]">
                Referencia: <span className="font-mono">{charge.reference}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--color-border)]">
            <span className="inline-flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Esperando el pago…
            </span>
            {config?.sandbox && (
              <Button
                size="sm"
                onClick={() => simulate.mutate(charge.id)}
                disabled={simulate.isPending}
              >
                {simulate.isPending ? "Simulando…" : "Simular pago recibido"}
              </Button>
            )}
          </div>
          {config?.sandbox && (
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Modo sandbox: no hay cobro real. El botón simula el webhook del PSP que
              confirmaría un pago Bre-B real.
            </p>
          )}
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
        <CardTitle className="flex items-center gap-2">
          Recarga con Bre-B
          <Badge tone="info">Colombia</Badge>
        </CardTitle>
        <CardDescription>
          Paga en pesos desde tu banco (sin wallet ni cripto). Convertimos a Kibs al instante.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
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
              {formatKibs(kibsFor(amountCop))} Kibs
            </span>{" "}
            <span className="text-xs">(≈ {formatUsd(config ? amountCop / config.cop_usd_rate : 0)})</span>
          </div>
        )}

        {create.isError && (
          <p className="text-sm text-[var(--color-danger)]">{(create.error as Error).message}</p>
        )}

        <Button onClick={() => create.mutate()} disabled={create.isPending || amountCop < 1000}>
          <QrCode className="w-4 h-4" />
          {create.isPending ? "Generando…" : "Generar pago Bre-B"}
        </Button>
      </CardBody>
    </Card>
  );
}
