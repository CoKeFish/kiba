import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Transaction } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  formatUsd,
  lamportsToUsd,
  formatKibs,
  baseUnitsToKibs,
  KIBS_LABEL,
  shortSig,
  explorerUrl,
} from "@/lib/format";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";

type Filter = "all" | "call" | "topup" | "refund";

export default function Transactions() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: () => api.transactions(200),
  });

  const filtered = txs.filter((t: Transaction) => filter === "all" || t.type === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Every call, top-up and refund — auditable on Stellar when on-chain mode is active.
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>All transactions</CardTitle>
            <CardDescription>{filtered.length} entries</CardDescription>
          </div>
          <div className="flex gap-1">
            {(["all", "call", "topup", "refund"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "subtle"}
                onClick={() => setFilter(f)}
              >
                {f}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-[var(--color-fg-muted)]">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-10 text-sm text-[var(--color-fg-muted)] text-center">No transactions yet.</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Time</Th>
                  <Th>Type</Th>
                  <Th>Service / Channel</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Tx</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((t) => (
                  <Tr key={t.id}>
                    <Td className="text-xs text-[var(--color-fg-muted)] font-mono whitespace-nowrap">
                      {format(new Date(t.created_at * 1000), "MMM d, HH:mm:ss")}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          t.type === "topup" ? "success" : t.type === "refund" ? "warning" : "info"
                        }
                      >
                        {t.type}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="text-sm">{t.service || "—"}</div>
                      {t.channel && (
                        <div className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
                          {t.channel}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          t.status === "success"
                            ? "success"
                            : t.status === "failed"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {t.status}
                      </Badge>
                    </Td>
                    <Td className="text-right font-mono">
                      <div className={t.type === "topup" ? "text-[var(--color-success)]" : ""}>
                        {t.type === "topup" ? "+" : "-"}
                        {formatKibs(baseUnitsToKibs(t.amount_lamports))} {KIBS_LABEL}
                      </div>
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        ≈ {formatUsd(lamportsToUsd(t.amount_lamports))}
                      </div>
                    </Td>
                    <Td>
                      {t.tx_signature ? (
                        <a
                          href={explorerUrl(t.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-[var(--color-primary)] hover:underline flex items-center gap-1"
                        >
                          {shortSig(t.tx_signature)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--color-fg-muted)]">off-chain</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
