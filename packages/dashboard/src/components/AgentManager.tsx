/**
 * Componentes reutilizables de gestión de agentes (lado publisher).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type MyAgent } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { chain } from "@/lib/chain";
import { ChevronDown, ChevronUp, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import "./agent-manager.css";

export const solToUsd = (sol: number) => sol * chain.usdRate;
export const usdToLamports = (usd: number) =>
  Math.floor((usd / chain.usdRate) * chain.baseUnitsPerToken);

export function serviceToName(service: string): string {
  return service
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

const explorerWallet = (addr: string) => chain.explorerAddr(addr);
const explorerTx = (sig: string) => chain.explorerTx(sig);

export const PRICING_PRESETS: { labelKey: string; usd: number; hintKey: string }[] = [
  { labelKey: "agent_manager.presets.quick_lookup_label", usd: 0.01, hintKey: "agent_manager.presets.quick_lookup_hint" },
  { labelKey: "agent_manager.presets.standard_label", usd: 0.1, hintKey: "agent_manager.presets.standard_hint" },
  { labelKey: "agent_manager.presets.premium_label", usd: 0.5, hintKey: "agent_manager.presets.premium_hint" },
  { labelKey: "agent_manager.presets.heavy_label", usd: 2.0, hintKey: "agent_manager.presets.heavy_hint" },
];

export function RegisterAgentForm({ onSuccess }: { onSuccess?: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [service, setService] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [description, setDescription] = useState("");
  const [priceUsd, setPriceUsd] = useState<number>(0.1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ signature: string; pda: string } | null>(null);

  const lamports = usdToLamports(priceUsd);

  const mutation = useMutation({
    mutationFn: () =>
      api.registerAgent({
        service: service.trim().toLowerCase(),
        pricePerCallLamports: lamports,
        endpoint: endpoint.trim(),
        description: description.trim(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["agents-list"] });
      qc.invalidateQueries({ queryKey: ["publisher-overview"] });
      setSuccess({ signature: res.signature, pda: res.pda });
      setTimeout(() => onSuccess?.(), 2500);
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccess(null);
    mutation.mutate();
  };

  if (success) {
    return (
      <div className="am-card am-card--success">
        <div className="am-card__body">
          <p className="am-success-title">✓ {t("agent_manager.register.success_title")}</p>
          <div className="am-proof">
            <span className="am-proof__label">PDA</span>
            <a href={explorerWallet(success.pda)} target="_blank" rel="noopener noreferrer">
              {success.pda.slice(0, 8)}…{success.pda.slice(-8)}
              <ExternalLink size={12} />
            </a>
          </div>
          <div className="am-proof">
            <span className="am-proof__label">{t("agent_manager.register.signature_label")}</span>
            <a href={explorerTx(success.signature)} target="_blank" rel="noopener noreferrer">
              {success.signature.slice(0, 8)}…{success.signature.slice(-8)}
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="am-card">
      <div className="am-card__head">
        <h3 className="am-card__title">{t("agent_manager.register.card_title")}</h3>
        <p className="am-card__desc">
          {t("agent_manager.register.desc_1")} <code>register_agent</code>
          {t("agent_manager.register.desc_2", { pct: 95 })}
        </p>
      </div>
      <div className="am-card__body">
        <form onSubmit={onSubmit} className="am-form">
          <div className="am-field">
            <label htmlFor="service">{t("agent_manager.register.service_label")}</label>
            <input
              id="service"
              className="am-input"
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder={t("agent_manager.register.service_placeholder")}
              maxLength={32}
              required
            />
            <p className="am-hint">{t("agent_manager.register.service_hint")}</p>
          </div>

          <div className="am-field">
            <label htmlFor="endpoint">{t("agent_manager.register.endpoint_label")}</label>
            <input
              id="endpoint"
              className="am-input"
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={t("agent_manager.register.endpoint_placeholder")}
              maxLength={256}
              required
            />
            <p className="am-hint">{t("agent_manager.register.endpoint_hint")}</p>
          </div>

          <div className="am-field">
            <label htmlFor="description">{t("agent_manager.register.description_label")}</label>
            <textarea
              id="description"
              className="am-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("agent_manager.register.description_placeholder")}
              maxLength={512}
              required
              rows={3}
            />
            <p className="am-hint">{t("agent_manager.register.description_hint", { len: description.length })}</p>
          </div>

          <div className="am-field">
            <label>{t("agent_manager.register.floor_price_label")}</label>
            <p className="am-hint" style={{ marginBottom: 10 }}>
              {t("agent_manager.register.floor_price_hint_1")}{" "}
              <code>priceFn</code>{t("agent_manager.register.floor_price_hint_2")}
            </p>
            <div className="am-presets">
              {PRICING_PRESETS.map((p) => (
                <button
                  key={p.labelKey}
                  type="button"
                  className={`am-preset${priceUsd === p.usd ? " is-active" : ""}`}
                  onClick={() => setPriceUsd(p.usd)}
                >
                  <p className="am-preset__title">{t(p.labelKey)}</p>
                  <p className="am-preset__price">${p.usd.toFixed(2)}</p>
                  <p className="am-preset__hint">{t(p.hintKey)}</p>
                </button>
              ))}
            </div>
            <div className="am-custom-price">
              <div className="am-custom-price__input">
                <label htmlFor="custom-price" className="am-label">
                  {t("agent_manager.register.custom_label")}
                </label>
                <input
                  id="custom-price"
                  className="am-input"
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(Number(e.target.value) || 0)}
                />
              </div>
              <div className="am-custom-price__meta">
                = {(lamports / chain.baseUnitsPerToken).toFixed(6)} {chain.asset}
                <br />= {lamports.toLocaleString()} {t("agent_manager.register.base_units")}
              </div>
            </div>
          </div>

          {submitError && <div className="am-error">{submitError}</div>}

          <div className="am-form-actions">
            <button type="submit" className="am-btn am-btn--primary" disabled={mutation.isPending}>
              {mutation.isPending ? t("agent_manager.register.registering") : t("agent_manager.register.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MyAgentsSection({
  agents,
  collapsible = true,
  layout = "list",
  emptyMascot,
}: {
  agents: MyAgent[];
  collapsible?: boolean;
  layout?: "list" | "grid";
  emptyMascot?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="am-card am-card--accent">
      <div
        className={`am-card__head am-card__head--row${collapsible ? " am-card__head--clickable" : ""}`}
        onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
        onKeyDown={collapsible ? (e) => e.key === "Enter" && setExpanded((v) => !v) : undefined}
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
      >
        <div>
          <h3 className="am-card__title">{t("agent_manager.my_agents.title")}</h3>
          <p className="am-card__desc">
            {t("agent_manager.my_agents.summary", { count: agents.length })}{" "}
            <strong style={{ color: "var(--color-success)", fontFamily: "var(--font-mono)" }}>
              {formatUsd(solToUsd(agents.reduce((sum, a) => sum + a.totalEarnedSol, 0)))}
            </strong>
          </p>
        </div>
        {collapsible && (expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />)}
      </div>
      {(!collapsible || expanded) && (
        <div className="am-card__body">
          {agents.length === 0 ? (
            <div className="am-empty">
              {emptyMascot && (
                <img src={emptyMascot} alt="" aria-hidden className="am-empty__mascot" />
              )}
              <p>{t("agent_manager.my_agents.empty")}</p>
            </div>
          ) : (
            <div className={`am-agents${layout === "grid" ? " am-agents--grid" : ""}`}>
              {agents.map((a) => (
                <MyAgentRow key={a.service} agent={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MyAgentRow({ agent }: { agent: MyAgent }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMut = useMutation({
    mutationFn: () => api.deregisterAgent(agent.service),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["agents-list"] });
      qc.invalidateQueries({ queryKey: ["publisher-overview"] });
    },
  });

  if (editing) {
    return (
      <EditAgentRow
        agent={agent}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          qc.invalidateQueries({ queryKey: ["my-agents"] });
          qc.invalidateQueries({ queryKey: ["agents-list"] });
          qc.invalidateQueries({ queryKey: ["publisher-overview"] });
        }}
      />
    );
  }

  return (
    <div className="am-agent">
      <div className="am-agent__top">
        <div className="min-w-0 flex-1">
          <h4 className="am-agent__name">
            {serviceToName(agent.service)}
            <span className="am-agent__slug">{agent.service}</span>
          </h4>
          <p className="am-agent__desc">{agent.description}</p>
          <div className="am-agent__stats">
            <span>
              {t("agent_manager.agent.price_label")} <strong>{formatUsd(solToUsd(agent.pricePerCallSol))}</strong>
            </span>
            <span>
              {t("agent_manager.agent.calls_label")} <strong style={{ color: "var(--color-fg)" }}>{agent.totalCalls.toLocaleString()}</strong>
            </span>
            <span>
              {t("agent_manager.agent.earned_label")} <strong>{formatUsd(solToUsd(agent.totalEarnedSol))}</strong>
            </span>
            <a
              href={explorerWallet(agent.owner)}
              target="_blank"
              rel="noopener noreferrer"
              className="pub-link"
              style={{ fontSize: 11 }}
            >
              {t("agent_manager.agent.owner_link")} <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <div className="am-agent__actions">
          <button type="button" className="am-btn am-btn--ghost am-btn--sm" onClick={() => setEditing(true)}>
            <Pencil size={13} />
            {t("agent_manager.agent.edit")}
          </button>
          {confirmDelete ? (
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className="am-btn am-btn--danger am-btn--sm"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? "…" : t("agent_manager.agent.confirm")}
              </button>
              <button type="button" className="am-btn am-btn--ghost am-btn--sm" onClick={() => setConfirmDelete(false)}>
                <X size={13} />
              </button>
            </div>
          ) : (
            <button type="button" className="am-btn am-btn--ghost am-btn--sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} />
              {t("agent_manager.agent.delete")}
            </button>
          )}
        </div>
      </div>
      {deleteMut.isError && (
        <div className="am-error" style={{ marginTop: 10 }}>
          {(deleteMut.error as Error).message}
        </div>
      )}
    </div>
  );
}

function EditAgentRow({
  agent,
  onCancel,
  onSaved,
}: {
  agent: MyAgent;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(agent.endpoint);
  const [description, setDescription] = useState(agent.description);
  const [priceUsd, setPriceUsd] = useState(() => solToUsd(agent.pricePerCallSol));

  const mut = useMutation({
    mutationFn: () => {
      const params: { pricePerCallLamports?: number; endpoint?: string; description?: string } = {};
      if (endpoint !== agent.endpoint) params.endpoint = endpoint;
      if (description !== agent.description) params.description = description;
      const newLamports = usdToLamports(priceUsd);
      if (newLamports !== agent.pricePerCallLamports) params.pricePerCallLamports = newLamports;
      return api.updateAgent(agent.service, params);
    },
    onSuccess: onSaved,
  });

  return (
    <div className="am-agent am-agent--edit">
      <p className="am-edit-title">{t("agent_manager.edit.title", { name: agent.service })}</p>
      <div className="am-form">
        <div className="am-field">
          <label htmlFor={`ep-${agent.service}`}>{t("agent_manager.edit.endpoint_label")}</label>
          <input
            id={`ep-${agent.service}`}
            className="am-input"
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </div>
        <div className="am-field">
          <label htmlFor={`desc-${agent.service}`}>{t("agent_manager.edit.description_label")}</label>
          <textarea
            id={`desc-${agent.service}`}
            className="am-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={512}
          />
        </div>
        <div className="am-field">
          <label htmlFor={`price-${agent.service}`}>{t("agent_manager.edit.price_label")}</label>
          <input
            id={`price-${agent.service}`}
            className="am-input"
            type="number"
            min={0.001}
            step={0.001}
            value={priceUsd}
            onChange={(e) => setPriceUsd(Number(e.target.value) || 0)}
          />
          <p className="am-hint">
            = {(usdToLamports(priceUsd) / chain.baseUnitsPerToken).toFixed(6)} {chain.asset}
          </p>
        </div>
        {mut.isError && <div className="am-error">{(mut.error as Error).message}</div>}
        <div className="am-edit-actions">
          <button type="button" className="am-btn am-btn--ghost am-btn--sm" onClick={onCancel}>
            {t("agent_manager.edit.cancel")}
          </button>
          <button
            type="button"
            className="am-btn am-btn--primary am-btn--sm"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            {mut.isPending ? t("agent_manager.edit.saving") : t("agent_manager.edit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
