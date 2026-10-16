import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Translate, {translate} from '@docusaurus/Translate';
import styles from './index.module.css';

const GITHUB_URL = 'https://github.com/CoKeFish/kiba';

// Portada tipo landing: hero con las mascotas de Kiba, caminos y accesos rápidos.

function Hero(): ReactNode {
  const agents = useBaseUrl('/img/agents');
  return (
    <header className={styles.hero}>
      <div className={styles.heroText}>
        <h1 className={styles.heroTitle}>
          <Translate id="kiba.home.hero.titleStart">Paga cualquier servicio desde cualquier</Translate>{' '}
          <span className={styles.highlight}>
            <Translate id="kiba.home.hero.titleHighlight">asistente de IA</Translate>
          </span>
        </h1>
        <p className={styles.heroSub}>
          <Translate id="kiba.home.hero.subtitle">
            Kiba es el rail que permite que Claude, ChatGPT, Cursor y tus propios agentes descubran servicios especializados y los paguen por llamada en USDC sobre Stellar. Sin API keys ni configuración por servicio.
          </Translate>
        </p>
        <div className={styles.heroActions}>
          <Link className={clsx(styles.btn, styles.btnPrimary)} to="/conecta-tu-asistente">
            <Translate id="kiba.home.hero.ctaConnect">Conecta tu asistente</Translate>
            <span aria-hidden="true">→</span>
          </Link>
          <Link className={clsx(styles.btn, styles.btnSecondary)} to="/publica-un-servicio/quickstart">
            <Translate id="kiba.home.hero.ctaPublish">Publica un servicio</Translate>
            <span aria-hidden="true">🚀</span>
          </Link>
        </div>
      </div>
      <div className={styles.mascots} aria-hidden="true">
        <img className={clsx(styles.mascot, styles.mBlob)} src={`${agents}/blob.png`} alt="" />
        <img className={clsx(styles.mascot, styles.mHeart)} src={`${agents}/heart.png`} alt="" />
        <img className={clsx(styles.mascot, styles.mStar)} src={`${agents}/star.png`} alt="" />
        <img className={clsx(styles.mascot, styles.mCircle)} src={`${agents}/circle.png`} alt="" />
        <img className={clsx(styles.mascot, styles.mTriangle)} src={`${agents}/triangle.png`} alt="" />
      </div>
    </header>
  );
}

type Path = {mascot: string; title: string; body: string; link: string; to: string};

