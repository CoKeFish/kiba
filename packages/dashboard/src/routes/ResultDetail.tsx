import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResultPreview, latestState } from "@/components/results/ResultPreview";
import { field } from "@/components/results/content";
import { formatKibix, baseUnitsToKibix, KIBIX_LABEL } from "@/lib/format";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { statusTone } from "@/routes/Results";

export default function ResultDetail() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { data: r, isLoading, error } = useQuery({
    queryKey: ["result", id],
    queryFn: () => api.result(id),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 5000 : false),
  });

  const latest = r ? latestState(r) : undefined;
  const history = r?.related?.length
    ? [r, ...r.related].sort((a, b) => a.createdAt - b.createdAt)
    : [];

  return (
    <div className="space-y-6">
      <Link
        to="/app/results"
        className="text-sm text-[var(--color-fg-muted)] hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> {t("results.back")}
      </Link>

      {isLoading ? (
        <p className="text-sm text-[var(--color-fg-muted)]">{t("results.loading")}</p>
      ) : error || !r || !latest ? (
        <p className="text-sm text-[var(--color-fg-muted)]">{t("results.not_found")}</p>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{r.service}</h1>
            <Badge tone={statusTone(r.status)}>{t(`results.status.${r.status}`)}</Badge>
          </div>
          <p className="text-sm text-[var(--color-fg-muted)]">
            {format(new Date(r.createdAt * 1000), "MMM d yyyy, HH:mm:ss")}
            {r.costBaseUnits != null &&
              ` · ${formatKibix(baseUnitsToKibix(r.costBaseUnits))} ${KIBIX_LABEL}`}
            {r.explorerUrl && (
              <>
                {" · "}
                <a
                  href={r.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                >
                  {t("results.onchain")} <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
          </p>

          {latest.status === "pending" ? (
            <Card>
              <CardBody>
                <p className="text-sm">{t("results.pending_hint")}</p>
              </CardBody>
            </Card>
          ) : latest.status === "error" ? (
            <Card>
              <CardBody>
                <p className="text-sm text-[var(--color-danger)]">{latest.error}</p>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t("results.content")}</CardTitle>
              </CardHeader>
              <CardBody>
                <ResultPreview call={latest} />
              </CardBody>
            </Card>
          )}

          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("results.history")}</CardTitle>
              </CardHeader>
              <CardBody>
                <ol className="space-y-2">
                  {history.map((h) => (
                    <li key={h.resultId} className="flex items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-[var(--color-fg-muted)] whitespace-nowrap">
                        {format(new Date(h.createdAt * 1000), "HH:mm:ss")}
                      </span>
                      <Badge tone={statusTone(h.status)}>{t(`results.status.${h.status}`)}</Badge>
                      <span className="text-[var(--color-fg-muted)]">
                        {String(field(h.result, "status") ?? "")}
                      </span>
                      {h.resultId !== r.resultId && (
                        <Link
                          to={`/app/results/${h.resultId}`}
                          className="ml-auto text-xs text-[var(--color-primary)] hover:underline"
                        >
                          {t("results.open")}
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody className="space-y-3">
              {latest.result != null && (
                <details>
                  <summary className="text-sm font-medium cursor-pointer">{t("results.output")}</summary>
                  <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(latest.result, null, 2)}
                  </pre>
                </details>
              )}
              <details>
                <summary className="text-sm font-medium cursor-pointer">{t("results.input")}</summary>
                <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </details>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
