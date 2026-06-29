import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Agent, type X402Trace } from "@/lib/api";
import { formatKibs, formatUsd, usdToKibs, KIBS_LABEL } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { DEMO_AGENTS } from "@/lib/demoAgents";
import { mascotFor } from "@/lib/agentMascots";
import { Bot, Play } from "lucide-react";
import "./playground.css";

const SAMPLE_PAYLOADS: Record<string, string> = {
  "yield-hunter": `{
  "token": "USDC",
  "riskTolerance": "medium"
}`,
  "risk-auditor": `{
  "protocols": ["Blend", "YieldBlox"]
}`,
  "translator-pro": `{
  "text": "The quarterly report shows a 12% increase in revenue across all regions.",
  "to": "es"
}`,
  "price-oracle": `{
  "symbols": ["XLM", "BTC", "ETH"],
  "vs": "USD"
}`,
  "code-reviewer": `{
  "code": "const x: any = eval('1+1');\\nconsole.log(x);",
  "language": "typescript"
}`,
};

const QUICK_PROMPTS: { label: string; payload: string }[] = [
  {
    label: "Summarize this",
    payload: `{
  "text": "The quarterly report shows a 12% increase in revenue across all regions.",
  "to": "es"
}`,
  },
  {
    label: "List 3 risks",
    payload: `{
  "protocols": ["Blend", "YieldBlox", "Aquarius"]
}`,
  },
  {
    label: "Explain simply",
    payload: `{
  "text": "Explain blockchain escrow in simple terms for a non-technical user.",
  "to": "en"
}`,
  },
];

interface CallEntry {
  id: number;
  service: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  cost?: { usd: number };
  trace?: X402Trace;
  durationMs: number;
}

type FlowStep = { title: string; detail: string; done: boolean; active: boolean };

function buildFlowSteps(trace: X402Trace | undefined, service: string, costUsd?: number): FlowStep[] {
  const quote = trace?.steps.find((s) => s.type === "402_received");
  const escrow = trace?.steps.find((s) => s.type === "escrow_opened");
  const responded = trace?.steps.find((s) => s.type === "service_responded");

  const steps: Omit<FlowStep, "active">[] = [
    {
      title: "Quote received",
      detail: quote
        ? `${service} · ${(Number(quote.quote.amount) / chain.baseUnitsPerToken).toFixed(4)} ${chain.asset}`
        : "Waiting for agent quote…",
      done: !!quote,
    },
    {
      title: "Payment authorized",
      detail: escrow
        ? escrow.signature && escrow.signature !== "NO_ONCHAIN_PROGRAM_ID"
          ? "Escrow opened on-chain"
          : "Balance debited (demo mode)"
        : "Authorize payment from your balance",
      done: !!escrow,
    },
    {
      title: "Agent executed",
      detail: responded ? `HTTP ${responded.status} from agent handler` : "Agent runs your payload",
      done: !!responded,
    },
    {
      title: "Result delivered",
      detail:
        responded && responded.status >= 200 && responded.status < 300
          ? "Response ready in Live response"
          : costUsd != null
            ? `Debited ${formatUsd(costUsd, 4)}`
            : "Awaiting result",
      done: !!(responded && responded.status >= 200 && responded.status < 300),
    },
  ];

  const firstPending = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({
    ...s,
    active: firstPending === -1 ? false : i === firstPending,
  }));
}

function estimateTokens(result: unknown): string {
  if (result == null) return "—";
  const text = JSON.stringify(result);
  return String(Math.max(1, Math.round(text.length / 4)));
}

