import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type Transaction } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  formatUsd,
  lamportsToUsd,
  formatKibix,
  baseUnitsToKibix,
  KIBIX_LABEL,
  shortSig,
  explorerUrl,
} from "@/lib/format";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";

type Filter = "all" | "call" | "topup" | "refund";

export default function Transactions() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["transactions", "all"],
    queryFn: () => api.transactions(200),
  });

  const filtered = txs.filter((tx: Transaction) => filter === "all" || tx.type === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("transactions.title")}</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t("transactions.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>{t("transactions.card_title")}</CardTitle>
            <CardDescription>{t("transactions.entries", { count: filtered.length })}</CardDescription>
          </div>
          <div className="flex gap-1">
            {(["all", "call", "topup", "refund"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "subtle"}
                onClick={() => setFilter(f)}
              >
                {t(`transactions.filter.${f}`)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-[var(--color-fg-muted)]">{t("transactions.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-10 text-sm text-[var(--color-fg-muted)] text-center">
              {t("transactions.empty")}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>{t("transactions.col.time")}</Th>
                  <Th>{t("transactions.col.type")}</Th>
                  <Th>{t("transactions.col.service_channel")}</Th>
                  <Th>{t("transactions.col.status")}</Th>
                  <Th className="text-right">{t("transactions.col.amount")}</Th>
                  <Th>{t("transactions.col.tx")}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((tx) => (
                  <Tr key={tx.id}>
                    <Td className="text-xs text-[var(--color-fg-muted)] font-mono whitespace-nowrap">
                      {format(new Date(tx.created_at * 1000), "MMM d, HH:mm:ss")}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          tx.type === "topup" ? "success" : tx.type === "refund" ? "warning" : "info"
                        }
                      >
                        {t(`transactions.type.${tx.type}`, { defaultValue: tx.type })}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="text-sm">{tx.service || "—"}</div>
                      {tx.channel && (
                        <div className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
                          {tx.channel}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          tx.status === "success"
                            ? "success"
                            : tx.status === "failed"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {t(`transactions.status.${tx.status}`, { defaultValue: tx.status })}
                      </Badge>
                    </Td>
                    <Td className="text-right font-mono">
                      <div className={tx.type === "topup" ? "text-[var(--color-success)]" : ""}>
                        {tx.type === "topup" ? "+" : "-"}
                        {formatKibix(baseUnitsToKibix(tx.amount_lamports))} {KIBIX_LABEL}
                      </div>
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        {t("transactions.approx_usd", {
                          usd: formatUsd(lamportsToUsd(tx.amount_lamports)),
                        })}
                      </div>
                    </Td>
                    <Td>
                      {tx.tx_signature ? (
                        <a
                          href={explorerUrl(tx.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-[var(--color-primary)] hover:underline flex items-center gap-1"
                        >
                          {shortSig(tx.tx_signature)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-[var(--color-fg-muted)]">
                          {t("transactions.off_chain")}
                        </span>
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
