// Sitio de documentación pública (docs.kiba.tools). Deploy: servicio `docs` del stack de
// Coolify en el VPS (docker-compose.prod.yml), vía GitHub Actions. Ver docs/DEPLOYMENT.md.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

const GITHUB = 'https://github.com/CoKeFish/kiba';
const DESCRIPTION =
  'Kiba lets any AI assistant discover specialized services and pay them per call, settled in USDC on Stellar.';
// Las mismas fuentes que la landing: Baloo 2 (títulos), Space Grotesk (texto), JetBrains Mono (código).
const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';

// Cada sección es una carpeta de src/content/docs/; el orden interno lo fija
// `sidebar.order` en el frontmatter de cada página.
const section = (label, directory, translations) => ({
  label,
  translations,
  items: [{ autogenerate: { directory } }],
});

export default defineConfig({
  site: 'https://docs.kiba.tools',
  integrations: [
    starlight({
      title: 'Kiba Docs',
      description: DESCRIPTION,
      // El logo ya es el wordmark "Kiba"; el sufijo "Docs" lo pinta custom.css (.site-title::after).
      logo: { src: './src/assets/logo.png', alt: 'Kiba', replacesTitle: true },
      favicon: '/favicon.png',
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: GOOGLE_FONTS } },
      ],
      // Inglés sin prefijo (/), es/pt con prefijo (/es/, /pt/) — mismo esquema que la landing.
      // Una página sin traducción se sirve en inglés con un aviso.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' },
        pt: { label: 'Português', lang: 'pt' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: GITHUB }],
      editLink: { baseUrl: `${GITHUB}/edit/main/packages/docs/` },
      // custom.css: tokens (colores, fuentes, header, sidebar). components.css: hero, tarjetas, contenido.
      customCss: ['./src/styles/custom.css', './src/styles/components.css'],
      // Header: enlaces "Website" y "Dashboard" junto al icono de GitHub.
      components: { SocialIcons: './src/components/SocialIcons.astro' },
      expressiveCode: {
        styleOverrides: {
          borderRadius: '0.75rem',
          borderColor: 'var(--sl-color-hairline-light)',
          frames: { shadowColor: 'transparent' },
        },
      },
      sidebar: [
        section('Introduction', 'introduction', { es: 'Introducción', pt: 'Introdução' }),
        section('Concepts', 'concepts', { es: 'Conceptos', pt: 'Conceitos' }),
        section('Connect your assistant', 'connect', { es: 'Conecta tu asistente', pt: 'Conecte seu assistente' }),
        section('Publish a service', 'publish', { es: 'Publica un servicio', pt: 'Publique um serviço' }),
        section('Gateway REST API', 'api', { es: 'API REST del gateway', pt: 'API REST do gateway' }),
        section('SDK', 'sdk'),
        section('Stellar', 'stellar'),
        section('Use cases', 'use-cases', { es: 'Casos de uso', pt: 'Casos de uso' }),
        section('Support', 'support', { es: 'Soporte', pt: 'Suporte' }),
      ],
      // Genera /llms.txt, /llms-full.txt y /llms-small.txt para asistentes de IA.
      plugins: [starlightLlmsTxt({ projectName: 'Kiba', description: DESCRIPTION })],
    }),
  ],
  vite: {
    server: {
      host: '0.0.0.0',
      port: 4321,
      strictPort: true,
      allowedHosts: true,
      watch: { usePolling: true },
    },
  },
});
