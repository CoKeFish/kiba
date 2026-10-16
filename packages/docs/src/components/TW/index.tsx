import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

// Marca cada lugar que depende de Trustless Work (⚠️ TW en el documento fuente).
// El equipo decidió reemplazar TW por escrows propios de Kiba: busca `<TW` en
// docs/ para encontrar todo lo que habrá que reescribir al migrar.
export default function TW(): ReactNode {
  return (
    <Link
      to="/stellar/trustless-work"
      className={styles.badge}
      title={translate({
        id: 'kiba.tw.title',
        message: 'Hoy vía Trustless Work; se reemplazará por escrows propios de Kiba',
      })}>
      ⚠️ TW
    </Link>
  );
}
