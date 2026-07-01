import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

export const SUPPORTED_LANGS = ["en", "es", "pt"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  en: "EN",
  es: "ES",
  pt: "PT",
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      pt: { translation: pt },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    load: "languageOnly", // "es-CO" -> "es"
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "kiba_lang",
    },
    interpolation: {
      escapeValue: false, // React ya escapa
    },
  });

// Mantener <html lang> sincronizado con el idioma activo.
const syncDocumentLang = (lng: string) => {
  document.documentElement.lang = (lng || "en").split("-")[0];
};
syncDocumentLang(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", syncDocumentLang);

export default i18n;
