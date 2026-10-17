import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type CallResult } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { formatKibix, baseUnitsToKibix, KIBIX_LABEL } from "@/lib/format";
import { format } from "date-fns";

export function statusTone(status: CallResult["status"]) {
  return status === "done" ? "success" : status === "error" ? "danger" : "warning";
}

export default function Results() {
  const { t } = useTranslation();
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["results"],
    queryFn: () => api.results(100),
    // Mientras haya llamadas en curso, refresca para que pasen a "listo" solas.
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "pending") ? 5000 : false),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("results.title")}</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">{t("results.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("results.card_title")}</CardTitle>
          <CardDescription>{t("results.entries", { count: results.length })}</CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-[var(--color-fg-muted)]">{t("results.loading")}</p>
          ) : results.length === 0 ? (
            <p className="p-10 text-sm text-[var(--color-fg-muted)] text-center">
              {t("results.empty")}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>{t("results.col.time")}</Th>
                  <Th>{t("results.col.service")}</Th>
                  <Th>{t("results.col.status")}</Th>
                  <Th className="text-right">{t("results.col.cost")}</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {results.map((r) => (
                  <Tr key={r.resultId}>
                    <Td className="text-xs text-[var(--color-fg-muted)] font-mono whitespace-nowrap">
                      {format(new Date(r.createdAt * 1000), "MMM d, HH:mm:ss")}
                    </Td>
                    <Td className="text-sm">{r.service}</Td>
                    <Td>
                      <Badge tone={statusTone(r.status)}>{t(`results.status.${r.status}`)}</Badge>
                    </Td>
                    <Td className="text-right font-mono text-sm">
                      {r.costBaseUnits != null
                        ? `${formatKibix(baseUnitsToKibix(r.costBaseUnits))} ${KIBIX_LABEL}`
                        : "—"}
                    </Td>
                    <Td className="text-right">
                      <Link
                        to={`/app/results/${r.resultId}`}
                        className="text-xs text-[var(--color-primary)] hover:underline"
                      >
                        {t("results.open")}
                      </Link>
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
