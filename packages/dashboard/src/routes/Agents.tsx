import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Agent, type AgentSearchHit } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUsd, formatSol } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { ExternalLink, PlayCircle, RefreshCw, Search, Wifi, WifiOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Mode = "keyword" | "semantic" | "hybrid";

function explorerWallet(addr: string): string {
  return chain.explorerAddr(addr);
}

export default function Agents() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const debounceRef = useRef<number | undefined>(undefined);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [wsState, setWsState] = useState<"connecting" | "open" | "closed">("connecting");
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const hasQuery = debouncedQuery.length > 0;

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["agents-list", debouncedQuery, mode],
    queryFn: async () =>
      hasQuery ? (await api.searchAgents(debouncedQuery, mode, 50)).results : await api.agents(),
  });

  const myAgentsQuery = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  useEffect(() => {
    const url =
      import.meta.env.VITE_WS_URL ||
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
    const ws = new WebSocket(url);
    setWsState("connecting");
    ws.onopen = () => setWsState("open");
    ws.onclose = () => setWsState("closed");
    ws.onerror = () => setWsState("closed");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "snapshot" || msg.type === "program_event") {
          setLastEvent(`${msg.type} · ${new Date().toLocaleTimeString()}`);
          qc.invalidateQueries({ queryKey: ["agents-list"] });
        }
      } catch {
        // ignore
      }
    };
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [qc]);

  const agents = useMemo(() => (data ?? []) as (Agent | AgentSearchHit)[], [data]);
  const myServices = useMemo(
    () => new Set((myAgentsQuery.data ?? []).map((a) => a.service)),
    [myAgentsQuery.data],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Live registry on {chain.networkLabel} · {agents.length} agent
            {agents.length !== 1 ? "s" : ""} · browse and call any of them
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-fg-muted)]">
          {wsState === "open" ? (
            <span className="inline-flex items-center gap-1 text-[var(--color-success)]">
              <Wifi className="w-3 h-3" /> live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <WifiOff className="w-3 h-3" /> {wsState}
            </span>
          )}
          {lastEvent && <span className="font-mono">{lastEvent}</span>}
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardBody className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)]" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search — try "auditar contrato" or "best APY"'
              className="pl-9"
            />
          </div>
          <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-sm shrink-0">
            {(["keyword", "semantic", "hybrid"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-2 capitalize transition-colors ${
                  mode === m
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-bg)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* List */}
      {agents.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-[var(--color-fg-muted)] text-center py-12">
              {isFetching
                ? "Loading…"
                : hasQuery
                  ? `No agents matched "${debouncedQuery}". Try a different phrasing.`
                  : "No agents registered yet."}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {agents.map((a) => {
            const hit = a as AgentSearchHit;
            const isHit = "matchType" in hit && typeof hit.score === "number";
            const isMine = myServices.has(a.service);
            return (
              <Card
                key={a.service}
                className={`hover:border-[var(--color-primary)] transition-colors ${
                  isMine ? "border-[var(--color-primary)]" : ""
                }`}
              >
                <CardHeader className="flex items-start justify-between flex-row gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{serviceToName(a.service)}</CardTitle>
                    <CardDescription className="font-mono text-xs">{a.service}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isMine && <Badge tone="success">mine</Badge>}
                    <Badge tone={a.source === "chain" ? "success" : "neutral"}>
                      {a.source === "chain" ? "on-chain" : "fallback"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardBody className="space-y-3">
                  <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                    {a.description}
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
                    <div>
                      <div className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
                        Price
                      </div>
                      <div className="font-mono text-sm">
                        <span className="text-[var(--color-success)]">
                          {formatUsd(solToUsd(a.pricePerCall))}
                        </span>{" "}
                        <span className="text-[var(--color-fg-muted)]">
                          ({formatSol(a.pricePerCall)})
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
                        Calls served
                      </div>
                      <div className="font-mono text-sm">{a.totalCalls.toLocaleString()}</div>
                    </div>
                  </div>
                  {a.source === "chain" && a.ownerWallet !== "PHASE_1_PLACEHOLDER" && (
                    <div className="text-xs text-[var(--color-fg-muted)] flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
                      <span>Owner wallet</span>
                      <a
                        href={explorerWallet(a.ownerWallet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[var(--color-primary)] hover:underline flex items-center gap-1"
                      >
                        {a.ownerWallet.slice(0, 4)}…{a.ownerWallet.slice(-4)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs text-[var(--color-fg-muted)]">
                      Registered{" "}
                      {formatDistanceToNow(new Date(a.createdAt * 1000), { addSuffix: true })}
                    </div>
                    {isHit && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--color-primary) 15%, transparent)",
                          color: "var(--color-primary)",
                        }}
                      >
                        {hit.matchType} · {(hit.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="w-full mt-2"
                    onClick={() => navigate(`/app/playground?service=${encodeURIComponent(a.service)}`)}
                  >
                    <PlayCircle className="w-3 h-3" />
                    Try in playground
                  </Button>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
