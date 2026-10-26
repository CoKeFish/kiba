import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronDown, ExternalLink, FileBadge } from "lucide-react";
import type { LicenseSummary } from "@/lib/api";
import { collectUrls, field } from "./content";
import { PurchasedAsset } from "./PurchasedAsset";
import "./response-summary.css";

/**
 * Resumen legible de la respuesta de un servicio (Playground). La mayoría de la gente no lee
 * JSON: aquí se muestra lo que importa (el texto, el archivo comprado, unos pocos datos y los
 * enlaces) y la respuesta técnica completa queda plegada debajo, para quien la quiera.
 */

/** Claves internas que no le dicen nada al usuario. */
const HIDDEN = new Set(["_payment", "next", "trace", "op", "license", "expiresAt"]);
/** Campos de texto que suelen ser "la respuesta" (en este orden de preferencia). */
const MAIN_TEXT = ["answer", "summary", "translation", "translatedText", "text", "message", "content", "review", "result", "lyrics"];
const MAX_FACTS = 8;

const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i;

function humanize(key: string): string {
  const s = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//.test(v);
}

type Fact = { key: string; value: string };

/** Datos sueltos de primer nivel: números, sí/no, textos cortos y tamaños de listas. */
function facts(data: Record<string, unknown>, skip: Set<string>, t: TFunction): Fact[] {
  const out: Fact[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (HIDDEN.has(k) || skip.has(k) || v == null || isUrl(v)) continue;
    if (typeof v === "number") out.push({ key: humanize(k), value: v.toLocaleString() });
    else if (typeof v === "boolean") out.push({ key: humanize(k), value: v ? t("playground.summary.yes") : t("playground.summary.no") });
    else if (typeof v === "string" && v.length <= 80) out.push({ key: humanize(k), value: v });
    else if (Array.isArray(v)) out.push({ key: humanize(k), value: t("playground.summary.items", { count: v.length }) });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

export function ResponseSummary({
  result,
  license,
  resultId,
}: {
  result: unknown;
  license?: LicenseSummary;
  resultId?: string;
}) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const obj = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;

  // Compra de un catálogo: { asset, downloadUrl, license }.
  const asset = field<Record<string, unknown>>(result, "asset");
  const downloadUrl = field<string>(result, "downloadUrl");

  const mainKey = obj ? MAIN_TEXT.find((k) => typeof obj[k] === "string" && !isUrl(obj[k])) : undefined;
  const mainText = typeof result === "string" ? result : mainKey ? String(obj![mainKey]) : undefined;

  const skip = new Set<string>(mainKey ? [mainKey] : []);
  if (asset) skip.add("asset");
  const list = obj ? facts(obj, skip, t) : [];

  // Los enlaces del ítem comprado (vista previa…) ya se ven en su tarjeta: no se repiten.
  const urls = collectUrls(obj ? Object.fromEntries(Object.entries(obj).filter(([k]) => !HIDDEN.has(k) && !skip.has(k))) : result)
    .filter((u) => u.url !== downloadUrl)
    .filter((u, i, all) => all.findIndex((x) => x.url === u.url) === i)
    .slice(0, 6);

  const nothing = !asset && !mainText && list.length === 0 && urls.length === 0;

  return (
    <div className="rs">
      {asset && downloadUrl && (
        <PurchasedAsset asset={asset} downloadUrl={downloadUrl} expiresAt={field(result, "expiresAt")} />
      )}

      {license && (
        <a className="rs-license" href={license.dashboardUrl} target="_blank" rel="noopener noreferrer">
          <FileBadge size={15} />
          <span>{t("playground.summary.license")}</span>
          <ExternalLink size={12} />
        </a>
      )}

      {mainText && <p className="rs-text">{mainText}</p>}

      {list.length > 0 && (
        <dl className="rs-facts">
          {list.map((f) => (
            <div key={f.key}>
              <dt>{f.key}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {urls.length > 0 && (
        <div className="rs-links">
          {urls.map((u) =>
            IMAGE_RE.test(u.url) ? (
              <img key={u.url} className="rs-asset__img" src={u.url} alt={u.key} />
            ) : AUDIO_RE.test(u.url) ? (
              <audio key={u.url} className="rs-asset__audio" controls src={u.url} />
            ) : (
              <a key={u.url} className="rs-link" href={u.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> {humanize(u.key) || u.url}
              </a>
            ),
          )}
        </div>
      )}

      {nothing && <p className="rs-muted">{t("playground.summary.nothing")}</p>}

      <div className="rs-foot">
        <button type="button" className="rs-toggle" onClick={() => setShowJson((v) => !v)} aria-expanded={showJson}>
          <ChevronDown size={14} className={showJson ? "rs-toggle__icon is-open" : "rs-toggle__icon"} />
          {showJson ? t("playground.summary.hide_json") : t("playground.summary.show_json")}
        </button>
        {resultId && (
          <Link className="rs-toggle" to={`/app/results/${encodeURIComponent(resultId)}`}>
            {t("playground.summary.open_result")}
          </Link>
        )}
      </div>
      {showJson && <pre className="playground-json">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
