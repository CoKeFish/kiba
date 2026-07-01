import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Agent, type AgentSearchHit } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { serviceToName, solToUsd } from "@/components/AgentManager";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { DEMO_AGENTS, DEMO_AGENT_TAGS } from "@/lib/demoAgents";
import { mascotFor } from "@/lib/agentMascots";
import { useTranslation } from "react-i18next";
import "./agents.css";

type Mode = "keyword" | "semantic" | "hybrid";

function matchTag(agent: Agent | AgentSearchHit, mode: Mode): Mode {
  if ("matchType" in agent && agent.matchType) return agent.matchType;
  if (DEMO_AGENT_TAGS[agent.service]) return DEMO_AGENT_TAGS[agent.service];
  return mode;
}

export default function Agents() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const debounceRef = useRef<number | undefined>(undefined);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const hasQuery = debouncedQuery.length > 0;

  const { data, isFetching } = useQuery({
    queryKey: ["agents-list", debouncedQuery, mode],
    queryFn: async () =>
      hasQuery ? (await api.searchAgents(debouncedQuery, mode, 50)).results : await api.agents(),
  });

  const { data: myAgentsData } = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  useEffect(() => {
    const url =
      import.meta.env.VITE_WS_URL ||
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "snapshot" || msg.type === "program_event") {
          qc.invalidateQueries({ queryKey: ["agents-list"] });
        }
      } catch {
        // ignore
      }
    };
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [qc]);

  const agents = useMemo(() => {
    const live = (data ?? []) as (Agent | AgentSearchHit)[];
    if (live.length > 0 || hasQuery) return live;
    return DEMO_AGENTS;
  }, [data, hasQuery]);
  const myServices = useMemo(
    () => new Set((myAgentsData ?? []).map((a) => a.service)),
    [myAgentsData],
  );

  return (
    <div className="agents-page">
      <header className="agents-head">
        <h1 className="agents-title">{t("agents.title")}</h1>
        <p className="agents-subtitle">
          {t("agents.subtitle", { network: chain.networkLabel })}
        </p>
      </header>

      <div className="agents-search-card">
        <div className="agents-search-wrap">
          <Search size={18} strokeWidth={2} />
          <input
            type="text"
            className="agents-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("agents.search_placeholder")}
          />
        </div>
        <div className="agents-mode-toggle" role="group" aria-label={t("agents.search_mode_label")}>
          {(["keyword", "semantic", "hybrid"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`agents-mode-btn${mode === m ? " is-active" : ""}`}
              onClick={() => setMode(m)}
            >
              {t(`agents.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="agents-empty">
          {isFetching
            ? t("agents.loading")
            : hasQuery
              ? t("agents.no_match", { query: debouncedQuery })
              : t("agents.no_agents")}
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map((a) => {
            const tag = matchTag(a, mode);
            const priceUsd = solToUsd(a.pricePerCall);
            const isMine = myServices.has(a.service);

            return (
              <article key={a.service} className={`agents-card${isMine ? " is-mine" : ""}`}>
                <div className="agents-card__mascot">
                  <img src={mascotFor(a.service)} alt="" aria-hidden />
                </div>
                <div className="agents-card__body">
                  <h2 className="agents-card__title">{serviceToName(a.service)}</h2>
                  <p className="agents-card__desc">{a.description}</p>
                  <div className="agents-card__meta">
                    <span className="agents-card__price">{formatUsd(priceUsd, 4)}</span>
                    <span className={`agents-card__tag agents-card__tag--${tag}`}>
                      {t(`agents.mode.${tag}`, { defaultValue: tag })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="agents-call-btn"
                    onClick={() =>
                      navigate(`/app/playground?service=${encodeURIComponent(a.service)}`)
                    }
                  >
                    {t("agents.call_agent")}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="agents-help">
        <img src="/agents/triangulo.png" alt="" aria-hidden className="agents-help__mascot" />
        <div className="agents-help__center">
          <div>
            <p className="agents-help__title">{t("agents.help_title")}</p>
            <p className="agents-help__text">{t("agents.help_text")}</p>
          </div>
          <a
            href="https://github.com/CoKeFish/kiba/tree/main/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="agents-help-btn"
          >
            <BookOpen size={16} />
            {t("agents.explore_docs")}
          </a>
        </div>
        <img src="/agents/corazon.png" alt="" aria-hidden className="agents-help__mascot" />
      </section>
    </div>
  );
}
