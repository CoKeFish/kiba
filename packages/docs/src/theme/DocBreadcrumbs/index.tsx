import React, {type ReactNode, useState} from 'react';
import DocBreadcrumbs from '@theme-original/DocBreadcrumbs';
import type DocBreadcrumbsType from '@theme/DocBreadcrumbs';
import type {WrapperProps} from '@docusaurus/types';
import {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

type Props = WrapperProps<typeof DocBreadcrumbsType>;

// Fila de breadcrumbs + botón "Copiar" que copia el texto de la página.
function CopyPageButton(): ReactNode {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const article = document.querySelector('.theme-doc-markdown') as HTMLElement | null;
    if (!article) return;
    try {
      await navigator.clipboard.writeText(article.innerText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // El portapapeles puede no estar disponible (contexto no seguro).
    }
  };

  return (
    <button type="button" className={styles.copy} onClick={copy} aria-label={translate({id: 'kiba.copyPage.ariaLabel', message: 'Copiar el contenido de la página'})}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </>
        )}
      </svg>
      {copied
        ? translate({id: 'kiba.copyPage.copied', message: 'Copiado'})
        : translate({id: 'kiba.copyPage.copy', message: 'Copiar'})}
    </button>
  );
}

export default function DocBreadcrumbsWrapper(props: Props): ReactNode {
  return (
    <div className={styles.row}>
      <DocBreadcrumbs {...props} />
      <CopyPageButton />
    </div>
  );
}
