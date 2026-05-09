import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/format";
import {
  Coins,
  ExternalLink,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

function explorerWallet(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-[var(--color-success)]" : ""}>
      <CardBody>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">
              {label}
            </p>
            <p
              className={`text-2xl font-semibold font-mono ${
                highlight ? "text-[var(--color-success)]" : ""
              }`}
            >
              {value}
            </p>
            {hint && <p className="text-xs text-[var(--color-fg-muted)] mt-1">{hint}</p>}
          </div>
          <Icon className="w-5 h-5 text-[var(--color-fg-muted)]" />
        </div>
      </CardBody>
    </Card>
  );
}

export default function Platform() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: api.platformStats,
    refetchInterval: 15_000,
  });

  if (!data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Platform Revenue</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">Loading marketplace stats…</p>
        </div>
      </div>
    );
  }

  const { treasury, fee, marketplace, lifetime } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Platform Revenue</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            On-chain treasury · {fee.pct}% commission per call · auto-refreshes every 15s
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Treasury big card */}
      <Card className="border-[var(--color-success)]">
        <CardHeader className="flex items-start justify-between flex-row gap-2">
          <div>
            <CardTitle>Treasury balance</CardTitle>
            <CardDescription>
              Master wallet of the marketplace · receives {fee.pct}% of every claim_payment
              automatically, on-chain
            </CardDescription>
          </div>
          <Badge tone="success">live</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold font-mono text-[var(--color-success)]">
              {formatUsd(treasury.usd, 2)}
            </span>
            <span className="font-mono text-[var(--color-fg-muted)]">
              ({treasury.sol.toFixed(4)} SOL)
            </span>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)] text-xs">
            <span className="text-[var(--color-fg-muted)]">Treasury address</span>
            <a
              href={explorerWallet(treasury.pubkey)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[var(--color-primary)] hover:underline flex items-center gap-1"
            >
              {treasury.pubkey.slice(0, 8)}…{treasury.pubkey.slice(-8)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </CardBody>
      </Card>

      {/* Marketplace metrics */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-fg-muted)] mb-3">
          Marketplace activity
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Agents on-chain"
            value={marketplace.total_agents_on_chain.toString()}
            hint={
              marketplace.total_agents > marketplace.total_agents_on_chain
                ? `+ ${marketplace.total_agents - marketplace.total_agents_on_chain} fallback`
                : "All registered on-chain"
            }
          />
          <StatCard
            icon={Zap}
            label="Total calls"
            value={marketplace.total_calls.toLocaleString()}
            hint="Claims completed across all agents"
          />
          <StatCard
            icon={TrendingUp}
            label="Lifetime volume"
            value={formatUsd(lifetime.total_volume_usd, 2)}
            hint={`${lifetime.total_volume_sol.toFixed(4)} SOL gross`}
          />
          <StatCard
            icon={Coins}
            label="Lifetime fees"
            value={formatUsd(lifetime.estimated_fees_usd, 2)}
            hint={`${lifetime.estimated_fees_sol.toFixed(6)} SOL @ ${fee.pct}%`}
            highlight
          />
        </div>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle>How the {fee.pct}% commission works</CardTitle>
          <CardDescription>
            Hardcoded in the smart contract. No off-chain accounting needed.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-xs font-mono">
                1
              </span>
              <div>
                Client calls an agent → agent returns HTTP <code className="font-mono">402</code>{" "}
                with quote.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-xs font-mono">
                2
              </span>
              <div>
                Client signs <code className="font-mono">open_escrow</code>, locking SOL in the
                escrow PDA.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-xs font-mono">
                3
              </span>
              <div>
                Client retries with proof of payment, agent verifies on-chain, runs the service.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--color-success)]/20 text-[var(--color-success)] flex items-center justify-center text-xs font-mono">
                4
              </span>
              <div>
                <div className="font-medium">
                  Agent signs <code className="font-mono">claim_payment</code>:
                </div>
                <ul className="mt-1 space-y-1 ml-4 text-[var(--color-fg-muted)]">
                  <li>
                    →{" "}
                    <span className="text-[var(--color-fg)] font-mono">
                      {(100 - fee.pct).toFixed(0)}%
                    </span>{" "}
                    transferido al wallet del agent owner
                  </li>
                  <li>
                    →{" "}
                    <span className="text-[var(--color-success)] font-mono">{fee.pct}%</span>{" "}
                    transferido al treasury (
                    <span className="font-mono">
                      {treasury.pubkey.slice(0, 4)}…{treasury.pubkey.slice(-4)}
                    </span>
                    ) — <strong>esta es nuestra revenue</strong>
                  </li>
                </ul>
              </div>
            </li>
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
