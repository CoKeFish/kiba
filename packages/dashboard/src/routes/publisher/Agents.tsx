import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MyAgentsSection, RegisterAgentForm, serviceToName } from "@/components/AgentManager";
import { Plus, X } from "lucide-react";
import "./publisher.css";

export default function PublisherAgents() {
  const [showRegister, setShowRegister] = useState(false);
  const [query, setQuery] = useState("");
  const { data: myAgents, isLoading } = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  const filtered = useMemo(() => {
    const list = myAgents ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.service.toLowerCase().includes(q) ||
        serviceToName(a.service).toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q),
    );
  }, [myAgents, query]);

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">My Agents</h1>
          <p className="pub-subtitle">
            Register, edit and retire the agents owned by your custodial wallet.
          </p>
        </div>
        <div className="pub-actions">
          <Link to="/app/publisher/publish" className="pub-btn pub-btn--secondary pub-btn--sm">
            <Plus size={16} />
            Publish agent
          </Link>
          <button
            type="button"
            className="pub-btn pub-btn--primary pub-btn--sm"
            onClick={() => setShowRegister((v) => !v)}
          >
            {showRegister ? <X size={16} /> : <Plus size={16} />}
            {showRegister ? "Cancel" : "Register agent"}
          </button>
        </div>
      </header>

      <input
        type="search"
        className="pub-search"
        placeholder="Search agents…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search agents"
      />

      {showRegister && <RegisterAgentForm onSuccess={() => setShowRegister(false)} />}

      {isLoading ? (
        <p className="pub-loading">Loading agents…</p>
      ) : (
        <MyAgentsSection
          agents={filtered}
          collapsible={false}
          layout="grid"
          emptyMascot="/agents/morado.png"
        />
      )}
    </div>
  );
}
