import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Agent, type X402Trace, type X402Step } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatKibs, formatKibsLabel, usdToKibs, KIBS_LABEL, shortSig, explorerUrl } from "@/lib/format";
import { chain } from "@/lib/chain";
import {
  Play,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Search,
  Lock,
  ShieldCheck,
  CreditCard,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const solToUsd = (sol: number) => sol * chain.usdRate;

// Cada agente cobra dinámicamente según el payload — prueba editando los
// valores y observa cómo cambia el quote en el x402 trace.
const SAMPLE_PAYLOADS: Record<string, string> = {
  "yield-hunter": `{
  "token": "USDC",
  "riskTolerance": "medium"
}`,
  "risk-auditor": `{
  "protocols": ["Blend", "YieldBlox"]
}`,
  "translator-pro": `{
  "text": "hello world",
  "to": "es"
}`,
  "price-oracle": `{
  "symbols": ["XLM", "BTC", "ETH"],
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
  trace?: X402Trace;
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
  // Counter solo se usa para asignar IDs a las entries del history — no necesita
  // re-render del componente cuando incrementa.
  const counterRef = useRef(1);

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

    const id = counterRef.current;
    counterRef.current += 1;
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
          trace: data.trace,
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
            The gateway will debit your USD balance and the agent will claim its {chain.asset} on {chain.networkLabel}.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <label
              htmlFor="pg-agent"
              className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-1 block"
            >
              Agent
            </label>
            <select
              id="pg-agent"
              value={service}
              onChange={(e) => selectService(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-sm font-mono"
            >
              <option value="" disabled>
                Select an agent…
              </option>
              {agents.map((a) => (
                <option key={a.service} value={a.service}>
                  {a.service} — {formatKibsLabel(usdToKibs(solToUsd(a.pricePerCall)))}/call
                </option>
              ))}
            </select>
            {selected && (
              <p className="text-xs text-[var(--color-fg-muted)] mt-1">{selected.description}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="pg-payload"
              className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-1 block"
            >
              Payload (JSON)
            </label>
            <textarea
              id="pg-payload"
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
                ? formatKibsLabel(usdToKibs(solToUsd(selected.pricePerCall)))
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
                    {h.cost && (
                      <Badge tone="info">
                        {formatKibs(usdToKibs(h.cost.usd))} {KIBS_LABEL}
                      </Badge>
                    )}
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
                  <>
                    <pre className="text-xs font-mono bg-[var(--color-bg-soft)] p-3 rounded overflow-x-auto">
                      {JSON.stringify(h.result, null, 2)}
                    </pre>
                    {h.trace && <X402TraceView trace={h.trace} />}
                  </>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
//   X402TraceView — timeline del handshake x402 paso a paso
// ════════════════════════════════════════════════════════════════

const STEP_META: Record<
  X402Step["type"],
  { icon: typeof Search; label: string; tone: "neutral" | "warning" | "info" | "success" }
> = {
  discover: { icon: Search, label: "Discover", tone: "neutral" },
  "402_received": { icon: Lock, label: "HTTP 402 received", tone: "warning" },
  escrow_opened: { icon: ShieldCheck, label: "open_escrow", tone: "info" },
  service_responded: { icon: CreditCard, label: "Service + claim_payment", tone: "success" },
};

function X402TraceView({ trace }: { trace: X402Trace }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span className="font-medium">x402 trace</span>
          <span className="font-mono">
            {trace.steps.length} steps · {trace.totalDurationMs}ms total
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2 pl-1">
          {trace.steps.map((step, i) => (
            <X402StepCard key={`${step.type}-${step.timestamp}`} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function X402StepCard({ step, index }: { step: X402Step; index: number }) {
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center pt-1">
        <div className="w-6 h-6 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center">
          <Icon className="w-3 h-3" />
        </div>
        <div className="w-px flex-1 bg-[var(--color-border)] mt-1" />
      </div>
      <div className="flex-1 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium">
            {index + 1}. {meta.label}
          </span>
          <Badge tone={meta.tone}>{step.type}</Badge>
          <span className="text-xs text-[var(--color-fg-muted)] font-mono">
            +{step.durationMs}ms
          </span>
        </div>
        <div className="mt-1 text-xs text-[var(--color-fg-muted)]">
          <X402StepDetails step={step} />
        </div>
      </div>
    </div>
  );
}

function X402StepDetails({ step }: { step: X402Step }) {
  if (step.type === "discover") {
    return (
      <div className="space-y-1 font-mono">
        <div>
          GET <span className="text-[var(--color-fg)]">{step.endpoint}</span>
        </div>
        <div>
          <span className="text-[var(--color-fg)]">{step.service}</span> · price{" "}
          <span className="text-[var(--color-success)]">
            {step.pricePerCall.toFixed(6)} {chain.asset}
          </span>
        </div>
      </div>
    );
  }
  if (step.type === "402_received") {
    const lamports = Number(step.quote.amount);
    return (
      <div className="space-y-1 font-mono">
        <div>
          POST {step.quote.asset === "SOL" ? "" : ""}/service → <span className="text-[var(--color-warning)]">402 Payment Required</span>
        </div>
        <div>
          amount: <span className="text-[var(--color-fg)]">{lamports.toLocaleString()}</span>{" "}
          base units ({(lamports / chain.baseUnitsPerToken).toFixed(6)} {chain.asset})
        </div>
        <div>
          payTo: <span className="text-[var(--color-fg)]">{shortSig(step.quote.payTo, 6)}</span>
        </div>
        <div>
          nonce: <span className="text-[var(--color-fg)]">{step.quote.nonce}</span>
        </div>
      </div>
    );
  }
  if (step.type === "escrow_opened") {
    const isReal = step.signature && step.signature !== "NO_ONCHAIN_PROGRAM_ID";
    return (
      <div className="space-y-1 font-mono">
        <div>
          locked <span className="text-[var(--color-fg)]">{Number(step.amount).toLocaleString()}</span>{" "}
          base units in escrow
        </div>
        {isReal ? (
          <div className="flex items-center gap-1">
            sig:
            <a
              href={explorerUrl(step.signature)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:underline flex items-center gap-1"
            >
              {shortSig(step.signature)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <div className="text-[var(--color-fg-muted)]">no on-chain (degraded mode)</div>
        )}
      </div>
    );
  }
  if (step.type === "service_responded") {
    return (
      <div className="space-y-1 font-mono">
        <div>
          POST /service + X-PAYMENT →{" "}
          <span className="text-[var(--color-success)]">{step.status} OK</span>
        </div>
        <div>agent verified escrow on-chain → executed handler</div>
        {step.claimSignature && (
          <div className="flex items-center gap-1">
            claim sig:
            <a
              href={explorerUrl(step.claimSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:underline flex items-center gap-1"
            >
              {shortSig(step.claimSignature)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
        {step.claimedAmount && (
          <div>
            split: 95% to owner / 5% to platform treasury · gross{" "}
            {Number(step.claimedAmount).toLocaleString()} base units
          </div>
        )}
      </div>
    );
  }
  return null;
}
