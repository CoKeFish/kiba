import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { Bot, Coins, Activity, Wallet, Plus, ExternalLink } from "lucide-react";

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardBody className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className="text-xs text-[var(--color-fg-muted)] font-mono">{sub}</div>}
      </CardBody>
    </Card>
  );
}

export default function PublisherOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Revenue</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Your agents earn 95% of every paid call, settled on {chain.networkLabel}.
          </p>
        </div>
        <Link to="/app/publisher/publish">
          <Button size="sm">
            <Plus className="w-3 h-3" />
            Publish agent
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={Coins}
          label="Lifetime earned"
          value={isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
          sub={data ? `${(data.totals.earned_asset ?? 0).toFixed(6)} ${data.asset}` : undefined}
        />
        <Stat
          icon={Activity}
          label="Calls served"
          value={isLoading ? "—" : (data?.totals.calls ?? 0).toLocaleString()}
        />
        <Stat
          icon={Bot}
          label="Agents"
          value={isLoading ? "—" : String(data?.totals.agents ?? 0)}
        />
        <Stat
          icon={Wallet}
          label="In wallet"
          value={isLoading ? "—" : formatUsd(data?.wallet.usd ?? 0)}
          sub={data ? `${(data.wallet.asset_amount ?? 0).toFixed(4)} ${data.asset}` : undefined}
        />
      </div>

      {/* Per-agent revenue */}
      <Card>
        <CardHeader>
          <CardTitle>Per-agent revenue</CardTitle>
          <CardDescription>
            On-chain totals per agent. Platform fee: {data ? data.fee.pct : 5}% · you keep{" "}
            {data ? 100 - data.fee.pct : 95}%.
          </CardDescription>
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <p className="text-sm text-[var(--color-fg-muted)] py-6 text-center">Loading…</p>
          ) : !data || data.agents.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-[var(--color-fg-muted)]">
                You haven't published any agents yet.
              </p>
              <Link to="/app/publisher/publish">
                <Button size="sm" variant="default">
                  <Plus className="w-3 h-3" />
                  Publish your first agent
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-fg-muted)] uppercase tracking-wider border-b border-[var(--color-border)]">
                    <th className="py-2 pr-4 font-medium">Agent</th>
                    <th className="py-2 pr-4 font-medium text-right">Price</th>
                    <th className="py-2 pr-4 font-medium text-right">Calls</th>
                    <th className="py-2 pr-4 font-medium text-right">Earned</th>
                    <th className="py-2 font-medium text-right">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.service} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{serviceToName(a.service)}</div>
                        <div className="font-mono text-xs text-[var(--color-fg-muted)]">
                          {a.service}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-[var(--color-success)]">
                        {formatUsd(solToUsd(a.pricePerCallSol))}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono">
                        {a.totalCalls.toLocaleString()}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-[var(--color-success)]">
                        {formatUsd(solToUsd(a.totalEarnedSol))}
                      </td>
                      <td className="py-3 text-right">
                        <a
                          href={chain.explorerAddr(a.owner)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                        >
                          explorer <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
