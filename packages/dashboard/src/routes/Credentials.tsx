import { useState, type FormEvent } from "react";
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
  return (
    <div className="credentials-page">
      <header className="credentials-head">
        <h1 className="credentials-title">Credentials</h1>
        <p className="credentials-subtitle">
          Manage who can pay agents on your behalf using API keys and OAuth-connected apps.
        </p>
      </header>

      <ApiKeysSection />
      <OAuthSection />

      <section className="cred-cta">
        <div>
          <p className="cred-cta__text">
            Need help securing your workspace? Learn best practices for API keys, permissions, and
            integrating trusted apps.
          </p>
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="cred-cta-btn">
            <BookOpen size={16} />
            View docs
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
        <h2 className="cred-card__title">API Keys</h2>
        <p className="cred-card__desc">
          Long-lived secrets for direct REST API access. Use as{" "}
          <code>Authorization: Bearer …</code>.
        </p>
      </div>
      <div className="cred-card__body">
        <form onSubmit={onCreate} className="cred-form">
          <input
            className="cred-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter key name"
          />
          <div className="cred-create-wrap">
            <img
              src={MASCOTS.cuadradoPeek}
              alt=""
              aria-hidden
              className="cred-create-wrap__mascot"
            />
            <button type="submit" className="cred-create-btn" disabled={createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Create key"}
            </button>
          </div>
        </form>

        {newSecret && (
          <div className="cred-secret">
            <p className="cred-secret__hint">Copy this now — it won&apos;t be shown again.</p>
            <div className="cred-secret__row">
              <code className="cred-secret__code">{newSecret}</code>
              <button type="button" className="cred-copy-btn" onClick={copy} aria-label="Copy key">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="cred-empty__text">Loading…</p>
        ) : keys.length === 0 ? (
          <div className="cred-empty">
            <img src={MASCOTS.estrella} alt="" aria-hidden className="cred-empty__mascot" />
            <p className="cred-empty__text">
              No API keys yet. Create your first API key to get started.
            </p>
          </div>
        ) : (
          <div className="cred-table-wrap">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th>Last used</th>
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
                        : "Never"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="cred-icon-btn"
                        onClick={() => revokeMut.mutate(k.id)}
                        disabled={revokeMut.isPending}
                        aria-label={`Revoke ${k.name}`}
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
        <h2 className="cred-card__title">Connected apps</h2>
        <p className="cred-card__desc">
          Apps you&apos;ve authorized via OAuth (Claude Desktop, Cursor, MCP clients). Revoke access
          at any time.
        </p>
      </div>
      <div className="cred-card__body">
        {isLoading ? (
          <p className="cred-empty__text">Loading…</p>
        ) : conns.length === 0 ? (
          <div className="cred-empty">
            <img
              src={MASCOTS.moradoSentado}
              alt=""
              aria-hidden
              className="cred-empty__mascot cred-empty__mascot--sitting"
            />
            <p className="cred-empty__text">
              No connected apps installed yet. When you authorize an app, it will appear here.
            </p>
          </div>
        ) : (
          <div className="cred-table-wrap">
            <table className="cred-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Scope</th>
                  <th>Connected</th>
                  <th>Last used</th>
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
                        : "Never"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="cred-revoke-btn"
                        onClick={() => revokeMut.mutate(c.id)}
                        disabled={revokeMut.isPending}
                      >
                        Revoke
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
