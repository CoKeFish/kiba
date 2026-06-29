import { useState } from "react";
import { Link } from "react-router-dom";
import { Plug, Copy, Check, ArrowRight, ExternalLink } from "lucide-react";
import "./connect.css";

/**
 * URL pública del conector MCP remoto del gateway. Se sobreescribe en build con
 * VITE_MCP_URL (Vercel) cuando exista un dominio bonito; el fallback apunta al
 * gateway de producción vivo.
 */
const MCP_URL =
  (import.meta.env.VITE_MCP_URL as string | undefined) ??
  "https://gateway-production-be17.up.railway.app/mcp";

const CLAUDE_STEPS = [
  "Settings → Connectors → “Add custom connector”",
  "Pega la URL del conector de arriba",
  "Pulsa “Add” e inicia sesión en Kiba para autorizar",
];

const CHATGPT_STEPS = [
  "Settings → Apps & Connectors → Advanced settings → activa “Developer mode”",
  "Connectors → “Create”, pon un nombre y pega la URL",
  "Pulsa “Create” y autoriza (OAuth)",
];

function CopyableUrl() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="connect-url-row">
      <code className="connect-url-code">{MCP_URL}</code>
      <button type="button" className="connect-copy-btn" onClick={copy} aria-label="Copiar URL del conector">
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function StepCard({
  title,
  steps,
  href,
  beta,
}: {
  title: string;
  steps: string[];
  href: string;
  beta?: boolean;
}) {
  return (
    <div className="connect-step-card">
      <div className="connect-step-card__head">
        <div className="connect-step-card__title-wrap">
          <h3 className="connect-step-card__title">{title}</h3>
          {beta && <span className="connect-beta">Beta</span>}
        </div>
        <a href={href} target="_blank" rel="noopener noreferrer" className="connect-open-link">
          Abrir <ExternalLink size={13} />
        </a>
      </div>
      <ol className="connect-steps-list">
        {steps.map((s, i) => (
          <li key={i} className="connect-step">
            <span className="connect-step__num">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Panel para conectar la cuenta de Kiba a Claude / ChatGPT vía el conector MCP remoto.
 * - `compact`: banner para la home (lleva a /app/connect).
 * - completo: URL + pasos lado a lado (página dedicada).
 */
export function ConnectPanel({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <section className="connect-banner">
        <div className="connect-banner__copy">
          <h3 className="connect-banner__title">Conecta Kiba a Claude y ChatGPT</h3>
          <p className="connect-banner__text">
            Añádelo como conector y descubre y paga agentes desde tu chat, sin salir del asistente.
          </p>
          <Link to="/app/connect" className="connect-banner__btn">
            Conectar <ArrowRight size={16} />
          </Link>
        </div>
        <img src="/agents/estrella.png" alt="" aria-hidden className="connect-banner__mascot" />
      </section>
    );
  }

  return (
    <>
      <div className="connect-url-card">
        <p className="connect-url-card__label">
          <Plug size={16} /> URL del conector (MCP)
        </p>
        <p className="connect-url-card__desc">
          Pega esta URL en Claude o ChatGPT. Te pedirá iniciar sesión en Kiba (OAuth) — no necesitas
          API keys ni configurar nada más.
        </p>
        <CopyableUrl />
      </div>

      <div className="connect-steps">
        <StepCard title="Claude" steps={CLAUDE_STEPS} href="https://claude.ai" />
        <StepCard title="ChatGPT" steps={CHATGPT_STEPS} href="https://chatgpt.com" beta />
      </div>

      <p className="connect-foot">
        Una vez autorizado, la conexión aparece en{" "}
        <Link to="/app/credentials">Credentials → Connected apps</Link>, donde puedes revocarla
        cuando quieras.
      </p>
    </>
  );
}
