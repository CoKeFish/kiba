import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import { serviceToName, solToUsd } from "@/components/AgentManager";

const BAR_COLORS = [
  "var(--color-primary)",
  "var(--color-success)",
  "#FFD54A",
  "#FF6EC7",
  "#6C48FF",
  "#00D1C2",
];

export default function PublisherAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });

  const agents = (data?.agents ?? []).slice().sort((a, b) => b.totalCalls - a.totalCalls);
  const maxCalls = Math.max(1, ...agents.map((a) => a.totalCalls));
  const totalCalls = data?.totals.calls ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Usage across your agents — calls served and revenue share.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Calls by agent</CardTitle>
          <CardDescription>
            {totalCalls.toLocaleString()} total call{totalCalls !== 1 ? "s" : ""} served
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-[var(--color-fg-muted)] py-6 text-center">Loading…</p>
          ) : agents.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)] py-6 text-center">
              No data yet. Once your agents start serving paid calls, usage shows up here.
            </p>
          ) : (
            agents.map((a, i) => {
              const pct = (a.totalCalls / maxCalls) * 100;
              const share = totalCalls > 0 ? (a.totalCalls / totalCalls) * 100 : 0;
              return (
                <div key={a.service} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{serviceToName(a.service)}</span>
                    <span className="font-mono text-xs text-[var(--color-fg-muted)]">
                      {a.totalCalls.toLocaleString()} calls · {share.toFixed(0)}% ·{" "}
                      <span className="text-[var(--color-success)]">
                        {formatUsd(solToUsd(a.totalEarnedSol))}
                      </span>
                    </span>
                  </div>
                  <div
                    className="h-2.5 rounded-full overflow-hidden"
                    style={{ background: "var(--color-bg)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(2, pct)}%`,
                        background: BAR_COLORS[i % BAR_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by agent</CardTitle>
        </CardHeader>
        <CardBody>
          {agents.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)] py-4 text-center">No revenue yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map((a) => (
                <div
                  key={a.service}
                  className="rounded-md border border-[var(--color-border)] p-3"
                >
                  <div className="text-sm font-medium truncate">{serviceToName(a.service)}</div>
                  <div className="text-lg font-semibold text-[var(--color-success)] font-mono">
                    {formatUsd(solToUsd(a.totalEarnedSol))}
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)] font-mono">
                    {a.totalCalls.toLocaleString()} calls
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
