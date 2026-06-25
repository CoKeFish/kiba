import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatUsd, lamportsToUsd, baseUnitsToUsd, shortSig, explorerUrl } from "@/lib/format";
import { format } from "date-fns";
import { CreditCard, Wallet, ExternalLink, AlertCircle } from "lucide-react";

const QUICK_AMOUNTS = [5, 10, 25, 50, 100];

export default function Billing() {
  const qc = useQueryClient();
  const { data: balance } = useQuery({ queryKey: ["balance"], queryFn: api.balance });
  const { data: txs = [] } = useQuery({
    queryKey: ["transactions", "billing"],
    queryFn: () => api.transactions(200),
  });
  const topups = txs.filter((t) => t.type === "topup");

  const [amount, setAmount] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (n: number) => api.topup(n),
    onSuccess: (data) => {
      setSuccess(
        `+ ${formatUsd(amount)} added · new balance ${formatUsd(baseUnitsToUsd(data.new_balance_base_units ?? data.new_balance_lamports))}`,
      );
      setError(null);
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setTimeout(() => setSuccess(null), 4000);
    },
    onError: (e: Error) => {
      setError(e.message);
      setTimeout(() => setError(null), 4000);
    },
  });

  function submit(n: number) {
    if (!Number.isFinite(n) || n <= 0) {
      setError("Amount must be positive");
      return;
    }
    if (n > 1000) {
      setError("Single topup capped at $1000 in demo mode");
      return;
    }
    mutation.mutate(n);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Top up credits and review your invoices.
        </p>
      </div>

      {/* Balance card */}
      <Card>
        <CardBody className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider mb-2">
              Available balance
            </p>
            <p className="text-3xl font-semibold font-mono">
              {balance ? formatUsd(balance.balance_usd) : "—"}
            </p>
            <p className="text-xs text-[var(--color-fg-muted)] mt-1">USD credits, used for agent calls</p>
          </div>
          <Wallet className="w-8 h-8 text-[var(--color-fg-muted)]" />
        </CardBody>
      </Card>

      {/* Top up */}
      <Card>
        <CardHeader>
          <CardTitle>Top up</CardTitle>
          <CardDescription>
            Demo mode — clicking adds USD credits instantly. Production would route through Stripe Checkout.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((q) => (
              <Button
                key={q}
                size="sm"
                variant={amount === q ? "default" : "subtle"}
                onClick={() => setAmount(q)}
              >
                ${q}
              </Button>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-fg-muted)]">Custom $</span>
              <Input
                type="number"
                min={1}
                max={1000}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-24"
              />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-danger)]">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-[var(--color-success)] font-mono">{success}</div>
          )}
          <Button
            onClick={() => submit(amount)}
            disabled={mutation.isPending || amount <= 0}
            className="w-full sm:w-auto"
          >
            <CreditCard className="w-4 h-4" />
            {mutation.isPending ? "Processing…" : `Add ${formatUsd(amount)} (mock)`}
          </Button>
        </CardBody>
      </Card>

      {/* Invoices history */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            {topups.length === 0 ? "No top-ups yet" : `${topups.length} top-up(s)`}
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          {topups.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)] text-center py-8">
              Your top-ups will appear here.
            </p>
          ) : (
            <ul>
              {topups.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-3 px-6 border-b border-[var(--color-border)] last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <Badge tone="success">topup</Badge>
                    <div>
                      <div className="text-sm font-mono">{t.service || "fake-stripe"}</div>
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        {format(new Date(t.created_at * 1000), "MMM d, HH:mm:ss")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.tx_signature && (
                      <a
                        href={explorerUrl(t.tx_signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-[var(--color-primary)] hover:underline flex items-center gap-1"
                      >
                        {shortSig(t.tx_signature)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <span className="font-mono text-sm text-[var(--color-success)]">
                      + {formatUsd(lamportsToUsd(t.amount_lamports))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
