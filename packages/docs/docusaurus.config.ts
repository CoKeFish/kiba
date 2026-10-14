import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const GITHUB_URL = 'https://github.com/CoKeFish/kiba';
const DASHBOARD_URL = 'https://app.kiba.tools';
const SITE_URL = 'https://kiba.tools';

// Docusaurus compila cada idioma por separado y expone el actual en esta variable;
// así /llms.txt, /en/llms.txt y /pt/llms.txt salen cada uno en su idioma.
const CURRENT_LOCALE = process.env.DOCUSAURUS_CURRENT_LOCALE ?? 'es';
const LLMS_DOCS_DIR =
  CURRENT_LOCALE === 'es' ? 'docs' : `i18n/${CURRENT_LOCALE}/docusaurus-plugin-content-docs/current`;
const LLMS_DESCRIPTION: Record<string, string> = {
  es: 'Kiba permite que cualquier asistente de IA descubra servicios especializados y los pague por llamada, con liquidación en USDC sobre Stellar.',
  en: 'Kiba lets any AI assistant discover specialized services and pay them per call, settled in USDC on Stellar.',
  pt: 'A Kiba permite que qualquer assistente de IA descubra serviços especializados e pague por chamada, com liquidação em USDC na Stellar.',
};

const config: Config = {
  title: 'Kiba Docs',
  tagline: 'Pay any service from any AI assistant',
  // La "K" del logo de Kiba, cuadrada para que se lea en la pestaña (16/32/48 px).
  favicon: 'favicon.ico',
  headTags: [
    {tagName: 'link', attributes: {rel: 'apple-touch-icon', href: '/img/apple-touch-icon.png'}},
    {tagName: 'link', attributes: {rel: 'icon', type: 'image/png', sizes: '512x512', href: '/img/kiba-icon-512.png'}},
  ],

  future: {
    v4: true,
  },

  url: 'https://docs.kiba.tools',
  baseUrl: '/',
  // Una sola URL por página (sin barra final), también para las páginas índice.
  trailingSlash: false,

  organizationName: 'CoKeFish',
  projectName: 'kiba',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  // Español en la raíz, inglés en /en y portugués en /pt (como kiba.tools).
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en', 'pt'],
    localeConfigs: {
      es: {label: 'Español', htmlLang: 'es'},
      en: {label: 'English', htmlLang: 'en'},
      pt: {label: 'Português', htmlLang: 'pt-BR'},
    },
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  plugins: [
    [
      'docusaurus-plugin-llms',
      {
        // §1.8: /llms.txt y /llms-full.txt para asistentes de IA.
        docsDir: [{path: LLMS_DOCS_DIR, routeBasePath: '/'}],
        // Mismo orden que el sidebar.
        includeOrder: [
          'introduccion/index.mdx',
          'introduccion/*',
          'conceptos/servicios-y-registro.md',
          'conceptos/roles.md',
          'conceptos/descubrimiento-hibrido.md',
          'conceptos/creditos-y-wallet.md',
          'conceptos/pagos-y-liquidacion.md',
          'conceptos/arquitectura.md',
          'conceptos/modelo-de-confianza.md',
          'conecta-tu-asistente/index.md',
          'conecta-tu-asistente/conector-claude.md',
          'conecta-tu-asistente/chatgpt.md',
          'conecta-tu-asistente/instalador-windows.mdx',
          'conecta-tu-asistente/*',
          'publica-un-servicio/index.md',
          'publica-un-servicio/quickstart.mdx',
          'publica-un-servicio/handler-y-precios.md',
          'publica-un-servicio/despliegue.md',
          'publica-un-servicio/descubrimiento-y-llamadas.md',
          'publica-un-servicio/como-cobras.md',
          'publica-un-servicio/nombres-y-confianza.md',
          'publica-un-servicio/panel-de-publisher.md',
          'publica-un-servicio/mainnet.md',
          'publica-un-servicio/problemas-frecuentes.md',
          'sdk/index.md',
          'sdk/agent-provider.md',
          'sdk/agent-client.md',
          'sdk/operar-tu-plataforma.md',
          'sdk/configuracion.md',
          'sdk/errores.md',
          'api/index.md',
          'api/autenticacion.md',
          'api/*',
          'stellar/index.md',
          'stellar/testnet.md',
          'stellar/usdc-y-trustlines.md',
          'stellar/contrato-de-registro.md',
          'stellar/trustless-work.md',
          'recursos/seguridad.md',
          'recursos/casos-de-uso.md',
          'recursos/hoja-de-ruta.md',
          'recursos/self-hosting.md',
          'recursos/equipo.md',
          'recursos/soporte.md',
          'recursos/faq.md',
          'recursos/glosario.md',
        ],
        generateLLMsTxt: true,
        generateLLMsFullTxt: true,
        title: 'Kiba Docs',
        description: LLMS_DESCRIPTION[CURRENT_LOCALE],
        excludeImports: true,
        removeDuplicateHeadings: true,
      },
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['es', 'en', 'pt'],
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        searchBarShortcutHint: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          // Modo solo docs: los docs viven en la raíz del sitio.
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          showLastUpdateTime: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Vista previa al compartir el enlace (1200×630), una por idioma.
    image: `img/social-card-${CURRENT_LOCALE}.png`,
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: false,
      },
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
    navbar: {
      logo: {
        alt: 'Kiba',
        src: 'img/logo.png',
        href: '/',
      },
      items: [
        {type: 'search', position: 'left'},
        {type: 'custom-langPicker', position: 'right'},
        {
          // Ícono de GitHub (como en docs.kiba.tools) en vez de un botón con texto.
          type: 'html',
          position: 'right',
          value: `<a class="navbar-github" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg></a>`,
        },
        {
          href: SITE_URL,
          label: 'kiba.tools',
          position: 'right',
          className: 'navbar-pill',
        },
        {
          href: DASHBOARD_URL,
          label: 'Dashboard',
          position: 'right',
          className: 'navbar-pill navbar-pill--primary',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Documentación',
          items: [
            {label: 'Qué es Kiba', to: '/introduccion'},
            {label: 'Conecta tu asistente', to: '/conecta-tu-asistente'},
            {label: 'Arquitectura', to: '/conceptos/arquitectura'},
            {label: 'FAQ', to: '/recursos/faq'},
            {label: 'Soporte', to: '/recursos/soporte'},
          ],
        },
        {
          title: 'Construir',
          items: [
            {label: 'Publica un servicio', to: '/publica-un-servicio/quickstart'},
            {label: 'SDK (kiba-sdk)', to: '/sdk'},
            {label: 'API REST del gateway', to: '/api'},
            {label: 'Stellar y on-chain', to: '/stellar'},
          ],
        },
        {
          title: 'Proyecto',
          items: [
            {label: 'kiba.tools', href: SITE_URL},
            {label: 'Dashboard', href: DASHBOARD_URL},
            {label: 'GitHub', href: GITHUB_URL},
            {label: 'kiba-sdk en npm', href: 'https://www.npmjs.com/package/kiba-sdk'},
            {label: 'kiba-mcp en npm', href: 'https://www.npmjs.com/package/kiba-mcp'},
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Kiba · Licencia MIT`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
      additionalLanguages: ['bash', 'json', 'rust', 'toml'],
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
      options: {
        fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
