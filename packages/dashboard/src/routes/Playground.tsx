import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Agent } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUsd, shortSig, explorerUrl } from "@/lib/format";
import { Play, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";

const SOL_USD_RATE = 150;
const solToUsd = (sol: number) => sol * SOL_USD_RATE;

// Cada agente cobra dinámicamente según el payload — prueba editando los
// valores y observa cómo cambia el quote en el x402 trace.
const SAMPLE_PAYLOADS: Record<string, string> = {
  "yield-hunter": `{
  "token": "USDC",
  "riskTolerance": "medium"
}`,
  "risk-auditor": `{
  "protocols": ["Kamino", "Lulo"]
}`,
  "translator-pro": `{
  "text": "hello world",
  "to": "es"
}`,
  "price-oracle": `{
  "symbols": ["SOL", "BTC", "ETH"],
  "vs": "USD"
}`,
  "code-reviewer": `{
  "code": "const x: any = eval('1+1');\\nconsole.log(x);\\n// TODO: fix this",
  "language": "typescript"
}`,
};

interface CallEntry {
  id: number;
  service: string;
  ts: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  cost?: { usd: number };
  signature?: string;
  durationMs: number;
}

export default function Playground() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initialService = params.get("service") || "";

  const { data: agents = [] } = useQuery({ queryKey: ["agents-list-pg"], queryFn: api.agents });
  const [service, setService] = useState(initialService);
  const [payloadText, setPayloadText] = useState(SAMPLE_PAYLOADS[initialService] || "{}");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<CallEntry[]>([]);
  const [counter, setCounter] = useState(1);

  // Pre-fill default selection once agents load
  useEffect(() => {
    if (!service && agents.length > 0) {
      const first = agents[0].service;
      setService(first);
      setPayloadText(SAMPLE_PAYLOADS[first] || "{}");
    }
  }, [agents, service]);

  // Update payload sample when changing service via dropdown
  function selectService(svc: string) {
    setService(svc);
    setPayloadText(SAMPLE_PAYLOADS[svc] || "{}");
    setParams({ service: svc });
  }

  const selected: Agent | undefined = useMemo(
    () => agents.find((a) => a.service === service),
    [agents, service],
  );

  async function runCall() {
    if (!service) return;
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch (err) {
      alert("Payload no es JSON válido: " + (err as Error).message);
      return;
    }

    const id = counter;
    setCounter(id + 1);
    setRunning(true);
    const t0 = performance.now();
    try {
      const data = await api.call(service, payload);
      const sig =
        (data.result as { _payment?: { signature?: string } })?._payment?.signature ?? undefined;
      setHistory((h) => [
        {
          id,
          service,
          ts: Date.now(),
          ok: true,
          result: data.result,
          cost: { usd: data.cost.usd },
          signature: sig,
          durationMs: performance.now() - t0,
        },
        ...h,
      ]);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err) {
      setHistory((h) => [
        {
          id,
          service,
          ts: Date.now(),
          ok: false,
          error: (err as Error).message,
          durationMs: performance.now() - t0,
        },
        ...h,
      ]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Playground</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Pick an agent, send a payload, see the on-chain settlement happen.
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Send a request</CardTitle>
          <CardDescription>
            The gateway will debit your USD balance and the agent will claim its SOL on devnet.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <label className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-1 block">
              Agent
            </label>
            <select
              value={service}
              onChange={(e) => selectService(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-sm font-mono"
            >
              <option value="" disabled>
                Select an agent…
              </option>
              {agents.map((a) => (
                <option key={a.service} value={a.service}>
                  {a.service} — {formatUsd(solToUsd(a.pricePerCall))}/call
                </option>
              ))}
            </select>
            {selected && (
              <p className="text-xs text-[var(--color-fg-muted)] mt-1">{selected.description}</p>
            )}
          </div>

          <div>
            <label className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-1 block">
              Payload (JSON)
            </label>
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              spellCheck={false}
              rows={8}
              className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-sm font-mono focus:outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--color-fg-muted)]">
              Floor{" "}
              {selected
                ? formatUsd(solToUsd(selected.pricePerCall))
                : "—"}{" "}
              · actual price quoted by agent based on payload
            </div>
            <Button onClick={runCall} disabled={!service || running}>
              <Play className="w-3 h-3" />
              {running ? "Running…" : "Run"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Calls executed in this session.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-3 max-h-[600px] overflow-y-auto">
            {history.map((h) => (
              <div
                key={h.id}
                className={`p-4 rounded-md border ${
                  h.ok
                    ? "border-[var(--color-border)] bg-[var(--color-bg)]"
                    : "border-[var(--color-danger)] bg-[var(--color-danger)]/5"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {h.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-[var(--color-danger)]" />
                    )}
                    <span className="font-mono text-sm">{h.service}</span>
                    {h.cost && <Badge tone="info">{formatUsd(h.cost.usd)}</Badge>}
                    <span className="text-xs text-[var(--color-fg-muted)] font-mono">
                      {h.durationMs.toFixed(0)}ms
                    </span>
                  </div>
                  {h.signature && (
                    <a
                      href={explorerUrl(h.signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-[var(--color-primary)] hover:underline flex items-center gap-1"
                    >
                      {shortSig(h.signature)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {h.error ? (
                  <p className="text-sm text-[var(--color-danger)] font-mono">{h.error}</p>
                ) : (
                  <pre className="text-xs font-mono bg-[var(--color-bg-soft)] p-3 rounded overflow-x-auto">
                    {JSON.stringify(h.result, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
