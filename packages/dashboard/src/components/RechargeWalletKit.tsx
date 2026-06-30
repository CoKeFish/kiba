/**
 * Recargar la wallet Privy del usuario conectando una wallet externa (Stellar Wallets Kit)
 * y enviándole USDC directo. Sin memo, sin QR: el saldo on-chain sube y se relee de Horizon.
 *
 * Se monta en Ajustes, dentro de la tarjeta de la wallet (`walletAddress` = destino = la
 * dirección Privy que muestra `/v1/wallet`).
 */
import { useState } from "react";
import { CheckCircle2, ExternalLink, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chain } from "@/lib/chain";

// `@/lib/stellar-wallet` arrastra @stellar/stellar-sdk + el Wallets Kit (~900 kB). Se importa
// dinámicamente al interactuar, para no inflar el bundle inicial del dashboard.

const QUICK_USDC = [1, 5, 10, 25];

function truncate(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function RechargeWalletKit({
  walletAddress,
  onFunded,
}: {
  walletAddress: string;
  onFunded?: () => void;
}) {
  const [addr, setAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(5);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const connect = async () => {
    setErr(null);
    setConnecting(true);
    try {
      const { connectStellarWallet } = await import("@/lib/stellar-wallet");
      setAddr(await connectStellarWallet());
    } catch (e) {
      setErr((e as Error).message || "No se pudo conectar la wallet.");
    } finally {
      setConnecting(false);
    }
  };

  const send = async () => {
    if (!addr || amount <= 0) return;
    setErr(null);
    setSending(true);
    try {
      const { sendUsdc } = await import("@/lib/stellar-wallet");
      const h = await sendUsdc({ source: addr, destination: walletAddress, amount });
      setHash(h);
      onFunded?.();
    } catch (e) {
      setErr((e as Error).message || "No se pudo enviar el pago.");
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setHash(null);
    setErr(null);
  };

  return (
    <div className="mt-4 rounded-[var(--radius)] border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Wallet size={16} className="text-[var(--color-primary)]" />
        <span className="text-sm font-semibold">Recargar con tu wallet Stellar</span>
      </div>

      {hash ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
            <div>
              <div className="font-medium text-[var(--color-success)]">¡USDC enviado!</div>
              <p className="text-[var(--color-fg-muted)]">
                Tu saldo on-chain se actualizará en unos segundos.
              </p>
              <a
                href={chain.explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline mt-1"
              >
                Ver transacción <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <Button variant="subtle" size="sm" onClick={reset}>
            Hacer otra recarga
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--color-fg-muted)]">
            Conecta una wallet externa (Freighter, xBull, Albedo…) y envía USDC directo a tu
            wallet de Kiba. Sin memo ni QR.
          </p>

          {!addr ? (
            <Button size="sm" onClick={connect} disabled={connecting}>
              <Wallet size={14} />
              {connecting ? "Conectando…" : "Conectar wallet"}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--color-fg-muted)]">
                  Conectada: <span className="font-mono">{truncate(addr)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAddr(null)}
                  className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] underline"
                >
                  cambiar
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {QUICK_USDC.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setAmount(u)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      amount === u
                        ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-fg)]"
                        : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-primary)]"
                    }`}
                  >
                    {u} USDC
                  </button>
                ))}
                <input
                  type="number"
                  min={0.1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                  className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                  aria-label="Monto en USDC"
                />
              </div>

              <Button size="sm" onClick={send} disabled={sending || amount <= 0}>
                <Send size={14} className={sending ? "animate-pulse" : ""} />
                {sending ? "Enviando…" : `Enviar ${amount} USDC`}
              </Button>
            </div>
          )}
        </>
      )}

      {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
    </div>
  );
}
