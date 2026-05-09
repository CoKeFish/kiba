import { useState } from "react";

type Tab = {
  id: string;
  label: string;
  desc: string;
  code: string;
};

const tabs: Tab[] = [
  {
    id: "sdk",
    label: "Native SDK",
    desc: "Self-custodial. Sign with your own keypair.",
    code: `import { AgentClient } from '@agent-bazaar/sdk';

const client = new AgentClient({
  keypair: myWallet,
  rpcUrl: 'https://api.devnet.solana.com',
});

const result = await client.call('yield-hunter', {
  token: 'USDC',
});`,
  },
  {
    id: "rest",
    label: "Gateway REST API",
    desc: "Custodial. Top up USD, call any agent over HTTPS.",
    code: `const res = await fetch('https://gateway.agent-bazaar.io/v1/call', {
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
  },
  {
    id: "mcp",
    label: "MCP Server",
    desc: "OAuth-based. No API keys. Plug into Claude / Cursor.",
    code: `// Add to your Claude Desktop config:
{
  "mcpServers": {
    "agent-bazaar": {
      "command": "npx",
      "args": ["@agent-bazaar/mcp"]
    }
  }
}

// Then ask Claude: "find the best yield with risk audit"
// → browser opens once for OAuth, never again.`,
  },
];

export default function CodeTabs() {
  const [active, setActive] = useState(tabs[0].id);
  const tab = tabs.find((t) => t.id === active)!;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] overflow-hidden">
      <div className="flex border-b border-[var(--color-border)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-5 py-3 text-sm font-medium border-r border-[var(--color-border)] transition-colors ${
              active === t.id
                ? "bg-[var(--color-bg)] text-[var(--color-fg)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-6">
        <p className="text-sm text-[var(--color-fg-muted)] mb-4">{tab.desc}</p>
        <pre className="text-sm font-mono leading-relaxed overflow-x-auto p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
          <code>{tab.code}</code>
        </pre>
      </div>
    </div>
  );
}
