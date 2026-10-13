import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useHistorySelector} from '@docusaurus/theme-common';
import {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

// Mismo orden y etiquetas que el selector de kiba.tools.
const ORDER = ['en', 'es', 'pt'];

type Props = {mobile?: boolean; className?: string};

// Ruta de la página actual en otro idioma. No usamos useAlternatePageUtils porque,
// con trailingSlash: false, la raíz de un idioma es "/en" (sin barra final) y esa
// utilidad no reconoce el prefijo y genera "/pt//en".
function localizedPath(pathname: string, baseUrl: string, locale: string, defaultLocale: string): string {
  const currentBase = baseUrl.replace(/\/$/, ''); // '' para el idioma por defecto
  let rest = pathname;
  if (currentBase && (rest === currentBase || rest.startsWith(`${currentBase}/`))) {
    rest = rest.slice(currentBase.length);
  }
  if (rest === '' || rest === '/') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }
  return locale === defaultLocale ? rest : `/${locale}${rest}`;
}

// Selector de idioma en píldora (EN | ES | PT). Cada opción lleva a la misma
// página en el otro idioma, conservando la búsqueda y el ancla.
export default function LangPicker({mobile, className}: Props): ReactNode {
  const {
    siteConfig: {baseUrl},
    i18n: {currentLocale, defaultLocale, locales, localeConfigs},
  } = useDocusaurusContext();
  const pathname = useHistorySelector((history) => history.location.pathname);
  const search = useHistorySelector((history) => history.location.search);
  const hash = useHistorySelector((history) => history.location.hash);

  const ordered = [...locales].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  return (
    <div
      className={clsx(styles.picker, mobile && styles.mobile, className)}
      role="group"
      aria-label={translate({id: 'kiba.langPicker.label', message: 'Idioma'})}>
      {ordered.map((locale) => {
        const url = localizedPath(pathname, baseUrl, locale, defaultLocale);
        const active = locale === currentLocale;
        return (
          <a
            key={locale}
            href={`${url}${search}${hash}`}
            hrefLang={localeConfigs[locale]?.htmlLang}
            lang={localeConfigs[locale]?.htmlLang}
            title={localeConfigs[locale]?.label}
            aria-current={active ? 'true' : undefined}
            className={clsx(styles.option, active && styles.active)}>
            {locale.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
