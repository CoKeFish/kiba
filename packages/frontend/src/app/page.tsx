'use client';

import { useEffect, useRef, useState } from 'react';

interface Agent {
  service: string;
  pricePerCall: number;
  description?: string;
  endpoint: string;
  ownerWallet: string;
  acceptedToken: string;
  totalCalls?: number;
  totalEarned?: number;
}

interface IntentResult {
  intent: string;
  plan: { service: string; reason: string }[];
  results: { service: string; success: boolean; data?: unknown; error?: string; durationMs: number }[];
  walletUsed?: string;
  durationMs: number;
}

interface ProgramEvent {
  type: 'program_event' | 'snapshot';
  signature?: string;
  slot?: string;
  logs?: string[];
  agents?: Agent[];
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || 'http://localhost:6000';

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Live events
  const [events, setEvents] = useState<{ ts: number; signature: string; logs: string[] }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Intent demo
  const [intent, setIntent] = useState(
    'Quiero el mejor yield para mis USDC y saber el riesgo del protocolo',
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<IntentResult | null>(null);
  const [intentErr, setIntentErr] = useState<string | null>(null);

  function loadAgents() {
    fetch(`${BACKEND_URL}/agents`)
      .then((r) => r.json())
      .then((data) => {
        setAgents(data);
        setLoading(false);
        setErr(null);
      })
      .catch((e) => {
        setErr(e.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadAgents();

    // WebSocket para eventos en vivo
    const wsUrl = BACKEND_URL.replace(/^http/, 'ws') + '/ws';
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onmessage = (msg) => {
        try {
          const event: ProgramEvent = JSON.parse(msg.data);
          if (event.type === 'snapshot' && event.agents) {
            setAgents(event.agents);
          } else if (event.type === 'program_event' && event.signature) {
            setEvents((prev) =>
              [
                {
                  ts: Date.now(),
                  signature: event.signature!,
                  logs: event.logs ?? [],
                },
                ...prev,
              ].slice(0, 10),
            );
            // Recargar el catálogo (puede haber un agente nuevo)
            loadAgents();
          }
        } catch {
          // ignore malformed
        }
      };
      ws.onerror = () => {/* no-op */};
    } catch {
      // ignore — WS opcional
    }

    return () => wsRef.current?.close();
  }, []);

  async function runIntent() {
    setRunning(true);
    setResult(null);
    setIntentErr(null);
    try {
      const r = await fetch(`${ORCHESTRATOR_URL}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'request failed');
      setResult(data);
    } catch (e) {
      setIntentErr(e instanceof Error ? e.message : 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <header className="mb-12">
        <h1 className="text-5xl font-bold mb-2">
          Agent <span className="text-accent">Bazaar</span>
        </h1>
        <p className="text-neutral-400 text-lg">
          Marketplace descentralizado de agentes IA con pagos x402 en Solana
        </p>
      </header>

      {/* ─── Intent demo ──────────────────────────────────────── */}
      <section className="mb-12 bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl font-semibold mb-4">Probá la plataforma</h2>
        <p className="text-neutral-400 text-sm mb-4">
          Escribí lo que quieres. El Orchestrator Agent decide qué specialists llamar, paga vía
          x402 on-chain y devuelve el resultado combinado.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={running}
            className="flex-1 bg-bg border border-border rounded px-4 py-2 font-mono text-sm focus:border-accent outline-none"
            placeholder="Quiero el mejor yield..."
          />
          <button
            onClick={runIntent}
            disabled={running || !intent}
            className="bg-accent hover:bg-accent/80 disabled:opacity-40 px-6 py-2 rounded font-medium transition"
          >
            {running ? 'Corriendo...' : 'Ejecutar'}
          </button>
        </div>

        {intentErr && <div className="mt-4 text-red-400 text-sm">Error: {intentErr}</div>}

        {result && (
          <div className="mt-6 space-y-4">
            <div>
              <div className="text-neutral-500 text-xs uppercase mb-2">
                Plan ({result.plan.length} specialist{result.plan.length === 1 ? '' : 's'})
              </div>
              {result.plan.map((t) => (
                <div key={t.service} className="text-sm font-mono">
                  → <span className="text-accent2">{t.service}</span>
                  <span className="text-neutral-500"> · {t.reason}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-neutral-500 text-xs uppercase mb-2">
                Resultados ({result.durationMs}ms)
              </div>
              {result.results.map((r) => (
                <div
                  key={r.service}
                  className="bg-bg border border-border rounded p-3 mb-2 font-mono text-xs"
                >
                  <div className="flex justify-between mb-1">
                    <span className={r.success ? 'text-accent2' : 'text-red-400'}>
                      {r.service} {r.success ? '✓' : '✗'}
                    </span>
                    <span className="text-neutral-500">{r.durationMs}ms</span>
                  </div>
                  <pre className="text-neutral-300 whitespace-pre-wrap">
                    {JSON.stringify(r.data ?? r.error, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ─── Live events feed ─────────────────────────────────── */}
      {events.length > 0 && (
        <section className="mb-12 bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">
            Transacciones en vivo <span className="text-accent2 text-sm">on-chain</span>
          </h2>
          <div className="space-y-2 font-mono text-xs">
            {events.map((e) => (
              <div
                key={e.signature}
                className="bg-bg border border-border rounded p-2 hover:border-accent2 transition"
              >
                <div className="flex justify-between mb-1">
                  <a
                    href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent2 truncate max-w-md hover:underline"
                  >
                    {e.signature}
                  </a>
                  <span className="text-neutral-500">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                </div>
                {e.logs.slice(0, 3).map((l, i) => (
                  <div key={i} className="text-neutral-500 truncate">
                    {l}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Catalog ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">
          Agentes registrados <span className="text-neutral-500 text-base">({agents.length})</span>
        </h2>

        {loading && <div className="text-neutral-500">Cargando...</div>}
        {err && (
          <div className="text-red-400">
            Error conectando al backend: {err}
            <br />
            <span className="text-neutral-500 text-sm">¿Está corriendo `docker compose up`?</span>
          </div>
        )}
        {!loading && !err && agents.length === 0 && (
          <div className="text-neutral-500 text-sm bg-panel border border-border rounded p-4">
            No hay agentes registrados aún.
            <br />
            ¿Ya hiciste deploy del programa? Entrá al container `contracts` y corré <code>bazaar deploy</code>.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((a) => (
            <div
              key={a.service}
              className="bg-panel border border-border rounded-lg p-5 hover:border-accent transition"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-xl font-semibold">{a.service}</h3>
                <span className="text-accent2 font-mono text-sm">
                  {a.pricePerCall} {a.acceptedToken}
                </span>
              </div>
              {a.description && <p className="text-neutral-400 text-sm mb-3">{a.description}</p>}
              <div className="text-xs text-neutral-500 font-mono truncate mb-2">{a.endpoint}</div>
              {(a.totalCalls !== undefined || a.totalEarned !== undefined) && (
                <div className="text-xs text-neutral-500 flex gap-4 pt-2 border-t border-border">
                  <span>{a.totalCalls ?? 0} calls</span>
                  <span>{(a.totalEarned ?? 0).toFixed(4)} SOL ganados</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 pt-6 border-t border-border text-sm text-neutral-500">
        Phase 2 · Backend: {BACKEND_URL} · Orchestrator: {ORCHESTRATOR_URL}
      </footer>
    </main>
  );
}
