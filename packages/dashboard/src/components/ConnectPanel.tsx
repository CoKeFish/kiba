import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  "connect.panel.claude_step_1",
  "connect.panel.claude_step_2",
  "connect.panel.claude_step_3",
];

const CHATGPT_STEPS = [
  "connect.panel.chatgpt_step_1",
  "connect.panel.chatgpt_step_2",
  "connect.panel.chatgpt_step_3",
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
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <div className="connect-url-row">
      <code className="connect-url-code">{MCP_URL}</code>
      <button type="button" className="connect-copy-btn" onClick={() => copy(MCP_URL)} aria-label={t("connect.panel.copy_url_aria")}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? t("connect.panel.copied") : t("connect.panel.copy")}
      </button>
    </div>
  );
}

function CopyableConfig() {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <div className="connect-code">
      <button type="button" className="connect-code__copy" onClick={() => copy(INSTALL_CONFIG)} aria-label={t("connect.panel.copy_config_aria")}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? t("connect.panel.copied") : t("connect.panel.copy")}
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
  const { t } = useTranslation();
  return (
    <div className="connect-step-card">
      <div className="connect-step-card__head">
        <div className="connect-step-card__title-wrap">
          <h3 className="connect-step-card__title">{title}</h3>
          {beta && <span className="connect-beta">{t("connect.panel.beta")}</span>}
        </div>
        <a href={href} target="_blank" rel="noopener noreferrer" className="connect-open-link">
          {t("connect.panel.open")} <ExternalLink size={13} />
        </a>
      </div>
      <ol className="connect-steps-list">
        {steps.map((s, i) => (
          <li key={i} className="connect-step">
            <span className="connect-step__num">{i + 1}</span>
            <span>{t(s)}</span>
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
  const { t } = useTranslation();
  if (compact) {
    return (
      <section className="connect-banner">
        <div className="connect-banner__copy">
          <h3 className="connect-banner__title">{t("connect.panel.banner_title")}</h3>
          <p className="connect-banner__text">{t("connect.panel.banner_text")}</p>
          <Link to="/app/connect" className="connect-banner__btn">
            {t("connect.panel.banner_btn")} <ArrowRight size={16} />
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
            <h2 className="connect-method__title">{t("connect.panel.method1_title")}</h2>
            <p className="connect-method__sub">{t("connect.panel.method1_sub")}</p>
          </div>
        </div>

        <div className="connect-url-card">
          <p className="connect-url-card__label">
            <Plug size={16} /> {t("connect.panel.connector_url_label")}
          </p>
          <p className="connect-url-card__desc">
            {t("connect.panel.connector_url_desc")}
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
            <h2 className="connect-method__title">{t("connect.panel.method2_title")}</h2>
            <p className="connect-method__sub">{t("connect.panel.method2_sub")}</p>
          </div>
        </div>

        <div className="connect-url-card">
          <p className="connect-url-card__label">
            <Download size={16} /> {t("connect.panel.installer_label")}
          </p>
          <p className="connect-url-card__desc">
            {t("connect.panel.installer_desc")}
          </p>
          <a
            className="connect-download-btn"
            href={INSTALLER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} /> {t("connect.panel.download_btn")}
          </a>
          <p className="connect-download-note">{t("connect.panel.download_note")}</p>
        </div>

        <p className="connect-or">{t("connect.panel.or_manual")}</p>

        <div className="connect-url-card">
          <p className="connect-url-card__label">
            <Terminal size={16} /> {t("connect.panel.config_label")}
          </p>
          <p className="connect-url-card__desc">
            {t("connect.panel.config_desc_1")} <code>~/.claude.json</code>{" "}
            {t("connect.panel.config_desc_2")}
          </p>
          <CopyableConfig />
        </div>
      </section>

      <p className="connect-foot">
        {t("connect.panel.foot_1")}{" "}
        <Link to="/app/credentials">{t("connect.panel.foot_link")}</Link>
        {t("connect.panel.foot_2")}
      </p>
    </div>
  );
}
