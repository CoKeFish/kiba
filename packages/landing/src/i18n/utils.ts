import { ui, defaultLang } from "./ui";

export type Lang = keyof typeof ui;

export function getLangFromUrl(url: URL): Lang {
  const [, seg] = url.pathname.split("/");
  if (seg in ui) return seg as Lang;
  return defaultLang;
}

/** Devuelve la ruta actual SIN el prefijo de idioma (siempre empieza con "/"). */
export function stripLangFromPath(pathname: string): string {
  const [, seg, ...rest] = pathname.split("/");
  if (seg in ui) return "/" + rest.join("/");
  return pathname;
}

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)[typeof defaultLang]): string {
    return (ui[lang] as any)[key] || ui[defaultLang][key];
  };
}

/** Construye el href para `path` (sin prefijo) en el idioma `lang`. */
export function localizePath(path: string, lang: Lang): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return lang === defaultLang ? (clean === "/" ? "/" : clean) : `/${lang}${clean === "/" ? "" : clean}`;
}
