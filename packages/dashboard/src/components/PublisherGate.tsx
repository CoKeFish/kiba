/**
 * Gate de las rutas de publisher. Misma cuenta que el consumidor — si el user aún
 * no activó el modo publisher, muestra el onboarding "Become a publisher" (1 click,
 * gratis, instantáneo). Tras activar, refresca el user y renderiza la sección.
 */
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store, Rocket, Coins, BarChart3 } from "lucide-react";

export function PublisherGate({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");

  const activate = useMutation({
    mutationFn: () => api.activatePublisher(name.trim() || undefined),
    onSuccess: async () => {
      await refresh();
    },
  });

  if (user?.is_publisher) return <>{children}</>;

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardBody className="space-y-6 py-8">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{
                width: 48,
                height: 48,
                background: "color-mix(in srgb, var(--color-primary) 16%, transparent)",
                color: "var(--color-primary)",
              }}
            >
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Become a publisher</h1>
              <p className="text-sm text-[var(--color-fg-muted)]">
                Same account, same login. Publishing just unlocks the tools to list and monetize
                your agents.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Rocket, t: "List agents", d: "Register your agent on-chain in minutes." },
              { icon: Coins, t: "Earn per call", d: "You keep 95% of every paid call, paid in XLM." },
              { icon: BarChart3, t: "Track revenue", d: "Live earnings, calls and per-agent stats." },
            ].map((f) => (
              <div
                key={f.t}
                className="rounded-md border border-[var(--color-border)] p-3 space-y-1"
              >
                <f.icon className="w-4 h-4 text-[var(--color-primary)]" />
                <div className="text-sm font-medium">{f.t}</div>
                <div className="text-xs text-[var(--color-fg-muted)] leading-tight">{f.d}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pub-name">Publisher / company name (optional)</Label>
            <Input
              id="pub-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Labs"
              maxLength={80}
            />
            <p className="text-xs text-[var(--color-fg-muted)]">
              Shown next to your agents. You can change it later in Settings.
            </p>
          </div>

          {activate.isError && (
            <div className="text-sm text-[var(--color-danger)]">
              {(activate.error as Error).message}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--color-border)]">
            <span className="text-xs text-[var(--color-fg-muted)]">
              Free · instant · no separate account
            </span>
            <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
              {activate.isPending ? "Activating…" : "Become a publisher"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
