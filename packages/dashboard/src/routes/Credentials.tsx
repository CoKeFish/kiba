import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { format } from "date-fns";
import { BookOpen, Check, Copy, Trash2 } from "lucide-react";
import "./credentials.css";

const MASCOTS = {
  cuadradoPeek: "/agents/cuadrado-peek.png",
  estrella: "/agents/estrella.png",
  moradoSentado: "/agents/morado-sentado.png",
} as const;

const HELP_MASCOTS = [
  "/agents/triangulo.png",
  "/agents/circulo.png",
  "/agents/corazon.png",
] as const;

const DOCS_URL = "https://github.com/CoKeFish/kiba/tree/main/docs";

export default function Credentials() {
  const { t } = useTranslation();
  return (
    <div className="credentials-page">
      <header className="credentials-head">
        <h1 className="credentials-title">{t("credentials.title")}</h1>
        <p className="credentials-subtitle">{t("credentials.subtitle")}</p>
      </header>

      <ApiKeysSection />
      <OAuthSection />

      <section className="cred-cta">
        <div>
          <p className="cred-cta__text">{t("credentials.cta_text")}</p>
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="cred-cta-btn">
            <BookOpen size={16} />
            {t("credentials.view_docs")}
          </a>
        </div>
        <div className="cred-cta__mascots" aria-hidden="true">
          {HELP_MASCOTS.map((src) => (
            <img key={src} src={src} alt="" className="cred-cta__mascot" />
          ))}
        </div>
      </section>
    </div>
  );
}

function ApiKeysSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: api.apiKeys,
  });
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createMut = useMutation({
    mutationFn: (n: string) => api.createApiKey(n),
    onSuccess: (data) => {
      setNewSecret(data.secret);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMut.mutate(name.trim());
  };

  const copy = () => {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="cred-card">
      <div className="cred-card__head">
        <h2 className="cred-card__title">{t("credentials.api_keys_title")}</h2>
        <p className="cred-card__desc">
          {t("credentials.api_keys_desc")}{" "}
          <code>Authorization: Bearer …</code>.
        </p>
      </div>
      <div className="cred-card__body">
        <form onSubmit={onCreate} className="cred-form">
          <input
            className="cred-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("credentials.key_name_placeholder")}
          />
          <div className="cred-create-wrap">
            <img
              src={MASCOTS.cuadradoPeek}
              alt=""
              aria-hidden
              className="cred-create-wrap__mascot"
            />
            <button type="submit" className="cred-create-btn" disabled={createMut.isPending}>
              {createMut.isPending ? t("credentials.creating") : t("credentials.create_key")}
            </button>
          </div>
        </form>

        {newSecret && (
          <div className="cred-secret">
            <p className="cred-secret__hint">{t("credentials.secret_hint")}</p>
            <div className="cred-secret__row">
              <code className="cred-secret__code">{newSecret}</code>
              <button
                type="button"
                className="cred-copy-btn"
                onClick={copy}
                aria-label={t("credentials.copy_key_aria")}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="cred-empty__text">{t("credentials.loading")}</p>
        ) : keys.length === 0 ? (
          <div className="cred-empty">
            <img src={MASCOTS.estrella} alt="" aria-hidden className="cred-empty__mascot" />
            <p className="cred-empty__text">{t("credentials.no_keys")}</p>
          </div>
        ) : (
          <div className="cred-table-wrap">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>{t("credentials.th_name")}</th>
                  <th>{t("credentials.th_prefix")}</th>
                  <th>{t("credentials.th_created")}</th>
                  <th>{t("credentials.th_last_used")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="cred-table__mono cred-table__muted">{k.prefix}…</td>
                    <td className="cred-table__muted">
                      {format(new Date(k.created_at * 1000), "MMM d, yyyy")}
                    </td>
                    <td className="cred-table__muted">
                      {k.last_used_at
                        ? format(new Date(k.last_used_at * 1000), "MMM d, HH:mm")
                        : t("credentials.never")}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="cred-icon-btn"
                        onClick={() => revokeMut.mutate(k.id)}
                        disabled={revokeMut.isPending}
                        aria-label={t("credentials.revoke_named_aria", { name: k.name })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function OAuthSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: conns = [], isLoading } = useQuery({
    queryKey: ["oauth-connections"],
    queryFn: api.oauthConnections,
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.revokeOAuth(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oauth-connections"] }),
  });

  return (
    <section className="cred-card">
      <div className="cred-card__head">
        <h2 className="cred-card__title">{t("credentials.connected_apps_title")}</h2>
        <p className="cred-card__desc">{t("credentials.connected_apps_desc")}</p>
      </div>
      <div className="cred-card__body">
        {isLoading ? (
          <p className="cred-empty__text">{t("credentials.loading")}</p>
        ) : conns.length === 0 ? (
          <div className="cred-empty">
            <img
              src={MASCOTS.moradoSentado}
              alt=""
              aria-hidden
              className="cred-empty__mascot cred-empty__mascot--sitting"
            />
            <p className="cred-empty__text">{t("credentials.no_connected_apps")}</p>
          </div>
        ) : (
          <div className="cred-table-wrap">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>{t("credentials.th_app")}</th>
                  <th>{t("credentials.th_scope")}</th>
                  <th>{t("credentials.th_connected")}</th>
                  <th>{t("credentials.th_last_used")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {conns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.client_name}</td>
                    <td>
                      <span className="cred-badge">{c.scope}</span>
                    </td>
                    <td className="cred-table__muted">
                      {format(new Date(c.created_at * 1000), "MMM d, yyyy")}
                    </td>
                    <td className="cred-table__muted">
                      {c.last_used_at
                        ? format(new Date(c.last_used_at * 1000), "MMM d, HH:mm")
                        : t("credentials.never")}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="cred-revoke-btn"
                        onClick={() => revokeMut.mutate(c.id)}
                        disabled={revokeMut.isPending}
                      >
                        {t("credentials.revoke")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
