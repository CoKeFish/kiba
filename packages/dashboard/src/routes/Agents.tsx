import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Agent, type AgentSearchHit, type MyAgent } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd, formatSol } from "@/lib/format";
import { chain } from "@/lib/chain";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Mode = "keyword" | "semantic" | "hybrid";

const solToUsd = (sol: number) => sol * chain.usdRate;
const usdToLamports = (usd: number) =>
  Math.floor((usd / chain.usdRate) * chain.baseUnitsPerToken);

function serviceToName(service: string): string {
  return service
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function explorerWallet(addr: string): string {
  return chain.explorerAddr(addr);
}

function explorerTx(sig: string): string {
  return chain.explorerTx(sig);
}

// Presets de precio basados en el tipo de servicio agéntico
const PRICING_PRESETS: { label: string; usd: number; hint: string }[] = [
  { label: "Quick lookup", usd: 0.01, hint: "Conversion, fetch, simple query" },
  { label: "Standard agent", usd: 0.1, hint: "Single LLM call, basic reasoning" },
  { label: "Premium agent", usd: 0.5, hint: "Multi-step reasoning, code review" },
  { label: "Heavy compute", usd: 2.0, hint: "Long-running task, complex inference" },
];

export default function Agents() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const debounceRef = useRef<number | undefined>(undefined);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [wsState, setWsState] = useState<"connecting" | "open" | "closed">("connecting");
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

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
      hasQuery
        ? (await api.searchAgents(debouncedQuery, mode, 50)).results
        : await api.agents(),
  });

  const myAgentsQuery = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  useEffect(() => {
    // En producción (Vercel) el WS va DIRECTO al backend (Railway): Vercel no proxea
    // WebSockets por rewrites. En dev, VITE_WS_URL no está set y cae al host local,
    // que el proxy de Vite redirige al backend. Ver docs/DEPLOYMENT.md.
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
          qc.invalidateQueries({ queryKey: ["my-agents"] });
        }
      } catch {
        // ignore
      }
    };
    // Cierre robusto: si el socket aún está conectando (p.ej. doble-montaje de
    // React StrictMode en dev), cerrarlo al abrir — evita el warning
    // "WebSocket is closed before the connection is established".
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [qc]);

  const agents = useMemo(() => (data ?? []) as (Agent | AgentSearchHit)[], [data]);
  const myAgents = myAgentsQuery.data ?? [];
  const myServices = useMemo(() => new Set(myAgents.map((a) => a.service)), [myAgents]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Live registry on {chain.networkLabel} · {agents.length} agent{agents.length !== 1 ? "s" : ""}
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
          <Button
            size="sm"
            variant="default"
            onClick={() => setShowRegister((v) => !v)}
          >
            {showRegister ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            {showRegister ? "Cancel" : "Register Agent"}
          </Button>
        </div>
      </div>

      {/* Register form */}
      {showRegister && (
        <RegisterAgentForm
          onSuccess={() => {
            setShowRegister(false);
            qc.invalidateQueries({ queryKey: ["my-agents"] });
            qc.invalidateQueries({ queryKey: ["agents-list"] });
          }}
        />
      )}

      {/* My agents */}
      {myAgents.length > 0 && (
        <MyAgentsSection agents={myAgents} />
      )}

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

      {/* Lista */}
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

// ════════════════════════════════════════════════════════════════
//   RegisterAgentForm
// ════════════════════════════════════════════════════════════════

function RegisterAgentForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [service, setService] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [description, setDescription] = useState("");
  const [priceUsd, setPriceUsd] = useState<number>(0.1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ signature: string; pda: string } | null>(null);

  const lamports = usdToLamports(priceUsd);

  const mutation = useMutation({
    mutationFn: () =>
      api.registerAgent({
        service: service.trim().toLowerCase(),
        pricePerCallLamports: lamports,
        endpoint: endpoint.trim(),
        description: description.trim(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["agents-list"] });
      setSuccess({ signature: res.signature, pda: res.pda });
      setTimeout(() => {
        onSuccess();
      }, 2500);
    },
    onError: (err: Error) => {
      setSubmitError(err.message);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccess(null);
    mutation.mutate();
  };

  if (success) {
    return (
      <Card className="border-[var(--color-success)]">
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-[var(--color-success)] font-semibold">
            ✓ Agent registered on-chain
          </div>
          <div className="text-sm space-y-2">
            <div className="font-mono text-xs flex items-center justify-between border border-[var(--color-border)] rounded-md p-2">
              <span className="text-[var(--color-fg-muted)]">PDA:</span>
              <a
                href={explorerWallet(success.pda)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline flex items-center gap-1"
              >
                {success.pda.slice(0, 8)}…{success.pda.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="font-mono text-xs flex items-center justify-between border border-[var(--color-border)] rounded-md p-2">
              <span className="text-[var(--color-fg-muted)]">Signature:</span>
              <a
                href={explorerTx(success.signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline flex items-center gap-1"
              >
                {success.signature.slice(0, 8)}…{success.signature.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a new agent</CardTitle>
        <CardDescription>
          Your custodial wallet will sign the on-chain <code>register_agent</code> instruction.
          Payments from clients will land in this wallet directly.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="service">Service slug</Label>
            <Input
              id="service"
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="my-cool-agent"
              maxLength={32}
              required
            />
            <p className="text-xs text-[var(--color-fg-muted)] mt-1">
              Lowercase, alphanumeric, dashes/underscores allowed. Max 32 chars.
            </p>
          </div>

          <div>
            <Label htmlFor="endpoint">Endpoint URL</Label>
            <Input
              id="endpoint"
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://my-agent.example.com/service"
              maxLength={256}
              required
            />
            <p className="text-xs text-[var(--color-fg-muted)] mt-1">
              The HTTP endpoint clients will hit. Must implement the x402 handshake.
            </p>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do? Be specific about inputs and outputs."
              maxLength={512}
              required
              rows={3}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
            <p className="text-xs text-[var(--color-fg-muted)] mt-1">
              {description.length} / 512 chars. This helps the discovery indexer.
            </p>
          </div>

          <div>
            <Label>Floor price per call</Label>
            <p className="text-xs text-[var(--color-fg-muted)] mb-2">
              Mínimo on-chain. Tu agente puede cobrar más por request si usa{" "}
              <code className="font-mono">priceFn</code> en el SDK
              (ej. cobrar por chars traducidos, líneas de código, símbolos cotizados).
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
              {PRICING_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPriceUsd(p.usd)}
                  className={`text-left rounded-md border px-3 py-2 transition-colors ${
                    priceUsd === p.usd
                      ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-[var(--color-success)] font-mono">
                    ${p.usd.toFixed(2)}
                  </div>
                  <div className="text-xs text-[var(--color-fg-muted)] mt-1 leading-tight">
                    {p.hint}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1">
                <Label htmlFor="custom-price" className="text-xs text-[var(--color-fg-muted)]">
                  Custom (USD)
                </Label>
                <Input
                  id="custom-price"
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(Number(e.target.value) || 0)}
                />
              </div>
              <div className="text-xs text-[var(--color-fg-muted)] font-mono pt-5">
                = {(lamports / chain.baseUnitsPerToken).toFixed(6)} {chain.asset}
                <br />
                = {lamports.toLocaleString()} base units
              </div>
            </div>
          </div>

          {submitError && (
            <div className="rounded-md border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <Button
              type="submit"
              variant="default"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Registering on-chain…" : "Register agent"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════
//   MyAgentsSection — owned by current user
// ════════════════════════════════════════════════════════════════

function MyAgentsSection({ agents }: { agents: MyAgent[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className="border-[var(--color-primary)]">
      <CardHeader
        className="cursor-pointer flex items-center justify-between flex-row"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <CardTitle>My agents</CardTitle>
          <CardDescription>
            {agents.length} agent{agents.length !== 1 ? "s" : ""} owned by your custodial wallet ·
            Total earned:{" "}
            <span className="text-[var(--color-success)] font-mono">
              {formatUsd(
                solToUsd(agents.reduce((sum, a) => sum + a.totalEarnedSol, 0)),
              )}
            </span>
          </CardDescription>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </CardHeader>
      {expanded && (
        <CardBody className="space-y-3">
          {agents.map((a) => (
            <MyAgentRow key={a.service} agent={a} />
          ))}
        </CardBody>
      )}
    </Card>
  );
}

function MyAgentRow({ agent }: { agent: MyAgent }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMut = useMutation({
    mutationFn: () => api.deregisterAgent(agent.service),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["agents-list"] });
    },
  });

  if (editing) {
    return (
      <EditAgentRow
        agent={agent}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          qc.invalidateQueries({ queryKey: ["my-agents"] });
          qc.invalidateQueries({ queryKey: ["agents-list"] });
        }}
      />
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{serviceToName(agent.service)}</span>
            <span className="font-mono text-xs text-[var(--color-fg-muted)]">{agent.service}</span>
          </div>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1 line-clamp-2">
            {agent.description}
          </p>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span>
              <span className="text-[var(--color-fg-muted)]">Price:</span>{" "}
              <span className="text-[var(--color-success)] font-mono">
                {formatUsd(solToUsd(agent.pricePerCallSol))}
              </span>
            </span>
            <span>
              <span className="text-[var(--color-fg-muted)]">Calls:</span>{" "}
              <span className="font-mono">{agent.totalCalls.toLocaleString()}</span>
            </span>
            <span>
              <span className="text-[var(--color-fg-muted)]">Earned:</span>{" "}
              <span className="text-[var(--color-success)] font-mono">
                {formatUsd(solToUsd(agent.totalEarnedSol))}
              </span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="w-3 h-3" />
            Edit
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? "..." : "Confirm"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3 h-3" />
              Delete
            </Button>
          )}
        </div>
      </div>
      {deleteMut.isError && (
        <div className="text-xs text-[var(--color-danger)]">
          {(deleteMut.error as Error).message}
        </div>
      )}
    </div>
  );
}

function EditAgentRow({
  agent,
  onCancel,
  onSaved,
}: {
  agent: MyAgent;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Snapshot inicial desde el agent — son inputs controlados que el user edita,
  // no queremos sync continuo con props. Si cambia el agente, EditAgentRow se
  // re-monta vía un key={} en el padre o conditional render.
  const [endpoint, setEndpoint] = useState(agent.endpoint);
  const [description, setDescription] = useState(agent.description);
  const [priceUsd, setPriceUsd] = useState(() => solToUsd(agent.pricePerCallSol));
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => {
      const params: { pricePerCallLamports?: number; endpoint?: string; description?: string } = {};
      if (endpoint !== agent.endpoint) params.endpoint = endpoint;
      if (description !== agent.description) params.description = description;
      const newLamports = usdToLamports(priceUsd);
      if (newLamports !== agent.pricePerCallLamports) params.pricePerCallLamports = newLamports;
      return api.updateAgent(agent.service, params);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["agents-list"] });
      onSaved();
    },
  });

  return (
    <div className="rounded-md border border-[var(--color-primary)] p-3 space-y-3">
      <div className="text-sm font-medium">Editing {agent.service}</div>
      <div>
        <Label htmlFor={`ep-${agent.service}`}>Endpoint</Label>
        <Input
          id={`ep-${agent.service}`}
          type="url"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`desc-${agent.service}`}>Description</Label>
        <textarea
          id={`desc-${agent.service}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={512}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>
      <div>
        <Label htmlFor={`price-${agent.service}`}>Price (USD)</Label>
        <Input
          id={`price-${agent.service}`}
          type="number"
          min={0.001}
          step={0.001}
          value={priceUsd}
          onChange={(e) => setPriceUsd(Number(e.target.value) || 0)}
        />
        <p className="text-xs text-[var(--color-fg-muted)] mt-1 font-mono">
          = {(usdToLamports(priceUsd) / chain.baseUnitsPerToken).toFixed(6)} {chain.asset}
        </p>
      </div>
      {mut.isError && (
        <div className="text-xs text-[var(--color-danger)]">{(mut.error as Error).message}</div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
        >
          {mut.isPending ? "Saving on-chain…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
