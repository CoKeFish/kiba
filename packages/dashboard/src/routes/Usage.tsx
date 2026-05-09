import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type Transaction } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatUsd, lamportsToUsd } from "@/lib/format";
import { Activity, DollarSign, Layers } from "lucide-react";

const PALETTE = ["#9945FF", "#14F195", "#FFA500", "#5cf", "#f765", "#ff79c6"];

function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function Usage() {
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["transactions", "usage"],
    queryFn: () => api.transactions(500),
  });

  const calls = useMemo(() => txs.filter((t) => t.type === "call"), [txs]);

  const stats = useMemo(() => {
    const totalSpent = calls.reduce((acc, t) => acc + lamportsToUsd(t.amount_lamports), 0);
    const uniqueAgents = new Set(calls.map((t) => t.service).filter(Boolean)).size;
    const channelCounts = calls.reduce<Record<string, number>>((acc, t) => {
      const ch = t.channel || "unknown";
      acc[ch] = (acc[ch] || 0) + 1;
      return acc;
    }, {});
    const topChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { totalSpent, uniqueAgents, topChannel: topChannel || "—" };
  }, [calls]);

  const dailySpend = useMemo(() => {
    const buckets: Record<string, { day: string; usd: number; calls: number }> = {};
    for (const t of calls) {
      const k = dayKey(t.created_at);
      if (!buckets[k]) buckets[k] = { day: k, usd: 0, calls: 0 };
      buckets[k].usd += lamportsToUsd(t.amount_lamports);
      buckets[k].calls += 1;
    }
    // Order chronologically (last 14 days max for readability)
    return Object.values(buckets)
      .sort((a, b) => {
        const [am, ad] = a.day.split("/").map(Number);
        const [bm, bd] = b.day.split("/").map(Number);
        return am === bm ? ad - bd : am - bm;
      })
      .slice(-14);
  }, [calls]);

  const byAgent = useMemo(() => {
    const buckets: Record<string, { name: string; value: number; calls: number }> = {};
    for (const t of calls) {
      const k = t.service || "unknown";
      if (!buckets[k]) buckets[k] = { name: k, value: 0, calls: 0 };
      buckets[k].value += lamportsToUsd(t.amount_lamports);
      buckets[k].calls += 1;
    }
    return Object.values(buckets).sort((a, b) => b.value - a.value);
  }, [calls]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Spend over time, breakdown by agent and channel.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <CardBody>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">
                  Total spent
                </p>
                <p className="text-2xl font-semibold font-mono">{formatUsd(stats.totalSpent)}</p>
                <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                  Across {calls.length} call{calls.length !== 1 ? "s" : ""}
                </p>
              </div>
              <DollarSign className="w-5 h-5 text-[var(--color-fg-muted)]" />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">
                  Distinct agents used
                </p>
                <p className="text-2xl font-semibold font-mono">{stats.uniqueAgents}</p>
                <p className="text-xs text-[var(--color-fg-muted)] mt-1">In this account</p>
              </div>
              <Layers className="w-5 h-5 text-[var(--color-fg-muted)]" />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">
                  Primary channel
                </p>
                <p className="text-2xl font-semibold font-mono uppercase">{stats.topChannel}</p>
                <p className="text-xs text-[var(--color-fg-muted)] mt-1">
                  Most used integration path
                </p>
              </div>
              <Activity className="w-5 h-5 text-[var(--color-fg-muted)]" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Daily spend (USD)</CardTitle>
            <CardDescription>
              {dailySpend.length === 0 ? "No calls yet" : `Last ${dailySpend.length} day(s)`}
            </CardDescription>
          </CardHeader>
          <CardBody>
            {dailySpend.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-muted)] text-center py-12">
                {isLoading ? "Loading…" : "Make some calls in the Playground to see this chart."}
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailySpend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="day" stroke="var(--color-fg-muted)" fontSize={12} />
                    <YAxis stroke="var(--color-fg-muted)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                      }}
                      formatter={(v: number) => formatUsd(v)}
                    />
                    <Bar dataKey="usd" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spend by agent</CardTitle>
            <CardDescription>
              {byAgent.length === 0 ? "No calls yet" : `${byAgent.length} agent(s)`}
            </CardDescription>
          </CardHeader>
          <CardBody>
            {byAgent.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-muted)] text-center py-12">
                Try the Playground.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byAgent}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={48}
                      paddingAngle={2}
                    >
                      {byAgent.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                      }}
                      formatter={(v: number, name) => [formatUsd(v), name as string]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
