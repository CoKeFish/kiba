import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Copy, Check, ExternalLink, LogOut, AlertTriangle, RefreshCw } from "lucide-react";
import { chain } from "@/lib/chain";

function explorerWallet(addr: string): string {
  return chain.explorerAddr(addr);
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

function Field({
  label,
  value,
  hint,
  copyable,
  link,
}: {
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
  const {
    data: wallet,
    isFetching,
    refetch: refetchWallet,
  } = useQuery({
    queryKey: ["wallet"],
    queryFn: api.wallet,
    refetchInterval: 30_000,
  });

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">Account, wallet and identity.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account on Kiba.</CardDescription>
        </CardHeader>
        <CardBody className="px-6 py-0">
          {me ? (
            <>
              <Field label="Email" value={me.email} copyable />
              <Field label="User ID" value={me.id} copyable />
              <Field
                label="Account created"
                value={format(new Date(me.created_at * 1000), "PPpp")}
              />
            </>
          ) : (
            <div className="py-8 text-sm text-[var(--color-fg-muted)] text-center">Loading…</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between flex-row">
          <div>
            <CardTitle>Custodial wallet</CardTitle>
            <CardDescription>
              Your Solana keypair. Lives in the gateway. Signs every <code>open_escrow</code> and{" "}
              <code>claim_payment</code> on your behalf.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetchWallet()}
            disabled={isFetching}
            title="Refresh on-chain balance"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardBody className="px-6 py-0">
          {wallet ? (
            <>
              <Field
                label={`Public key (${chain.networkLabel})`}
                value={wallet.pubkey}
                copyable
                link={explorerWallet(wallet.pubkey)}
              />
              <Field
                label="On-chain balance"
                value={`${wallet.asset_amount.toFixed(6)} ${wallet.asset}`}
                hint={`${wallet.base_units.toLocaleString()} ${wallet.base_unit_name} — refilled on-demand from the gateway treasury when you make a call`}
              />
              <Field
                label="Treasury wallet (refill source)"
                value={wallet.master_wallet}
                hint={`When your custodial runs low, the gateway transfers ${wallet.asset} from this master wallet to yours. Operated by the platform.`}
                copyable
                link={explorerWallet(wallet.master_wallet)}
              />
            </>
          ) : (
            <div className="py-8 text-sm text-[var(--color-fg-muted)] text-center">Loading…</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How payments flow</CardTitle>
          <CardDescription>What happens behind every call.</CardDescription>
        </CardHeader>
        <CardBody>
          <ol className="text-sm text-[var(--color-fg-muted)] leading-relaxed space-y-2 list-decimal list-inside">
            <li>You hit <code className="text-[var(--color-fg)]">/v1/call</code> with a service id and payload.</li>
            <li>
              The gateway debits the agent's price from your USD credit balance (atomic — fails if
              you don't have enough).
            </li>
            <li>
              If your custodial wallet doesn't have enough SOL on-chain, the gateway transfers what's
              missing from the treasury wallet above (one-time refill, kept silent).
            </li>
            <li>
              <strong className="text-[var(--color-fg)]">Your custodial wallet</strong> signs{" "}
              <code className="text-[var(--color-fg)]">open_escrow</code> on Solana, locking the
              SOL in a PDA owned by the program.
            </li>
            <li>The agent calls back, returns the result, and signs <code className="text-[var(--color-fg)]">claim_payment</code> — the SOL moves from the escrow to the agent's wallet.</li>
            <li>If anything fails along the way, the USD credit is automatically refunded.</li>
          </ol>
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
