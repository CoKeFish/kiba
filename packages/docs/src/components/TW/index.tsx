import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

// Marca cada lugar que depende de Trustless Work (⚠️ TW en el documento fuente).
// El equipo descartó TW en octubre de 2026 y está pendiente su reemplazo:
// busca `<TW` en docs/ para encontrar todo lo que habrá que reescribir.
export default function TW(): ReactNode {
  return (
    <Link
      to="/stellar/trustless-work"
      className={styles.badge}
      title={translate({
        id: 'kiba.tw.title',
        message: 'Depende de Trustless Work: implementado hoy, pendiente de reemplazo',
      })}>
      ⚠️ TW
    </Link>
  );
}
