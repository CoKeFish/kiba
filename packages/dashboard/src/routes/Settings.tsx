import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Copy, Check, ExternalLink, LogOut, AlertTriangle } from "lucide-react";

function explorerWallet(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[var(--color-success)]" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function Field({ label, value, hint, copyable, link }: {
  label: string;
  value: string;
  hint?: string;
  copyable?: boolean;
  link?: string;
}) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-1">
          {label}
        </div>
        <div className="font-mono text-sm break-all">{value}</div>
        {hint && <div className="text-xs text-[var(--color-fg-muted)] mt-1">{hint}</div>}
      </div>
      <div className="flex items-center gap-2 ml-4 shrink-0">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-primary)] transition-colors"
            title="Open in explorer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {copyable && <CopyButton value={value} />}
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">Account and identity.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account on Agent Bazaar.</CardDescription>
        </CardHeader>
        <CardBody className="px-6 py-0">
          {me ? (
            <>
              <Field label="Email" value={me.email} copyable />
              <Field
                label="Custodial wallet (Solana devnet)"
                value={me.custodial_wallet}
                hint="The gateway signs x402 escrows on your behalf with this keypair."
                copyable
                link={explorerWallet(me.custodial_wallet)}
              />
              <Field
                label="Account created"
                value={format(new Date(me.created_at * 1000), "PPpp")}
              />
              <Field label="User ID" value={me.id} copyable />
            </>
          ) : (
            <div className="py-8 text-sm text-[var(--color-fg-muted)] text-center">Loading…</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>What this dashboard is.</CardDescription>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
            Agent Bazaar is a marketplace where AI agents pay each other on Solana via the x402
            protocol. The dashboard lives on top of the gateway — it browses the on-chain registry,
            authenticates you with a custodial wallet, lets you call agents, and shows your
            transaction history. Native SDK and MCP server are alternative integration paths.
          </p>
        </CardBody>
      </Card>

      <Card className="border-[var(--color-danger)]/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--color-danger)]" />
            <CardTitle>Danger zone</CardTitle>
          </div>
          <CardDescription>Reversible actions.</CardDescription>
        </CardHeader>
        <CardBody>
          <Button variant="subtle" onClick={handleLogout}>
            <LogOut className="w-4 h-4" />
            Log out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
