import { useMemo } from "react";
import { Link } from "react-router-dom";
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
import { api } from "@/lib/api";
import { serviceToName } from "@/components/AgentManager";
import {
  formatUsd,
  lamportsToUsd,
  formatKibs,
  formatKibsLabel,
  usdToKibs,
  KIBS_LABEL,
} from "@/lib/format";
import { Activity, Play, Receipt, Sparkles, TrendingUp } from "lucide-react";
import "./usage.css";

const MASCOTS = {
  circuloPeek: "/agents/circulo-peek.png",
  moradoSentado: "/agents/morado-sentado.png",
  estrella: "/agents/estrella.png",
} as const;

const PARADE = [
  "/agents/cuadrado.png",
  "/agents/triangulo.png",
  "/agents/circulo.png",
  "/agents/corazon.png",
  "/agents/morado.png",
  "/agents/estrella.png",
] as const;

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
    const channelCounts = calls.reduce<Record<string, number>>((acc, t) => {
      const ch = t.channel || "unknown";
      acc[ch] = (acc[ch] || 0) + 1;
      return acc;
    }, {});
    const channelEntries = Object.entries(channelCounts);
    let topChannel: string | undefined;
    let topCount = -Infinity;
    for (const [ch, count] of channelEntries) {
      if (count > topCount) {
        topCount = count;
        topChannel = ch;
      }
    }
    const avgCost = calls.length > 0 ? totalSpent / calls.length : 0;
    return {
      totalSpent,
      avgCost,
      topChannel: topChannel || "—",
    };
  }, [calls]);

  const dailySpend = useMemo(() => {
    const buckets: Record<string, { day: string; usd: number; calls: number }> = {};
    for (const t of calls) {
      const k = dayKey(t.created_at);
      if (!buckets[k]) buckets[k] = { day: k, usd: 0, calls: 0 };
      buckets[k].usd += lamportsToUsd(t.amount_lamports);
      buckets[k].calls += 1;
    }
    return Object.values(buckets)
      .sort((a, b) => {
        const [am, ad] = a.day.split("/").map(Number);
        const [bm, bd] = b.day.split("/").map(Number);
        return am === bm ? ad - bd : am - bm;
      })
      .slice(-14)
      .map((d) => ({ ...d, kibs: usdToKibs(d.usd) }));
  }, [calls]);

  const byAgent = useMemo(() => {
    const buckets: Record<string, { name: string; label: string; value: number; calls: number }> =
      {};
    for (const t of calls) {
      const k = t.service || "unknown";
      if (!buckets[k]) {
        buckets[k] = { name: k, label: serviceToName(k), value: 0, calls: 0 };
      }
      buckets[k].value += usdToKibs(lamportsToUsd(t.amount_lamports));
      buckets[k].calls += 1;
    }
    return Object.values(buckets).sort((a, b) => b.value - a.value);
  }, [calls]);

  return (
    <div className="usage-page">
      <header className="usage-head">
        <h1 className="usage-title">Usage</h1>
        <p className="usage-subtitle">Spend over time, breakdown by agent and channel.</p>
      </header>

      <div className="usage-kpis">
        <article className="usage-kpi">
          <div className="usage-kpi__row">
            <div>
              <p className="usage-kpi__label">Primary channel</p>
              <p className="usage-kpi__value">{stats.topChannel}</p>
              <p className="usage-kpi__hint">Most used integration path</p>
            </div>
            <div
              className="usage-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--c-purple) 14%, transparent)",
                color: "var(--c-purple)",
              }}
            >
              <Activity size={20} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="usage-kpi">
          <div className="usage-kpi__row">
            <div>
              <p className="usage-kpi__label">Total spent</p>
              <p className="usage-kpi__value usage-kpi__value--normal">
                {formatKibsLabel(usdToKibs(stats.totalSpent))}
              </p>
              <p className="usage-kpi__hint">≈ {formatUsd(stats.totalSpent)}</p>
            </div>
            <div
              className="usage-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                color: "var(--color-primary)",
              }}
            >
              <Receipt size={20} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="usage-kpi">
          <div className="usage-kpi__row">
            <div>
              <p className="usage-kpi__label">Calls made</p>
              <p className="usage-kpi__value usage-kpi__value--normal">{calls.length}</p>
              <p className="usage-kpi__hint">Agent requests</p>
            </div>
            <div
              className="usage-kpi__icon"
              style={{
                background: "color-mix(in srgb, var(--color-success) 14%, transparent)",
                color: "var(--color-success)",
              }}
            >
              <Sparkles size={20} strokeWidth={2} />
            </div>
          </div>
        </article>

        <article className="usage-kpi usage-kpi--peek">
          <div className="usage-kpi__row">
            <div>
              <p className="usage-kpi__label">Avg cost</p>
              <p className="usage-kpi__value usage-kpi__value--normal">
                {calls.length > 0 ? formatKibsLabel(usdToKibs(stats.avgCost)) : "—"}
              </p>
              <p className="usage-kpi__hint">
                {calls.length > 0 ? `≈ ${formatUsd(stats.avgCost, 4)} per call` : "Per call"}
              </p>
            </div>
            <div
              className="usage-kpi__icon"
              style={{
                background: "color-mix(in srgb, #f59e0b 14%, transparent)",
                color: "#d97706",
              }}
            >
              <TrendingUp size={20} strokeWidth={2} />
            </div>
          </div>
          <img src={MASCOTS.circuloPeek} alt="" aria-hidden className="usage-kpi__peek" />
        </article>
      </div>

      <div className="usage-charts">
        <section className="usage-chart-card">
          <div className="usage-chart-card__head">
            <h2 className="usage-chart-card__title">Spend by agent</h2>
            <p className="usage-chart-card__desc">
              {byAgent.length === 0 ? "No calls yet" : `${byAgent.length} agent(s)`}
            </p>
          </div>
          <div
            className={`usage-chart-card__body${byAgent.length > 0 ? " usage-chart-card__body--chart" : ""}`}
          >
            {byAgent.length === 0 ? (
              <div className="usage-empty">
                <img
                  src={MASCOTS.moradoSentado}
                  alt=""
                  aria-hidden
                  className="usage-empty__mascot usage-empty__mascot--sitting"
                />
                <p className="usage-empty__text">
                  {isLoading ? "Loading…" : "No agent usage yet."}
                </p>
              </div>
            ) : (
              <div className="usage-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byAgent}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={88}
                      innerRadius={52}
                      paddingAngle={2}
                    >
                      {byAgent.map((slice, i) => (
                        <Cell key={slice.name} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      formatter={(v: number, name) => [
                        `${formatKibs(v)} ${KIBS_LABEL}`,
                        name as string,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        <section className="usage-chart-card">
          <div className="usage-chart-card__head">
            <h2 className="usage-chart-card__title">Daily spend ({KIBS_LABEL})</h2>
            <p className="usage-chart-card__desc">
              {dailySpend.length === 0
                ? "No calls yet"
                : `Last ${dailySpend.length} day(s)`}
            </p>
          </div>
          <div
            className={`usage-chart-card__body${dailySpend.length > 0 ? " usage-chart-card__body--chart" : ""}`}
          >
            {dailySpend.length === 0 ? (
              <div className="usage-empty">
                <img
                  src={MASCOTS.estrella}
                  alt=""
                  aria-hidden
                  className="usage-empty__mascot usage-empty__mascot--wave"
                />
                <p className="usage-empty__text">
                  {isLoading ? "Loading…" : "No spend data yet."}
                </p>
              </div>
            ) : (
              <div className="usage-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailySpend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="day" stroke="var(--color-fg-muted)" fontSize={12} />
                    <YAxis stroke="var(--color-fg-muted)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => `${formatKibs(v)} ${KIBS_LABEL}`}
                    />
                    <Bar
                      dataKey="kibs"
                      fill="var(--color-primary)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="usage-cta">
        <div className="usage-cta__copy">
          <p className="usage-cta__text">Start exploring agents to see usage insights.</p>
          <Link to="/app/playground" className="usage-cta-btn">
            <Play size={16} fill="currentColor" />
            Go to Playground
          </Link>
        </div>
        <div className="usage-parade" aria-hidden="true">
          <div className="usage-parade__mascots">
            {PARADE.map((src) => (
              <img key={src} src={src} alt="" className="usage-parade__mascot" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
