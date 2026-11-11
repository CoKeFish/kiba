/**
 * Servicios externos del publicador: APIs que ya cobran con x402 o MPP y que se listan en Kiba
 * con su URL, una descripción y sus parámetros, sin integrar el SDK.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api, type ExternalParam, type ExternalService } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import "./publisher.css";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const emptyParam = (): ExternalParam => ({ name: "", in: "query", description: "", required: false, example: "" });
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export default function PublisherExternal() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: services = [], isLoading } = useQuery({ queryKey: ["my-external"], queryFn: api.myExternal });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("GET");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<ExternalParam[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api.createExternal({
        slug,
        name,
        url,
        method,
        description,
        params: params.filter((p) => p.name.trim() !== ""),
      }),
    onSuccess: () => {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setUrl("");
      setMethod("GET");
      setDescription("");
      setParams([]);
      qc.invalidateQueries({ queryKey: ["my-external"] });
    },
  });
  const remove = useMutation({
    mutationFn: (s: string) => api.deleteExternal(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-external"] }),
  });

  const setParam = (i: number, patch: Partial<ExternalParam>) =>
    setParams((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const ready = name.trim().length >= 3 && slug.length >= 3 && url.trim() !== "" && description.trim().length >= 10;

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">{t("external.title")}</h1>
          <p className="pub-subtitle">{t("external.subtitle")}</p>
        </div>
      </header>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">{t("external.list_title")}</h2>
            <p className="pub-card__desc">{t("external.list_desc")}</p>
          </div>
        </div>
        <div className="pub-card__body">
          {isLoading ? (
            <p className="pub-loading">{t("external.loading")}</p>
          ) : services.length === 0 ? (
            <p className="pub-settle-msg" style={{ color: "var(--color-fg-muted)" }}>
              {t("external.empty")}
            </p>
          ) : (
            <div className="pub-table-wrap">
              <table className="pub-table">
                <thead>
                  <tr>
                    <th>{t("external.col.service")}</th>
                    <th>{t("external.col.url")}</th>
                    <th>{t("external.col.protocol")}</th>
                    <th className="is-right">{t("external.col.price")}</th>
                    <th className="is-right">{t("external.col.calls")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {services.map((s: ExternalService) => (
                    <tr key={s.slug}>
                      <td>
                        <div>{s.name}</div>
                        <div className="pub-table__slug">{s.service}</div>
                      </td>
                      <td style={{ maxWidth: 280, overflowWrap: "anywhere" }}>
                        <span className="pub-table__slug">{s.method}</span> {s.url}
                      </td>
                      <td>
                        <span className={`pub-badge${s.payable ? "" : " pub-badge--muted"}`}>{s.protocol.toUpperCase()}</span>
                        {!s.payable && <div className="pub-field-hint">{t("external.mpp_hint")}</div>}
                      </td>
                      <td className="is-right">{s.priceUsd == null ? "—" : formatUsd(s.priceUsd)}</td>
                      <td className="is-right">{s.calls}</td>
                      <td className="is-right">
                        <button
                          type="button"
                          className="pub-icon-btn"
                          onClick={() => remove.mutate(s.slug)}
                          disabled={remove.isPending}
                          aria-label={t("external.remove", { name: s.name })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {remove.isError && (
            <p className="pub-settle-msg" style={{ color: "var(--color-danger, #ef4444)" }}>
              {(remove.error as Error).message}
            </p>
          )}
        </div>
      </section>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">{t("external.add_title")}</h2>
            <p className="pub-card__desc">{t("external.add_desc")}</p>
          </div>
        </div>
        <form
          className="pub-card__body"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="pub-field">
            <label className="pub-label" htmlFor="ext-name">
              {t("external.field.name")}
            </label>
            <input
              id="ext-name"
              className="pub-input"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div className="pub-field">
            <label className="pub-label" htmlFor="ext-slug">
              {t("external.field.slug")}
            </label>
            <input
              id="ext-slug"
              className="pub-input"
              value={slug}
              maxLength={40}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
            <p className="pub-field-hint">{t("external.field.slug_hint", { id: `ext:${slug || "…"}` })}</p>
          </div>
          <div className="pub-field">
            <label className="pub-label" htmlFor="ext-url">
              {t("external.field.url")}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                className="pub-input"
                style={{ width: 110 }}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                aria-label={t("external.field.method")}
              >
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                id="ext-url"
                className="pub-input"
                style={{ flex: 1 }}
                value={url}
                placeholder="https://api.ejemplo.com/clima"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <p className="pub-field-hint">{t("external.field.url_hint")}</p>
          </div>
          <div className="pub-field">
            <label className="pub-label" htmlFor="ext-desc">
              {t("external.field.description")}
            </label>
            <textarea
              id="ext-desc"
              className="pub-input"
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="pub-field-hint">{t("external.field.description_hint")}</p>
          </div>

          <div className="pub-field">
            <span className="pub-label">{t("external.params.title")}</span>
            <p className="pub-field-hint">{t("external.params.hint")}</p>
            {params.map((p, i) => (
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input
                  className="pub-input"
                  style={{ width: 140 }}
                  value={p.name}
                  placeholder={t("external.params.name")}
                  aria-label={t("external.params.name")}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                />
                <select
                  className="pub-input"
                  style={{ width: 120 }}
                  value={p.in}
                  aria-label={t("external.params.where")}
                  onChange={(e) => setParam(i, { in: e.target.value as ExternalParam["in"] })}
                >
                  <option value="query">{t("external.params.in_query")}</option>
                  <option value="body">{t("external.params.in_body")}</option>
                </select>
                <input
                  className="pub-input"
                  style={{ flex: 1, minWidth: 160 }}
                  value={p.description}
                  placeholder={t("external.params.description")}
                  aria-label={t("external.params.description")}
                  onChange={(e) => setParam(i, { description: e.target.value })}
                />
                <input
                  className="pub-input"
                  style={{ width: 130 }}
                  value={p.example ?? ""}
                  placeholder={t("external.params.example")}
                  aria-label={t("external.params.example")}
                  onChange={(e) => setParam(i, { example: e.target.value })}
                />
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={p.required} onChange={(e) => setParam(i, { required: e.target.checked })} />
                  {t("external.params.required")}
                </label>
                <button
                  type="button"
                  className="pub-icon-btn"
                  onClick={() => setParams((list) => list.filter((_, j) => j !== i))}
                  aria-label={t("external.params.remove")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="pub-btn pub-btn--secondary pub-btn--sm"
              style={{ marginTop: 10 }}
              onClick={() => setParams((list) => [...list, emptyParam()])}
              disabled={params.length >= 20}
            >
              <Plus size={14} /> {t("external.params.add")}
            </button>
          </div>

          <button type="submit" className="pub-btn pub-btn--primary" disabled={!ready || create.isPending}>
            {create.isPending ? (
              <>
                <Loader2 size={14} className="pub-spin" /> {t("external.checking")}
              </>
            ) : (
              t("external.submit")
            )}
          </button>
          {create.isError && (
            <p className="pub-settle-msg" style={{ color: "var(--color-danger, #ef4444)" }}>
              {(create.error as Error).message}
            </p>
          )}
          {create.isSuccess && (
            <p className="pub-settle-msg" style={{ color: "var(--color-success)" }}>
              {t("external.created")}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
