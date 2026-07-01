import { useState } from "react";

type Tab = {
  id: string;
  label: string;
  desc: string;
  code: string;
};

// Textos i18n (label/desc): el .astro padre los pasa como props. El código NO se traduce.
export type CodeTabsStrings = {
  sdk: { label: string; desc: string };
  rest: { label: string; desc: string };
  mcp: { label: string; desc: string };
  installer: { label: string; desc: string };
};

const DEFAULT_CODETABS_STRINGS: CodeTabsStrings = {
  sdk: { label: "Native SDK", desc: "Self-custodial. Sign with your own keypair — gas only, no gateway fee." },
  rest: { label: "Gateway REST", desc: "Custodial. Top up USD credits, call any agent over HTTPS with an API key." },
  mcp: { label: "MCP Server", desc: "OAuth-based. No API keys. Plug directly into Claude Desktop or Cursor." },
  installer: { label: "One-click .exe", desc: "For non-technical users. Download a 1.1 MB installer, double-click, and your AI assistant gains four new tools. Zero JSON, zero terminal." },
};

const TAB_CODE: Record<string, string> = {
  sdk: `import { AgentClient } from 'kiba-sdk';

const client = new AgentClient({
  keypair: myWallet,
  rpcUrl: 'https://soroban-testnet.stellar.org',
});

const result = await client.call('yield-hunter', {
  token: 'USDC',
});`,
  rest: `const res = await fetch('https://gateway-production-be17.up.railway.app/v1/call', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk_live_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    service: 'yield-hunter',
    payload: { token: 'USDC' },
  }),
});`,
  mcp: `// Add to your Claude Desktop config (~/claude.json):
{
  "mcpServers": {
    "kiba": {
      "command": "npx",
      "args": ["-y", "kiba-mcp"]
    }
  }
}

// Ask Claude: "find the best yield with risk audit"
// → browser opens once for OAuth, never again.`,
  installer: `# Windows — downloads instantly:
https://github.com/CoKeFish/kiba/releases/latest/download/Kiba-Installer-x64-setup.exe

# The installer:
#   1. Detects Claude Desktop, Cursor, and Claude Code
#   2. Backs up your existing MCP config
#   3. Inserts the kiba block automatically
#   4. Opens the dashboard so you can sign in

# Other OS — same effect via npx:
npx -y kiba-mcp`,
};

const TAB_ORDER = ["sdk", "rest", "mcp", "installer"] as const;

export default function CodeTabs({ strings }: { strings?: CodeTabsStrings }) {
  const s = strings ?? DEFAULT_CODETABS_STRINGS;
  const tabs: Tab[] = TAB_ORDER.map((id) => ({
    id,
    label: s[id].label,
    desc: s[id].desc,
    code: TAB_CODE[id],
  }));
  const [active, setActive] = useState(tabs[0].id);
  const tab = tabs.find((t) => t.id === active)!;

  return (
    <div style={{
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border-default)",
      background: "var(--bg-card)",
      overflow: "hidden",
    }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border-default)",
      }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              padding: "14px 20px",
              fontFamily: "var(--font-display)",
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              borderRight: "1px solid var(--border-default)",
              cursor: "pointer",
              transition: "all var(--dur-fast) var(--ease-out)",
              background: active === t.id ? "var(--bg-elevated)" : "transparent",
              color: active === t.id ? "var(--fg-1)" : "var(--fg-3)",
              borderBottom: active === t.id ? "1px solid var(--accent)" : "none",
              position: "relative",
              top: active === t.id ? 1 : 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div style={{ padding: 32 }}>
        <p style={{
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: "var(--fg-2)",
          marginBottom: 20,
          lineHeight: 1.55,
        }}>{tab.desc}</p>
        <pre style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.65,
          overflowX: "auto",
          padding: "20px 24px",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-canvas)",
          border: "1px solid var(--border-subtle)",
          color: "var(--fg-2)",
          margin: 0,
        }}>
          <code style={{ color: "var(--fg-2)" }}>{tab.code}</code>
        </pre>
      </div>
    </div>
  );
}
