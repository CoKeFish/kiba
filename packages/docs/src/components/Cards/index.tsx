import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

type CardProps = {
  topic: string;
  title: string;
  to: string;
  linkLabel?: string;
};

export function Card({topic, title, to, linkLabel}: CardProps): ReactNode {
  return (
    <Link to={to} className={styles.card}>
      <span className={styles.label}>{topic}</span>
      <span className={styles.title}>{title}</span>
      <span className={styles.label}>{translate({id: 'kiba.card.link', message: 'Enlace'})}</span>
      <span className={styles.link}>{linkLabel ?? title} →</span>
    </Link>
  );
}

export function Cards({children}: {children: ReactNode}): ReactNode {
  return <div className={styles.grid}>{children}</div>;
}
