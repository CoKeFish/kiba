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
  favicon: 'img/logomark.png',

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
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logomark.png',
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
          href: GITHUB_URL,
          label: 'GitHub',
          position: 'right',
          className: 'navbar-pill',
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
            {label: 'Qué es Kiba', to: '/'},
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