function Paths(): ReactNode {
  const agents = useBaseUrl('/img/agents');
  const paths: Path[] = [
    {
      mascot: 'star',
      title: translate({id: 'kiba.home.paths.use.title', message: 'Usa servicios desde tu asistente'}),
      body: translate({id: 'kiba.home.paths.use.body', message: 'Conecta Claude, ChatGPT o tu IDE una vez y deja que encuentre y pague el servicio adecuado para cada tarea.'}),
      link: translate({id: 'kiba.home.paths.use.link', message: 'Conectar Claude'}),
      to: '/conecta-tu-asistente/claude',
    },
    {
      mascot: 'triangle',
      title: translate({id: 'kiba.home.paths.publish.title', message: 'Publica un servicio y cobra'}),
      body: translate({id: 'kiba.home.paths.publish.body', message: 'Envuelve un modelo, una API o un dataset con kiba-sdk, fija un precio por llamada y liquida en USDC.'}),
      link: translate({id: 'kiba.home.paths.publish.link', message: 'Quickstart de publisher'}),
      to: '/publica-un-servicio/quickstart',
    },
    {
      mascot: 'circle',
      title: translate({id: 'kiba.home.paths.build.title', message: 'Construye con el SDK y la API'}),
      body: translate({id: 'kiba.home.paths.build.body', message: 'Llama servicios desde tus propios agentes, consulta saldos e historial o automatiza la publicación desde CI.'}),
      link: translate({id: 'kiba.home.paths.build.link', message: 'Visión general del SDK'}),
      to: '/sdk',
    },
  ];
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Translate id="kiba.home.paths.heading">Elige tu camino</Translate>
      </h2>
      <div className={styles.pathGrid}>
        {paths.map((p) => (
          <Link key={p.to} to={p.to} className={styles.card}>
            <span className={styles.pathMascot}>
              <img src={`${agents}/${p.mascot}.png`} alt="" />
            </span>
            <span className={styles.cardTitle}>{p.title}</span>
            <span className={styles.cardBody}>{p.body}</span>
            <span className={styles.cardLink}>{p.link} →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

type Shortcut = {icon: string; title: string; body: string; link: string; to: string};

function StartHere(): ReactNode {
  const items: Shortcut[] = [
    {icon: 'home', to: '/introduccion',
      title: translate({id: 'kiba.home.start.what.title', message: 'Qué es Kiba'}),
      body: translate({id: 'kiba.home.start.what.body', message: 'El problema, los dos lados del rail y las piezas que lo hacen funcionar.'}),
      link: translate({id: 'kiba.home.start.what.link', message: 'Introducción'})},
    {icon: 'layers', to: '/conceptos/servicios-y-registro',
      title: translate({id: 'kiba.home.start.concepts.title', message: 'Conceptos'}),
      body: translate({id: 'kiba.home.start.concepts.body', message: 'Servicios y registro, créditos y wallet, roles y la arquitectura general.'}),
      link: translate({id: 'kiba.home.start.concepts.link', message: 'Conceptos'})},
    {icon: 'coin', to: '/conceptos/pagos-y-liquidacion',
      title: translate({id: 'kiba.home.start.payments.title', message: 'Pagos y liquidación'}),
      body: translate({id: 'kiba.home.start.payments.body', message: 'Llamadas firmadas por la plataforma, liquidación por lotes con escrow y el reparto 95/5.'}),
      link: translate({id: 'kiba.home.start.payments.link', message: 'Cómo funcionan los pagos'})},
    {icon: 'chat', to: '/conecta-tu-asistente/chatgpt',
      title: translate({id: 'kiba.home.start.chatgpt.title', message: 'Conectar ChatGPT'}),
      body: translate({id: 'kiba.home.start.chatgpt.body', message: 'La misma URL del conector que Claude, agregada desde Developer mode.'}),
      link: translate({id: 'kiba.home.start.chatgpt.link', message: 'ChatGPT'})},
    {icon: 'terminal', to: '/conecta-tu-asistente/ides-y-clientes-locales',
      title: translate({id: 'kiba.home.start.ide.title', message: 'IDEs y clientes locales'}),
      body: translate({id: 'kiba.home.start.ide.body', message: 'Claude Code, Cursor, Claude Desktop y Codex: kiba-mcp o el instalador de Windows.'}),
      link: translate({id: 'kiba.home.start.ide.link', message: 'Configuración local'})},
    {icon: 'api', to: '/api',
      title: translate({id: 'kiba.home.start.api.title', message: 'API REST del gateway'}),
      body: translate({id: 'kiba.home.start.api.body', message: 'Autenticación, endpoints y errores de todo lo que hacen el dashboard y los conectores.'}),
      link: translate({id: 'kiba.home.start.api.link', message: 'Referencia de la API'})},
    {icon: 'globe', to: '/stellar',
      title: translate({id: 'kiba.home.start.stellar.title', message: 'Stellar y on-chain'}),
      body: translate({id: 'kiba.home.start.stellar.body', message: 'Valores de testnet, trustlines de USDC, el contrato de registro y el escrow.'}),
      link: translate({id: 'kiba.home.start.stellar.link', message: 'Stellar'})},
    {icon: 'activity', to: '/publica-un-servicio/panel-de-publisher',
      title: translate({id: 'kiba.home.start.dashboard.title', message: 'Panel de publisher'}),
      body: translate({id: 'kiba.home.start.dashboard.body', message: 'Ganancias, liquidaciones, analítica y los servicios que gestionas desde app.kiba.tools.'}),
      link: translate({id: 'kiba.home.start.dashboard.link', message: 'Panel'})},
    {icon: 'help', to: '/recursos/faq',
      title: translate({id: 'kiba.home.start.faq.title', message: 'FAQ y solución de problemas'}),
      body: translate({id: 'kiba.home.start.faq.body', message: 'Preguntas frecuentes y soluciones para conectores, pagos y publicación.'}),
      link: translate({id: 'kiba.home.start.faq.link', message: 'Soporte'})},
  ];
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Translate id="kiba.home.start.heading">Empieza aquí</Translate>
      </h2>
      <div className={styles.startGrid}>
        {items.map((it) => (
          <Link key={it.to} to={it.to} className={styles.card}>
            <span className={clsx(styles.cardIcon, `icon-${it.icon}`)} aria-hidden="true" />
            <span className={styles.cardTitle}>{it.title}</span>
            <span className={styles.cardBody}>{it.body}</span>
            <span className={styles.cardLink}>{it.link} →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function WhatYouCanDo(): ReactNode {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Translate id="kiba.home.can.heading">Qué puedes hacer</Translate>
      </h2>
      <ul className={styles.canList}>
        <li>
          <Translate id="kiba.home.can.ask">
            Pide a tu asistente la hora en otra ciudad, un precio de mercado, una revisión de código o una página extraída, y deja que pague al especialista que lo hace bien.
          </Translate>
        </li>
        <li>
          <Translate id="kiba.home.can.publish">
            Publica un modelo, una API o un dataset una vez y cobra por llamada, incluso cuando quien llama es un agente de IA y no una persona.
          </Translate>
        </li>
        <li>
          <Translate id="kiba.home.can.build">
            Construye tu propio agente con el SDK y paga a otros servicios sin confianza desde su propia wallet.
          </Translate>
        </li>
      </ul>
    </section>
  );
}

function Links(): ReactNode {
  const llms = useBaseUrl('/llms.txt');
  const links: Array<[string, string]> = [
    ['kiba.tools', 'https://kiba.tools'],
    ['Dashboard', 'https://app.kiba.tools'],
    ['GitHub', GITHUB_URL],
    [translate({id: 'kiba.home.links.sdk', message: 'kiba-sdk en npm'}), 'https://www.npmjs.com/package/kiba-sdk'],
    [translate({id: 'kiba.home.links.mcp', message: 'kiba-mcp en npm'}), 'https://www.npmjs.com/package/kiba-mcp'],
  ];
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Translate id="kiba.home.links.heading">Enlaces</Translate>
      </h2>
      <div className={styles.pills}>
        {links.map(([label, href]) => (
          <a key={href} className={styles.pill} href={href} target="_blank" rel="noopener noreferrer">
            {label} <span aria-hidden="true">↗</span>
          </a>
        ))}
        <a className={styles.pill} href={llms}>llms.txt</a>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title={translate({id: 'kiba.home.meta.title', message: 'Paga cualquier servicio desde cualquier asistente de IA'})}
      description={translate({
        id: 'kiba.home.meta.description',
        message: 'Kiba permite que cualquier asistente de IA descubra servicios especializados y los pague por llamada, con liquidación en USDC sobre Stellar.',
      })}>
      <main className={styles.page}>
        <Hero />
        <Paths />
        <StartHere />
        <WhatYouCanDo />
        <Links />
      </main>
    </Layout>
  );
}
