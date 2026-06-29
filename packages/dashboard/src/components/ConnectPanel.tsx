import { useState } from "react";
import { Link } from "react-router-dom";
import { Plug, Terminal, Copy, Check, ArrowRight, ExternalLink, Download } from "lucide-react";
import "./connect.css";

/**
 * URL pública del conector MCP remoto del gateway. Se sobreescribe en build con
 * VITE_MCP_URL (Vercel) cuando exista un dominio bonito; el fallback apunta al
 * gateway de producción vivo.
 */
const MCP_URL =
  (import.meta.env.VITE_MCP_URL as string | undefined) ??
  "https://gateway-production-be17.up.railway.app/mcp";

/** Base del gateway (sin /mcp) para el adaptador stdio `kiba-mcp` (KIBA_URL). */
const GATEWAY_BASE = MCP_URL.replace(/\/mcp\/?$/, "");

/** Instalador de un clic (Windows) publicado en los releases del repo. */
const INSTALLER_URL =
  "https://github.com/CoKeFish/kiba/releases/latest/download/Kiba-Installer-x64-setup.exe";

const INSTALL_CONFIG = JSON.stringify(
  {
    mcpServers: {
      kiba: {
        command: "npx",
        args: ["-y", "kiba-mcp"],
        env: { KIBA_URL: GATEWAY_BASE },
      },
    },
  },
  null,
  2,
);

const CLAUDE_STEPS = [
  "Settings → Connectors → “Add custom connector”",
  "Paste the connector URL above",
  "Click “Add” and sign in to Kiba to authorize",
];

const CHATGPT_STEPS = [
  "Settings → Apps & Connectors → Advanced settings → enable “Developer mode”",
  "Connectors → “Create”, name it and paste the URL",
  "Click “Create” and authorize (OAuth)",
];

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

function CopyableUrl() {
  const { copied, copy } = useCopy();
  return (
    <div className="connect-url-row">
      <code className="connect-url-code">{MCP_URL}</code>
      <button type="button" className="connect-copy-btn" onClick={() => copy(MCP_URL)} aria-label="Copy connector URL">
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CopyableConfig() {
  const { copied, copy } = useCopy();
  return (
    <div className="connect-code">
      <button type="button" className="connect-code__copy" onClick={() => copy(INSTALL_CONFIG)} aria-label="Copy config">
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="connect-code__pre">{INSTALL_CONFIG}</pre>
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
          Open <ExternalLink size={13} />
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
 * Panel para empezar a usar Kiba: conectar por web (Claude/ChatGPT) o instalar
 * el adaptador en el editor (Cursor, Claude Code, Claude Desktop).
 * - `compact`: banner para la home (lleva a /app/connect).
 * - completo: las dos opciones con pasos.
 */
export function ConnectPanel({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <section className="connect-banner">
        <div className="connect-banner__copy">
          <h3 className="connect-banner__title">Get started with Kiba</h3>
          <p className="connect-banner__text">
            Connect it to Claude or ChatGPT, or install it in your editor — then discover and pay
            agents straight from your chat.
          </p>
          <Link to="/app/connect" className="connect-banner__btn">
            Get started <ArrowRight size={16} />
          </Link>
        </div>
        <img src="/agents/estrella.png" alt="" aria-hidden className="connect-banner__mascot" />
      </section>
    );
  }

  return (
    <div className="connect-methods">
      {/* Method 1 — web (Claude / ChatGPT) */}
      <section className="connect-method">
        <div className="connect-method__head">
          <span className="connect-method__num">1</span>
          <div>
            <h2 className="connect-method__title">Use it in Claude or ChatGPT (web)</h2>
            <p className="connect-method__sub">
              Paste one URL — nothing to install. Works in Claude (web &amp; desktop) and ChatGPT.
            </p>
          </div>
        </div>

        <div className="connect-url-card">
          <p className="connect-url-card__label">
            <Plug size={16} /> Connector URL (MCP)
          </p>
          <p className="connect-url-card__desc">
            It asks you to sign in to Kiba (OAuth) — no API keys, no extra setup.
          </p>
          <CopyableUrl />
        </div>

        <div className="connect-steps">
          <StepCard title="Claude" steps={CLAUDE_STEPS} href="https://claude.ai" />
          <StepCard title="ChatGPT" steps={CHATGPT_STEPS} href="https://chatgpt.com" beta />
        </div>
      </section>

      {/* Method 2 — install (IDE / CLI) */}
      <section className="connect-method">
        <div className="connect-method__head">
          <span className="connect-method__num">2</span>
          <div>
            <h2 className="connect-method__title">Install in your editor (Cursor, Claude Code, Claude Desktop)</h2>
            <p className="connect-method__sub">
              Get the one-click installer, or add the server to your MCP config manually.
            </p>
          </div>
        </div>

        <div className="connect-url-card">
          <p className="connect-url-card__label">
            <Download size={16} /> One-click installer (Windows)
          </p>
          <p className="connect-url-card__desc">
            Installs the kiba server into Claude Desktop, Cursor and Claude Code automatically —
            per-user, no admin required.
          </p>
          <a
            className="connect-download-btn"
            href={INSTALLER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} /> Download for Windows
          </a>
          <p className="connect-download-note">macOS / Linux? Use the manual config below.</p>
        </div>

        <p className="connect-or">Or add it manually (any OS):</p>

        <div className="connect-url-card">
          <p className="connect-url-card__label">
            <Terminal size={16} /> MCP config (npx kiba-mcp)
          </p>
          <p className="connect-url-card__desc">
            Add this to your MCP settings (e.g. <code>~/.claude.json</code> or your IDE), then restart.
            On first use your browser opens to sign in to Kiba.
          </p>
          <CopyableConfig />
        </div>
      </section>

      <p className="connect-foot">
        Authorized apps show up under{" "}
        <Link to="/app/credentials">Credentials → Connected apps</Link>, where you can revoke them
        anytime.
      </p>
    </div>
  );
}
