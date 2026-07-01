import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BarChart3, Coins, Rocket, Store } from "lucide-react";
import "../routes/publisher/publisher.css";

const MASCOT = "/agents/estrella.png";

export function PublisherGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
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
        <h1 className="pub-onboard__title">{t("publisher_gate.title")}</h1>
        <p className="pub-onboard__desc">{t("publisher_gate.desc")}</p>

        <div className="pub-benefits">
          {[
            { icon: Rocket, titleKey: "publisher_gate.benefits.list_agents_title", descKey: "publisher_gate.benefits.list_agents_desc" },
            { icon: Coins, titleKey: "publisher_gate.benefits.earn_title", descKey: "publisher_gate.benefits.earn_desc" },
            { icon: BarChart3, titleKey: "publisher_gate.benefits.track_title", descKey: "publisher_gate.benefits.track_desc" },
          ].map((f) => (
            <div key={f.titleKey} className="pub-benefit">
              <f.icon size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">{t(f.titleKey)}</p>
              <p className="pub-benefit__text">{t(f.descKey, { pct: 95 })}</p>
            </div>
          ))}
        </div>

        <div className="pub-field">
          <label htmlFor="pub-name" className="pub-label">
            {t("publisher_gate.name_label")}
          </label>
          <input
            id="pub-name"
            className="pub-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("publisher_gate.name_placeholder")}
            maxLength={80}
          />
          <p className="pub-field-hint">{t("publisher_gate.name_hint")}</p>
        </div>

        {activate.isError && (
          <p className="pub-error">{(activate.error as Error).message}</p>
        )}

        <div className="pub-onboard__foot">
          <span className="pub-field-hint">{t("publisher_gate.foot_hint")}</span>
          <button
            type="button"
            className="pub-btn pub-btn--primary"
            onClick={() => activate.mutate()}
            disabled={activate.isPending}
          >
            {activate.isPending ? t("publisher_gate.activating") : t("publisher_gate.activate")}
          </button>
        </div>
      </div>
    </div>
  );
}
