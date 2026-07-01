import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RegisterAgentForm } from "@/components/AgentManager";
import { CheckCircle2, Circle, Rocket } from "lucide-react";
import "./publisher.css";

const STEPS = [
  { id: "identity", labelKey: "publisher.publish.step_identity_label", hintKey: "publisher.publish.step_identity_hint" },
  { id: "desc", labelKey: "publisher.publish.step_desc_label", hintKey: "publisher.publish.step_desc_hint" },
  { id: "endpoint", labelKey: "publisher.publish.step_endpoint_label", hintKey: "publisher.publish.step_endpoint_hint" },
  { id: "pricing", labelKey: "publisher.publish.step_pricing_label", hintKey: "publisher.publish.step_pricing_hint" },
  { id: "review", labelKey: "publisher.publish.step_review_label", hintKey: "publisher.publish.step_review_hint" },
];

const TIPS = [
  "publisher.publish.tip_1",
  "publisher.publish.tip_2",
  "publisher.publish.tip_3",
  "publisher.publish.tip_4",
];

export default function PublisherPublish() {
  const { t } = useTranslation();
  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">{t("publisher.publish.title")}</h1>
          <p className="pub-subtitle">
            {t("publisher.publish.subtitle")}
          </p>
        </div>
        <div className="pub-actions">
          <Link to="/app/publisher/agents" className="pub-btn pub-btn--secondary pub-btn--sm">
            {t("publisher.publish.my_agents")}
          </Link>
        </div>
      </header>

      <div className="pub-publish-grid">
        <aside className="pub-card pub-checklist">
          <div className="pub-card__head">
            <div>
              <h2 className="pub-card__title">{t("publisher.publish.checklist_title")}</h2>
              <p className="pub-card__desc">{t("publisher.publish.checklist_desc")}</p>
            </div>
          </div>
          <div className="pub-card__body">
            <ul className="pub-checklist__list">
              {STEPS.map((s, i) => (
                <li key={s.id} className="pub-checklist__item">
                  {i === 0 ? (
                    <CheckCircle2 size={18} className="pub-checklist__icon pub-checklist__icon--done" />
                  ) : (
                    <Circle size={18} className="pub-checklist__icon" />
                  )}
                  <div>
                    <p className="pub-checklist__label">{t(s.labelKey)}</p>
                    <p className="pub-checklist__hint">{t(s.hintKey)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="pub-publish-main">
          <RegisterAgentForm />
        </div>

        <aside className="pub-card pub-tips">
          <img src="/agents/estrella.png" alt="" aria-hidden className="pub-tips__mascot" />
          <div className="pub-tips__head">
            <Rocket size={18} />
            <span>{t("publisher.publish.tips_title")}</span>
          </div>
          <ul className="pub-tips__list">
            {TIPS.map((tipKey) => (
              <li key={tipKey}>{t(tipKey)}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
