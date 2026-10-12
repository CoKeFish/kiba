# @kiba/docs

Sitio de documentación pública de Kiba (https://docs.kiba.tools), construido con
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

- Contenido en `src/content/docs/` (Markdown/MDX). Una carpeta por sección; el orden
  dentro de cada sección lo fija `sidebar.order` en el frontmatter de cada página.
- Idiomas: inglés en la raíz (`/`); `es/` y `pt/` como subcarpetas de `src/content/docs/`
  con la misma estructura. Una página sin traducción se sirve en inglés con un aviso.
- `llms.txt`, `llms-full.txt` y `llms-small.txt` se generan en el build (plugin
  `starlight-llms-txt`) para que los asistentes de IA indexen la documentación.
- Paquete **standalone** (no está en los `workspaces` del monorepo): usa Astro 7 y
  Node ≥ 22.12, distinto de la landing (Astro 5, Node 20). Tiene su propio
  `package-lock.json`; el `node_modules` solo existe dentro del contenedor.

## Diseño

- Tema propio sobre Starlight: `src/styles/custom.css` (tokens de color, fuentes, header,
  sidebar) y `src/styles/components.css` (hero, botones, tarjetas, tablas, paginación).
  Colores y fuentes salen de `packages/landing/src/styles/global.css` (Baloo 2 para títulos,
  Space Grotesk para texto, JetBrains Mono para código; se cargan de Google Fonts vía `head`
  en `astro.config.mjs`). Starlight usa cascade layers, así que el CSS propio (sin layer)
  gana sin `!important`.
- Componentes propios en `src/components/`: `SocialIcons.astro` (override de Starlight que
  añade los enlaces Website/Dashboard al header) y `TopicCard.astro` (tarjetas de la portada,
  estilo docs.trustlesswork.com).
- Portada: `src/content/docs/index.mdx` (template `splash`). Las mascotas de la landing están
  en `public/agents/` (PNG transparentes); el hero las monta en un collage (`.kb-friends`)
  porque el `friends.png` de la landing tiene el fondo blanco pintado.

## Desarrollo

```bash
docker compose up docs                                   # http://localhost:3030 (build estático)
docker compose run --rm --service-ports docs npm run dev # hot-reload mientras se escribe
```

## Build

```bash
docker build -f packages/docs/Dockerfile -t kiba-docs .
```

Deploy: servicio `docs` del stack de Coolify en el VPS (`docker-compose.prod.yml`,
dominio `docs.kiba.tools`), ver `docs/DEPLOYMENT.md`.
