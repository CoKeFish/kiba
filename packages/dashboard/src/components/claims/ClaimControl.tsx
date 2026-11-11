/**
 * Reclamo de una llamada del historial.
 *
 * Mientras la ganancia de esa llamada no se haya liberado al publicador, el usuario puede
 * reclamarla contando qué pasó. Después muestra en qué quedó el reclamo.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type ClaimInfo } from "@/lib/api";
import { formatUsd, lamportsToUsd } from "@/lib/format";

export function ClaimControl({ transactionId, info }: { transactionId: number; info: ClaimInfo | undefined }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const send = useMutation({
    mutationFn: () => api.createClaim(transactionId, reason),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["claims-info"] });
    },
  });

  if (!info) return <span className="text-xs text-[var(--color-fg-muted)]">—</span>;

  if (info.claim) {
    const c = info.claim;
    return (
      <div className="space-y-1">
        <Badge tone={c.status === "refunded" ? "success" : c.status === "rejected" ? "neutral" : "warning"} className="whitespace-nowrap">
          {t(`claims.status.${c.status}`)}
        </Badge>
        {c.status === "refunded" && (
          <div className="text-xs text-[var(--color-fg-muted)]">
            {t("claims.refunded_amount", { usd: formatUsd(lamportsToUsd(c.refundedBaseUnits)) })}
          </div>
        )}
        {c.note && <div className="text-xs text-[var(--color-fg-muted)] max-w-56">{c.note}</div>}
      </div>
    );
  }

  if (!info.claimable) return <span className="text-xs text-[var(--color-fg-muted)]">{t("claims.window_closed")}</span>;

  if (!open) {
    return (
      <div className="space-y-1">
        <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>
          {t("claims.claim")}
        </Button>
        {info.until && (
          <div className="text-xs text-[var(--color-fg-muted)] whitespace-nowrap">
            {t("claims.until", { date: format(new Date(info.until * 1000), "MMM d") })}
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-2 min-w-56"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <textarea
        id={`claim-reason-${transactionId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder={t("claims.reason_placeholder")}
        aria-label={t("claims.reason_label")}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={send.isPending || reason.trim().length < 10}>
          {send.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("claims.send")}
        </Button>
        <button type="button" className="text-xs underline" onClick={() => setOpen(false)}>
          {t("claims.cancel")}
        </button>
      </div>
      {send.isError && <p className="text-xs text-[var(--color-danger)]">{(send.error as Error).message}</p>}
    </form>
  );
}
