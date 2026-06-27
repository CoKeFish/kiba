import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatUsd,
  lamportsToUsd,
  formatKibs,
  formatKibsLabel,
  usdToKibs,
  baseUnitsToKibs,
  KIBS_LABEL,
  shortSig,
  explorerUrl,
} from "@/lib/format";
import { ArrowUpRight, Receipt, Wallet, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function KPI({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">{label}</p>
            <p className="text-2xl font-semibold font-mono">{value}</p>
            {hint && <p className="text-xs text-[var(--color-fg-muted)] mt-1">{hint}</p>}
          </div>
          <Icon className="w-5 h-5 text-[var(--color-fg-muted)]" />
        </div>
      </CardBody>
    </Card>
  );
}

export default function Overview() {
  const { data: balance } = useQuery({ queryKey: ["balance"], queryFn: api.balance });
  const { data: txs = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api.transactions(5),
  });

  const callTxs = txs.filter((t) => t.type === "call");
  const totalSpend = callTxs.reduce((acc, t) => acc + lamportsToUsd(t.amount_lamports), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.015em" }}>Overview</h1>
        <p className="text-sm" style={{ color: "var(--color-fg-subtle)" }}>A snapshot of your account.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KPI
          icon={Wallet}
          label="Balance"
          value={balance ? formatKibsLabel(usdToKibs(balance.balance_usd)) : "—"}
          hint={balance ? `≈ ${formatUsd(balance.balance_usd)} · spendable ${KIBS_LABEL}` : `Spendable ${KIBS_LABEL}`}
        />
        <KPI
          icon={Activity}
          label="Calls (last 5)"
          value={`${callTxs.length}`}
          hint={callTxs.length > 0 ? "Recent activity logged" : "No calls yet"}
        />
        <KPI
          icon={Receipt}
          label="Spend (last 5 calls)"
          value={formatKibsLabel(usdToKibs(totalSpend))}
          hint={`≈ ${formatUsd(totalSpend)} on recent calls`}
        />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>Recent transactions</CardTitle>
            <CardDescription>Latest 5 calls, top-ups and refunds.</CardDescription>
          </div>
          <Link
            to="/app/transactions"
            className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1"
          >
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </CardHeader>
        <CardBody>
          {txs.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)] text-center py-8">
              No activity yet. Make your first call from a connected channel.
            </p>
          ) : (
            <ul className="space-y-2">
              {txs.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Badge tone={t.type === "topup" ? "success" : t.type === "refund" ? "warning" : "info"}>
                      {t.type}
                    </Badge>
                    <div>
                      <div className="text-sm font-medium">{t.service || "—"}</div>
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        {formatDistanceToNow(new Date(t.created_at * 1000), { addSuffix: true })}
                        {t.tx_signature && (
                          <>
                            {" · "}
                            <a
                              href={explorerUrl(t.tx_signature)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {shortSig(t.tx_signature)}
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-mono text-right">
                    <div>
                      {t.type === "topup" ? "+" : "-"}
                      {formatKibs(baseUnitsToKibs(t.amount_lamports))} {KIBS_LABEL}
                    </div>
                    <div className="text-xs text-[var(--color-fg-muted)]">
                      ≈ {formatUsd(lamportsToUsd(t.amount_lamports))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
