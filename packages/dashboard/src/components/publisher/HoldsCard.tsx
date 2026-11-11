/**
 * Retenciones del publicador: lo que ganó cada servicio en un período, guardado en un escrow
 * de Trustless Work hasta que vence su plazo. Cada una enlaza a su escrow en el explorador.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import { api, type Hold } from "@/lib/api";
import { chain } from "@/lib/chain";
import { formatUsd, lamportsToUsd } from "@/lib/format";
import { serviceToName } from "@/components/AgentManager";

const day = (unix: number) => format(new Date(unix * 1000), "MMM d");

function when(h: Hold, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (h.status === "released" || h.status === "resolved") return h.releasedAt ? t("holds.paid_on", { date: day(h.releasedAt) }) : "";
  if (h.status === "void") return t("holds.void_hint");
  if (h.releaseAt) return t("holds.release_on", { date: day(h.releaseAt) });
  return t("holds.funding_hint");
}

export function HoldsCard() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ["publisher-holds"], queryFn: api.publisherHolds, refetchInterval: 30_000 });
  if (!data?.enabled) return null;

  return (
    <section className="pub-card">
      <div className="pub-card__head">
        <div>
          <h2 className="pub-card__title">{t("holds.title")}</h2>
          <p className="pub-card__desc">{t("holds.desc")}</p>
        </div>
      </div>
      <div className="pub-card__body">
        {data.holds.length === 0 ? (
          <p className="pub-settle-msg" style={{ color: "var(--color-fg-muted)" }}>
            {t("holds.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {data.holds.map((h) => {
              const net = h.amountBaseUnits - h.refundedBaseUnits;
              return (
                <li key={h.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-32 font-medium">{serviceToName(h.service)}</span>
                  <span className="tabular-nums">{formatUsd(lamportsToUsd(net))}</span>
                  <span className="text-xs text-[var(--color-fg-muted)]">{t(`holds.status.${h.status}`)}</span>
                  <span className="text-xs text-[var(--color-fg-muted)]">{when(h, t)}</span>
                  {h.refundedBaseUnits > 0 && (
                    <span className="text-xs text-[var(--color-fg-muted)]">
                      {t("holds.refunded", { usd: formatUsd(lamportsToUsd(h.refundedBaseUnits)) })}
                    </span>
                  )}
                  {h.escrowId && (
                    <a
                      href={chain.explorerContract(h.escrowId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-xs text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                    >
                      {t("holds.view_escrow")} <ExternalLink size={11} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
