import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Box, Check, Copy, FileText, Image as ImageIcon, Music, Search, Type, Video } from "lucide-react";
import { api, type MediaHit, type MediaType } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useFontFace } from "@/lib/useFontFace";
import { serviceToName } from "@/components/AgentManager";
import "./agents.css";
import "./media.css";

/**
 * Vista SECUNDARIA de los catálogos de medios con licencia (servicios indexados: fotos, música,
 * modelos 3D… de empresas que venden por Kiba). La forma principal de comprar es pedírselo al
 * asistente (search_media + call_agent); esta página es para mirar qué hay. Por eso no está en el
 * menú: se llega desde un enlace discreto al final de Servicios.
 */
const TYPES: (MediaType | "all")[] = ["all", "image", "audio", "video", "model", "font", "document"];

const TYPE_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  audio: Music,
  video: Video,
  model: Box,
  font: Type,
  document: FileText,
};

export default function MediaCatalog() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<MediaType | "all">("all");
  // Texto con el que se prueban las fuentes (p.ej. el nombre de tu marca).
  const [sample, setSample] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer.current);
  }, [query]);

  const { data, isFetching, error } = useQuery({
    queryKey: ["media-search", debounced, type],
    queryFn: () => api.mediaSearch({ q: debounced, type: type === "all" ? undefined : type }),
  });

  const items = data?.items ?? [];
  const hasFonts = items.some((i) => i.type === "font");
  const sampleText = sample.trim() || t("media.font_sample_default");

  return (
    <div className="agents-page">
      <Link to="/app/agents" className="media-back">
        <ArrowLeft size={15} /> {t("media.back")}
      </Link>

      <header className="agents-head">
        <h1 className="agents-title">{t("media.title")}</h1>
        <p className="agents-subtitle">{t("media.subtitle")}</p>
      </header>

      <p className="media-note">{t("media.assistant_note")}</p>

      <div className="agents-search-card">
        <div className="agents-search-wrap">
          <Search size={18} strokeWidth={2} />
          <input
            type="text"
            className="agents-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("media.search_placeholder")}
          />
        </div>
        <div className="agents-mode-toggle media-types" role="group" aria-label={t("media.type_label")}>
          {TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              className={`agents-mode-btn${type === ty ? " is-active" : ""}`}
              onClick={() => setType(ty)}
            >
              {t(`media.types.${ty}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="agents-empty">{t("media.error")}</div>
      ) : items.length === 0 ? (
        <div className="agents-empty">
          {isFetching
            ? t("agents.loading")
            : data && data.catalogsQueried === 0
              ? t("media.no_catalogs")
              : debounced
                ? t("media.no_match", { query: debounced })
                : t("media.empty")}
        </div>
      ) : (
        <>
          <p className="media-count">
            {t("media.count", { count: items.length, catalogs: data?.catalogsQueried ?? 0 })}
          </p>
          {hasFonts && (
            <div className="media-font-tester">
              <label htmlFor="font-sample">
                <Type size={16} aria-hidden /> {t("media.font_sample_label")}
              </label>
              <input
                id="font-sample"
                type="text"
                value={sample}
                maxLength={40}
                onChange={(e) => setSample(e.target.value)}
                placeholder={t("media.font_sample_default")}
              />
              <p>{t("media.font_preview_note")}</p>
            </div>
          )}
          <div className="media-grid">
            {items.map((item) => (
              <MediaCard key={`${item.service}/${item.assetId}`} item={item} sample={sampleText} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MediaCard({ item, sample }: { item: MediaHit; sample: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const Icon = TYPE_ICON[item.type] ?? FileText;
  const lic = item.license ?? {};
  const fontFamily = useFontFace(item.type === "font" ? item.previewUrl : undefined);

  const request = t("media.assistant_request", {
    title: item.title,
    assetId: item.assetId,
    service: item.service,
  });

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(request);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sin permiso de portapapeles: el texto sigue visible en el title del botón */
    }
  }

  function openPlayground() {
    const payload = JSON.stringify({ assetId: item.assetId }, null, 2);
    navigate(
      `/app/playground?service=${encodeURIComponent(item.service)}&payload=${encodeURIComponent(payload)}`,
    );
  }

  return (
    <article className="media-card">
      <div className={`media-card__preview media-card__preview--${item.type}`}>
        {item.previewUrl && item.type === "image" ? (
          <img src={item.previewUrl} alt={item.title} loading="lazy" />
        ) : item.type === "font" && fontFamily ? (
          <p className="media-card__font" style={{ fontFamily: `"${fontFamily}"` }}>
            {sample}
          </p>
        ) : (
          <Icon size={34} strokeWidth={1.5} aria-hidden />
        )}
      </div>
      {item.previewUrl && item.type === "audio" && (
        <audio className="media-card__audio" controls preload="none" src={item.previewUrl} />
      )}

      <div className="media-card__body">
        <div className="media-card__top">
          <h2 className="media-card__title">{item.title}</h2>
          <span className="agents-card__price">{formatUsd(item.priceUsd, item.priceUsd < 0.01 ? 4 : 2)}</span>
        </div>
        <p className="media-card__service">{serviceToName(item.service)}</p>
        {item.description && <p className="media-card__desc">{item.description}</p>}

        <div className="media-card__badges">
          <span className="media-badge">{t(`media.templates.${lic.name ?? "commercial"}`, {
              defaultValue: t("media.license_template", { name: lic.name ?? "commercial" }),
            })}</span>
          {lic.attribution && <span className="media-badge media-badge--warn">{t("media.attribution")}</span>}
          {lic.exclusive === false && <span className="media-badge">{t("media.non_exclusive")}</span>}
        </div>
        {lic.notes && (
          <p className="media-card__notes" title={lic.notes}>
            {lic.notes}
          </p>
        )}

        <div className="media-card__actions">
          <button type="button" className="agents-call-btn" onClick={copyRequest} title={request}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t("media.copied") : t("media.copy_request")}
          </button>
          <button type="button" className="media-link-btn" onClick={openPlayground}>
            {t("media.try_playground")}
          </button>
        </div>
      </div>
    </article>
  );
}
