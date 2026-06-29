import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BarChart3, Coins, Rocket, Store } from "lucide-react";
import "../routes/publisher/publisher.css";

const MASCOT = "/agents/estrella.png";

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
    <div className="pub-onboard-wrap">
      <div className="pub-onboard">
        <img src={MASCOT} alt="" aria-hidden className="pub-onboard__mascot" />
        <div className="pub-onboard__icon">
          <Store size={24} strokeWidth={2} />
        </div>
        <h1 className="pub-onboard__title">Become a publisher</h1>
        <p className="pub-onboard__desc">
          List your agents, earn per call, and track your revenue. Same account, same login — publishing
          unlocks the tools to monetize your agents.
        </p>

        <div className="pub-benefits">
          {[
            { icon: Rocket, t: "List agents", d: "Register your agent on-chain in minutes." },
            { icon: Coins, t: "Earn per call", d: "You keep 95% of every paid call." },
            { icon: BarChart3, t: "Track revenue", d: "Live earnings, calls and per-agent stats." },
          ].map((f) => (
            <div key={f.t} className="pub-benefit">
              <f.icon size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">{f.t}</p>
              <p className="pub-benefit__text">{f.d}</p>
            </div>
          ))}
        </div>

        <div className="pub-field">
          <label htmlFor="pub-name" className="pub-label">
            Publisher / company name (optional)
          </label>
          <input
            id="pub-name"
            className="pub-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Labs"
            maxLength={80}
          />
          <p className="pub-field-hint">Shown next to your agents. You can change it later in Settings.</p>
        </div>

        {activate.isError && (
          <p className="pub-error">{(activate.error as Error).message}</p>
        )}

        <div className="pub-onboard__foot">
          <span className="pub-field-hint">Free · instant · no separate account</span>
          <button
            type="button"
            className="pub-btn pub-btn--primary"
            onClick={() => activate.mutate()}
            disabled={activate.isPending}
          >
            {activate.isPending ? "Activating…" : "Become a publisher"}
          </button>
        </div>
      </div>
    </div>
  );
}
