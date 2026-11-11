/**
 * Cola de reclamos, solo para administradores de Kiba.
 *
 * Cada reclamo se rechaza o se devuelve, todo o una parte. Lo devuelto vuelve al usuario por
 * donde pagó y se descuenta de la ganancia retenida del publicador.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Claim } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatUsd, lamportsToUsd } from "@/lib/format";

const inputClass =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]";

export default function AdminClaims() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: claims = [], isLoading } = useQuery({
    queryKey: ["admin-claims"],
    queryFn: api.adminClaims,
    enabled: Boolean(user?.is_admin),
    refetchInterval: 30_000,
  });

  if (user && !user.is_admin) return <Navigate to="/app" replace />;

  const open = claims.filter((c) => c.status === "open");
  const closed = claims.filter((c) => c.status !== "open");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("admin_claims.title")}</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">{t("admin_claims.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin_claims.open_title")}</CardTitle>
          <CardDescription>{t("admin_claims.open_count", { count: open.length })}</CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {isLoading && <p className="text-sm text-[var(--color-fg-muted)]">{t("admin_claims.loading")}</p>}
          {!isLoading && open.length === 0 && (
            <p className="text-sm text-[var(--color-fg-muted)]">{t("admin_claims.empty")}</p>
          )}
          {open.map((c) => (
            <OpenClaim key={c.id} claim={c} />
          ))}
        </CardBody>
      </Card>

      {closed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("admin_claims.closed_title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)] text-sm">
              {closed.map((c) => (
                <li key={c.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge tone={c.status === "refunded" ? "success" : "neutral"}>{t(`claims.status.${c.status}`)}</Badge>
                  <span>{c.service}</span>
                  <span className="text-[var(--color-fg-muted)]">{c.userEmail}</span>
                  <span className="tabular-nums ml-auto">
                    {c.status === "refunded"
                      ? t("claims.refunded_amount", { usd: formatUsd(lamportsToUsd(c.refundedBaseUnits)) })
                      : formatUsd(lamportsToUsd(c.amountBaseUnits))}
                  </span>
                  {c.resolvedAt && (
                    <span className="text-xs text-[var(--color-fg-muted)]">{format(new Date(c.resolvedAt * 1000), "MMM d, HH:mm")}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function OpenClaim({ claim }: { claim: Claim }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const full = claim.amountBaseUnits / 1e7;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const resolve = useMutation({
    mutationFn: (decision: "reject" | "refund") =>
      api.adminResolveClaim(claim.id, {
        decision,
        amount: decision === "refund" && amount.trim() !== "" ? Number(amount) : undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-claims"] }),
  });
  const partial = amount.trim() !== "";
  const invalid = partial && !(Number(amount) > 0 && Number(amount) <= full);

  return (
    <article className="rounded-md border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">{claim.service}</span>
        <span className="tabular-nums">{formatUsd(lamportsToUsd(claim.amountBaseUnits))}</span>
        <span className="text-[var(--color-fg-muted)]">{claim.userEmail}</span>
        <span className="text-xs text-[var(--color-fg-muted)] ml-auto">
          {format(new Date(claim.createdAt * 1000), "MMM d, HH:mm")} · {t("admin_claims.call_id", { id: claim.transactionId })}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{claim.reason}</p>
      <textarea
        id={`claim-note-${claim.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={t("admin_claims.note_placeholder")}
        aria-label={t("admin_claims.note_label")}
        className={`${inputClass} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`claim-amount-${claim.id}`}
          type="number"
          min={0}
          max={full}
          step="0.0001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t("admin_claims.amount_all", { amount: full })}
          aria-label={t("admin_claims.amount_label")}
          className={`${inputClass} w-44`}
        />
        <span className="text-xs text-[var(--color-fg-muted)]">USDC</span>
        <Button size="sm" onClick={() => resolve.mutate("refund")} disabled={resolve.isPending || invalid}>
          {resolve.isPending && <Loader2 size={14} className="animate-spin" />}
          {partial ? t("admin_claims.refund_partial") : t("admin_claims.refund_all")}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => resolve.mutate("reject")} disabled={resolve.isPending}>
          {t("admin_claims.reject")}
        </Button>
      </div>
      {invalid && <p className="text-xs text-[var(--color-danger)]">{t("admin_claims.amount_invalid", { amount: full })}</p>}
      {resolve.isError && <p className="text-xs text-[var(--color-danger)]">{(resolve.error as Error).message}</p>}
    </article>
  );
}
