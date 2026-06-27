import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { Wallet, ExternalLink, Copy, Info } from "lucide-react";
import { useState } from "react";

export default function PublisherPayouts() {
  const { data, isLoading } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
    refetchInterval: 20_000,
  });
  const [copied, setCopied] = useState(false);

  const pubkey = data?.wallet.pubkey ?? "";
  const copy = () => {
    navigator.clipboard?.writeText(pubkey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payouts</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Earnings settle directly to your custodial wallet on {chain.networkLabel}.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardBody className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
              <Wallet className="w-3.5 h-3.5" />
              Available in wallet
            </div>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : formatUsd(data?.wallet.usd ?? 0)}
            </div>
            <div className="text-xs text-[var(--color-fg-muted)] font-mono">
              {data ? `${(data.wallet.asset_amount ?? 0).toFixed(4)} ${data.asset}` : ""}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
              Lifetime earned
            </div>
            <div className="text-2xl font-semibold text-[var(--color-success)]">
              {isLoading ? "—" : formatUsd(data?.totals.earned_usd ?? 0)}
            </div>
            <div className="text-xs text-[var(--color-fg-muted)] font-mono">
              after {data ? data.fee.pct : 5}% platform fee
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payout wallet</CardTitle>
          <CardDescription>
            Every paid call sends 95% here atomically via the Soroban contract.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] p-3 font-mono text-xs">
            <span className="truncate flex-1">{pubkey || "—"}</span>
            <Button size="sm" variant="ghost" onClick={copy} disabled={!pubkey}>
              <Copy className="w-3 h-3" />
              {copied ? "Copied" : "Copy"}
            </Button>
            {pubkey && (
              <a
                href={chain.explorerAddr(pubkey)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div
            className="flex items-start gap-2 rounded-md p-3 text-sm"
            style={{
              background: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
              color: "var(--color-fg-muted)",
            }}
          >
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div>
              On testnet your earnings accrue as real XLM in this custodial wallet. A self-serve
              withdrawal to an external Stellar address is on the roadmap; for now the balance is
              fully visible and verifiable on-chain via the explorer link above.
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
