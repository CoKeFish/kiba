import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS, LANG_LABELS, type Lang } from "@/i18n";

type Props = {
  /** "sidebar" = pastilla compacta a lo ancho; "floating" = esquina sobre fondo claro. */
  variant?: "sidebar" | "floating";
};

/**
 * Selector de idioma EN · ES · PT. Persiste vía i18next-browser-languagedetector
 * (localStorage "kiba_lang"), así que no necesita estado propio.
 */
export function LanguageSwitcher({ variant = "sidebar" }: Props) {
  const { i18n } = useTranslation();
  const active = (i18n.resolvedLanguage ?? "en").split("-")[0] as Lang;

  return (
    <div
      role="group"
      aria-label="Language"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${SUPPORTED_LANGS.length}, 1fr)`,
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: variant === "floating" ? "#fff" : "var(--color-bg-soft)",
        border: "1px solid var(--color-border)",
      }}
    >
      {SUPPORTED_LANGS.map((lng) => {
        const isActive = active === lng;
        return (
          <button
            key={lng}
            type="button"
            onClick={() => i18n.changeLanguage(lng)}
            aria-pressed={isActive}
            style={{
              padding: "5px 8px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.02em",
              background: isActive ? "var(--color-primary)" : "transparent",
              color: isActive ? "var(--color-primary-fg)" : "var(--color-fg-subtle)",
              transition: "all var(--dur-fast) var(--ease-out)",
            }}
          >
            {LANG_LABELS[lng]}
          </button>
        );
      })}
    </div>
  );
}