export default function Playground() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initialService = params.get("service") || "";

  const { data: liveAgents = [] } = useQuery({
    queryKey: ["agents-list-pg"],
    queryFn: api.agents,
  });
  const agents = liveAgents.length > 0 ? liveAgents : DEMO_AGENTS;

  const [service, setService] = useState(initialService);
  const [payloadText, setPayloadText] = useState(
    SAMPLE_PAYLOADS[initialService] || QUICK_PROMPTS[0].payload,
  );
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<CallEntry | null>(null);
  const counterRef = useRef(1);

  useEffect(() => {
    if (!service && agents.length > 0) {
      const first = agents[0].service;
      setService(first);
      setPayloadText(SAMPLE_PAYLOADS[first] || QUICK_PROMPTS[0].payload);
    }
  }, [agents, service]);

  function selectService(svc: string) {
    setService(svc);
    setPayloadText(SAMPLE_PAYLOADS[svc] || QUICK_PROMPTS[0].payload);
    setParams({ service: svc });
  }

  const selected = useMemo(
    () => agents.find((a: Agent) => a.service === service),
    [agents, service],
  );

  const estUsd = selected ? solToUsd(selected.pricePerCall) : 0;
  const agentMascot = service ? mascotFor(service) : "/agents/circulo.png";
  const flowSteps = buildFlowSteps(latest?.trace, latest?.service ?? service, latest?.cost?.usd);

  async function runCall() {
    if (!service) return;
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch (err) {
      alert("Payload no es JSON válido: " + (err as Error).message);
      return;
    }

    counterRef.current += 1;
    setRunning(true);
    const t0 = performance.now();
    try {
      const data = await api.call(service, payload);
      setLatest({
        id: counterRef.current,
        service,
        ok: true,
        result: data.result,
        cost: { usd: data.cost.usd },
        trace: data.trace,
        durationMs: performance.now() - t0,
      });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    } catch (err) {
      setLatest({
        id: counterRef.current,
        service,
        ok: false,
        error: (err as Error).message,
        durationMs: performance.now() - t0,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="playground-page">
      <header className="playground-head">
        <h1 className="playground-title">Playground</h1>
        <p className="playground-subtitle">
          Describe a task, run a call, and watch the x402 payment flow settle on-chain.
        </p>
      </header>

      <div className="playground-grid">
        {/* ── Send request ── */}
        <section className="playground-card">
          <div className="playground-card__head">
            <h2 className="playground-card__title">Send a request</h2>
            <p className="playground-card__desc">
              Pick an agent, edit the JSON payload, and run a live call.
            </p>
          </div>
          <div className="playground-card__body">
            <label className="playground-label" htmlFor="pg-agent">
              Agent
            </label>
            <select
              id="pg-agent"
              className="playground-select"
              value={service}
              onChange={(e) => selectService(e.target.value)}
            >
              <option value="" disabled>
                Select an agent…
              </option>
              {agents.map((a: Agent) => (
                <option key={a.service} value={a.service}>
                  {serviceToName(a.service)}
                </option>
              ))}
            </select>

            <div className="playground-tip">
              <p>
                <strong>Tip:</strong> Use the prompts below or write your own JSON payload.
              </p>
              <img
                key={service}
                src={agentMascot}
                alt=""
                aria-hidden
                className="playground-tip__mascot"
              />
            </div>

            <div className="playground-prompts">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="playground-prompt"
                  onClick={() => setPayloadText(p.payload)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="playground-label" htmlFor="pg-payload">
              Payload (JSON)
            </label>
            <textarea
              id="pg-payload"
              className="playground-textarea"
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              spellCheck={false}
            />

            <div className="playground-cost">
              Estimated cost: <strong>{formatUsd(estUsd, 4)}</strong>
              <span style={{ color: "var(--color-fg-muted)" }}> · amount scales with payload</span>
            </div>

            <div className="playground-run-row">
              <img
                key={`run-${service}`}
                src={agentMascot}
                alt=""
                aria-hidden
                className="playground-run-row__mascot"
              />
              <button
                type="button"
                className="playground-run-btn"
                onClick={runCall}
                disabled={!service || running}
              >
                <Play size={16} fill="currentColor" />
                {running ? "Running…" : "Run request"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Right column ── */}
        <div className="playground-right">
          <section className="playground-card">
            <div className="playground-card__head">
              <div className="playground-response-head">
                <h2 className="playground-card__title" style={{ margin: 0 }}>
                  Live response
                </h2>
                <span
                  className={`playground-status ${
                    latest?.ok
                      ? "playground-status--ok"
                      : latest && !latest.ok
                        ? "playground-status--err"
                        : "playground-status--idle"
                  }`}
                >
                  {latest?.ok ? "200 OK" : latest && !latest.ok ? "Error" : "Idle"}
                </span>
              </div>
            </div>
            <div className="playground-card__body">
              {latest?.ok ? (
                <pre className="playground-json">{JSON.stringify(latest.result, null, 2)}</pre>
              ) : latest?.error ? (
                <pre className="playground-json" style={{ color: "var(--color-danger)" }}>
                  {latest.error}
                </pre>
              ) : (
                <p className="playground-json playground-json--placeholder">
                  Run a request to see the agent response here.
                </p>
              )}

              <dl className="playground-meta">
                <div>
                  <dt>Processing time</dt>
                  <dd>{latest ? `${Math.round(latest.durationMs)}ms` : "—"}</dd>
                </div>
                <div>
                  <dt>Balance debited</dt>
                  <dd>
                    {latest?.cost
                      ? `${formatKibs(usdToKibs(latest.cost.usd))} ${KIBS_LABEL}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Tokens used</dt>
                  <dd>{latest?.ok ? estimateTokens(latest.result) : "—"}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="playground-card playground-flow" style={{ marginTop: 16 }}>
            <div className="playground-card__head">
              <h2 className="playground-card__title">Payment flow</h2>
              <p className="playground-card__desc">x402 handshake step by step.</p>
            </div>
            <div className="playground-card__body">
              {flowSteps.map((step) => (
                <div
                  key={step.title}
                  className={`playground-flow-step${step.done ? " is-done" : ""}${step.active ? " is-active" : ""}`}
                >
                  <div className="playground-flow-dot">{step.done ? "✓" : "·"}</div>
                  <div>
                    <p className="playground-flow-title">{step.title}</p>
                    <p className="playground-flow-detail">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="playground-cta">
        <div>
          <p className="playground-cta__text">Building something awesome?</p>
          <Link to="/app/agents" className="playground-cta-btn">
            <Bot size={16} />
            Explore agents
          </Link>
        </div>
        <img
          key={`cta-${service}`}
          src={agentMascot}
          alt=""
          aria-hidden
          className="playground-cta__mascot"
        />
      </section>
    </div>
  );
}
