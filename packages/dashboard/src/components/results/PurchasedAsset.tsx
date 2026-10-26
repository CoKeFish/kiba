import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { enUS, es, pt } from "date-fns/locale";
import { useFontFace } from "@/lib/useFontFace";
import "./response-summary.css";

/** Muestra de una fuente comprada: todo lo que trae la fuente completa (la vista previa no tenía números ni acentos). */
const FONT_SPECIMEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 ÁÉÍÓÚ Ñ Ü ¿?¡!";

const LOCALES = { en: enUS, es, pt } as const;

/**
 * El archivo comprado en un catálogo ({ asset, downloadUrl, expiresAt }): vista previa, título,
 * hasta cuándo vale el enlace y el botón de descarga. La usan el Playground y el detalle de Resultados.
 */
export function PurchasedAsset({
  asset,
  downloadUrl,
  expiresAt,
}: {
  asset: Record<string, unknown>;
  downloadUrl: string;
  /** Caducidad del enlace de descarga, en segundos Unix. */
  expiresAt?: unknown;
}) {
  const { t, i18n } = useTranslation();
  const mime = String(asset.mimeType ?? "");
  const fontFamily = useFontFace(mime.startsWith("font/") ? downloadUrl : undefined);
  const lang = (i18n.resolvedLanguage ?? i18n.language ?? "en").slice(0, 2) as keyof typeof LOCALES;
  const when =
    typeof expiresAt === "number" && Number.isFinite(expiresAt)
      ? format(new Date(expiresAt * 1000), lang === "en" ? "MMM d, HH:mm" : "d MMM, HH:mm", {
          locale: LOCALES[lang] ?? enUS,
        })
      : undefined;

  return (
    <div className="rs-asset">
      {mime.startsWith("image/") && <img className="rs-asset__img" src={downloadUrl} alt={String(asset.title ?? "")} />}
      {mime.startsWith("audio/") && <audio className="rs-asset__audio" controls src={downloadUrl} />}
      {fontFamily && (
        <p className="rs-asset__font" style={{ fontFamily: `"${fontFamily}"` }}>
          {FONT_SPECIMEN}
        </p>
      )}
      <div className="rs-asset__row">
        <div>
          <p className="rs-asset__title">{String(asset.title ?? asset.id ?? "")}</p>
          <p className="rs-muted">
            {when ? t("playground.summary.purchased_expires", { when }) : t("playground.summary.purchased")}
          </p>
        </div>
        <a className="rs-btn" href={downloadUrl} target="_blank" rel="noopener noreferrer">
          <Download size={14} /> {t("playground.summary.download")}
        </a>
      </div>
    </div>
  );
}
