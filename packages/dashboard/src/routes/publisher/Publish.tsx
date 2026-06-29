import { Link } from "react-router-dom";
import { RegisterAgentForm } from "@/components/AgentManager";
import { CheckCircle2, Circle, Rocket } from "lucide-react";
import "./publisher.css";

const STEPS = [
  { id: "identity", label: "Agent identity", hint: "Name, service slug and category" },
  { id: "desc", label: "Description", hint: "What your agent does for users" },
  { id: "endpoint", label: "Endpoint / integration", hint: "URL the gateway calls on each request" },
  { id: "pricing", label: "Pricing", hint: "Price per call in SOL" },
  { id: "review", label: "Review & publish", hint: "Register on-chain from your wallet" },
];

const TIPS = [
  "Pick a short service slug — it becomes the public API path.",
  "Start with a low price while you test; you can raise it anytime.",
  "Your endpoint must respond within the gateway timeout.",
  "Descriptions show up in the consumer marketplace.",
];

export default function PublisherPublish() {
  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">Publish</h1>
          <p className="pub-subtitle">
            Register a new agent on-chain. One form — identity, endpoint, pricing and go live.
          </p>
        </div>
        <div className="pub-actions">
          <Link to="/app/publisher/agents" className="pub-btn pub-btn--secondary pub-btn--sm">
            My agents
          </Link>
        </div>
      </header>

      <div className="pub-publish-grid">
        <aside className="pub-card pub-checklist">
          <div className="pub-card__head">
            <div>
              <h2 className="pub-card__title">Publish checklist</h2>
              <p className="pub-card__desc">Everything you need before going live.</p>
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
                    <p className="pub-checklist__label">{s.label}</p>
                    <p className="pub-checklist__hint">{s.hint}</p>
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
            <span>Publisher tips</span>
          </div>
          <ul className="pub-tips__list">
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
