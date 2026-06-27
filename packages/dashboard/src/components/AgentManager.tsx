/**
 * Componentes reutilizables de gestión de agentes (lado publisher):
 *   - RegisterAgentForm  → publica un agente on-chain (custodial wallet firma)
 *   - MyAgentsSection    → lista los agentes del user con edit/delete inline
 *   - EditAgentRow       → edición de precio/endpoint/descripción
 *
 * Extraídos de routes/Agents.tsx para compartirlos entre el browse del consumidor
 * y las rutas del dashboard de publisher.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type MyAgent } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { ChevronDown, ChevronUp, ExternalLink, Pencil, Trash2, X } from "lucide-react";

export const solToUsd = (sol: number) => sol * chain.usdRate;
export const usdToLamports = (usd: number) =>
  Math.floor((usd / chain.usdRate) * chain.baseUnitsPerToken);

export function serviceToName(service: string): string {
  return service
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

const explorerWallet = (addr: string) => chain.explorerAddr(addr);
const explorerTx = (sig: string) => chain.explorerTx(sig);

// Presets de precio basados en el tipo de servicio agéntico
export const PRICING_PRESETS: { label: string; usd: number; hint: string }[] = [
  { label: "Quick lookup", usd: 0.01, hint: "Conversion, fetch, simple query" },
  { label: "Standard agent", usd: 0.1, hint: "Single LLM call, basic reasoning" },
  { label: "Premium agent", usd: 0.5, hint: "Multi-step reasoning, code review" },
  { label: "Heavy compute", usd: 2.0, hint: "Long-running task, complex inference" },
];

// ════════════════════════════════════════════════════════════════
//   RegisterAgentForm
// ════════════════════════════════════════════════════════════════

export function RegisterAgentForm({ onSuccess }: { onSuccess?: () => void }) {
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
      qc.invalidateQueries({ queryKey: ["publisher-overview"] });
      setSuccess({ signature: res.signature, pda: res.pda });
      setTimeout(() => onSuccess?.(), 2500);
    },
    onError: (err: Error) => setSubmitError(err.message),
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
          Your custodial wallet signs the on-chain <code>register_agent</code> instruction.
          Payments from clients (95%) land in this wallet directly.
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
              The HTTP endpoint clients hit. Must implement the x402 handshake.
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
              On-chain minimum. Your agent can charge more per request via{" "}
              <code className="font-mono">priceFn</code> in the SDK (e.g. per char, per line).
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
            <Button type="submit" variant="default" disabled={mutation.isPending}>
              {mutation.isPending ? "Registering on-chain…" : "Register agent"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════
//   MyAgentsSection
// ════════════════════════════════════════════════════════════════

export function MyAgentsSection({
  agents,
  collapsible = true,
}: {
  agents: MyAgent[];
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className="border-[var(--color-primary)]">
      <CardHeader
        className={collapsible ? "cursor-pointer flex items-center justify-between flex-row" : "flex items-center justify-between flex-row"}
        onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
      >
        <div>
          <CardTitle>My agents</CardTitle>
          <CardDescription>
            {agents.length} agent{agents.length !== 1 ? "s" : ""} owned by your custodial wallet ·
            Total earned:{" "}
            <span className="text-[var(--color-success)] font-mono">
              {formatUsd(solToUsd(agents.reduce((sum, a) => sum + a.totalEarnedSol, 0)))}
            </span>
          </CardDescription>
        </div>
        {collapsible &&
          (expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
      </CardHeader>
      {(!collapsible || expanded) && (
        <CardBody className="space-y-3">
          {agents.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)] text-center py-6">
              No agents yet. Publish your first one to start earning.
            </p>
          ) : (
            agents.map((a) => <MyAgentRow key={a.service} agent={a} />)
          )}
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
      qc.invalidateQueries({ queryKey: ["publisher-overview"] });
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
          qc.invalidateQueries({ queryKey: ["publisher-overview"] });
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
          <div className="flex items-center gap-4 mt-2 text-xs flex-wrap">
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
            <a
              href={explorerWallet(agent.owner)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 font-mono"
            >
              owner <ExternalLink className="w-3 h-3" />
            </a>
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
  const [endpoint, setEndpoint] = useState(agent.endpoint);
  const [description, setDescription] = useState(agent.description);
  const [priceUsd, setPriceUsd] = useState(() => solToUsd(agent.pricePerCallSol));

  const mut = useMutation({
    mutationFn: () => {
      const params: { pricePerCallLamports?: number; endpoint?: string; description?: string } = {};
      if (endpoint !== agent.endpoint) params.endpoint = endpoint;
      if (description !== agent.description) params.description = description;
      const newLamports = usdToLamports(priceUsd);
      if (newLamports !== agent.pricePerCallLamports) params.pricePerCallLamports = newLamports;
      return api.updateAgent(agent.service, params);
    },
    onSuccess: onSaved,
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
        <Label htmlFor={`price-${agent.service}`}>Floor price (USD)</Label>
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
        <Button size="sm" variant="default" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Saving on-chain…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
