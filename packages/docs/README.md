# Kiba Docs

Sitio de documentación pública de Kiba ([docs.kiba.tools](https://docs.kiba.tools)), construido con [Docusaurus 3](https://docusaurus.io/) en español, inglés y portugués. Es un paquete **independiente** (no está en los `workspaces` del monorepo).

Viene del repo [andreMD287/Kiba-Docs](https://github.com/andreMD287/Kiba-Docs), cuyo historial se trajo con `git subtree`. Para volver a separarlo en el futuro: `git subtree split --prefix=packages/docs`.

## Desarrollo

```bash
npm install
npm start          # http://localhost:3000 con recarga en caliente
```

## Producción

```bash
npm run build      # genera build/ (falla si hay enlaces rotos)
npm run serve      # sirve build/ en local
```

> La búsqueda local (`@easyops-cn/docusaurus-search-local`) solo indexa en `build`; en `npm start` el buscador aparece, pero sin resultados.

## Estructura

El contenido sigue `kiba-documentacion-oficial.md` (Parte A, §1–§14). La Parte B (apéndices) es material interno y no se publica.

```
docs/
  introduccion/          §1  Qué es Kiba (ruta /), estado, enlaces, docs para asistentes de IA
  conceptos/             §2  Servicios, roles, descubrimiento, créditos, pagos, arquitectura, confianza
  conecta-tu-asistente/  §3  Claude, ChatGPT, IDEs y clientes locales, herramientas MCP
  publica-un-servicio/   §4  Quickstart → problemas frecuentes
  sdk/                   §5  AgentProvider, AgentClient, operar tu plataforma, configuración
  api/                   §6  Autenticación, endpoints, errores
  stellar/               §7  Por qué Stellar, testnet, USDC, contrato, Trustless Work
  recursos/              §8–§14  Seguridad, casos de uso, hoja de ruta, self-hosting, equipo, FAQ, glosario
sidebars.ts              9 secciones planas y siempre abiertas; cada página con ícono (icon-*)
src/css/custom.css       Tokens de Kiba → variables Infima (claro/oscuro) + layout
src/pages/index.tsx      Portada tipo landing (hero con mascotas, caminos y accesos)
src/components/Cards     Tarjetas reutilizables
src/components/TW        Etiqueta ⚠️ TW (ver abajo)
src/theme/DocBreadcrumbs Swizzle (wrap): breadcrumbs + botón "Copiar"
src/theme/MDXComponents  Registra <TW />, <Cards> y <Card> en todas las páginas
i18n/es/code.json        Textos de UI en español (buscador)
```

`npm run build` genera además `/llms.txt` y `/llms-full.txt` (§1.8) con `docusaurus-plugin-llms`, y falla si hay enlaces o anclas rotas.

### Etiqueta ⚠️ TW

Cada lugar que depende de Trustless Work lleva `<TW />`, que enlaza a `/stellar/trustless-work`. El equipo decidió reemplazarlo por escrows propios de Kiba: al migrar, busca `<TW` y `⚠️ TW` en `docs/` e `i18n/` para encontrar todo lo que hay que reescribir.

## Despliegue

`docs.kiba.tools` es el servicio `docs` de `docker-compose.prod.yml`: Coolify construye `packages/docs/Dockerfile` (contexto en la raíz del monorepo; Node 22: `npm ci`, `npm run build` y `serve build` en el puerto **4321**).

- Cada push a `main` que toque `packages/docs/**` dispara el `deploy.yml` del monorepo, que le pide a Coolify redesplegar el stack.
- **En local con Docker:** `docker compose up docs` → http://localhost:3030.
- **Probar como en producción sin Docker:** `npm run build && npx serve build -l 4321`.

## Idiomas

Español en la raíz (`/`), inglés en `/en` y portugués en `/pt`, igual que [kiba.tools](https://kiba.tools). El selector **EN | ES | PT** del navbar (`src/components/LangPicker`) lleva a la misma página en el otro idioma y conserva el ancla.

```
docs/                                              Fuente en español
i18n/en/docusaurus-plugin-content-docs/current/    Mismas rutas, traducidas al inglés
i18n/pt/docusaurus-plugin-content-docs/current/    Mismas rutas, traducidas al portugués
i18n/<idioma>/docusaurus-plugin-content-docs/current.json   Etiquetas del sidebar
i18n/<idioma>/docusaurus-theme-classic/{navbar,footer}.json Navbar y footer
i18n/<idioma>/code.json                            Textos de componentes y buscador
```

- **Al agregar o cambiar una página**, crea o actualiza su traducción en las dos carpetas `i18n/`. Si falta, Docusaurus muestra el español.
- **Anclas:** los títulos traducidos que son destino de enlaces llevan el `id` del español, p. ej. `## Connection {/* #conexión */}`, así los enlaces con `#` funcionan igual en los tres idiomas.
- **Etiquetas nuevas del sidebar, navbar o footer:** ejecuta `npm run write-translations -- --locale en` (y `pt`) y traduce las claves nuevas.
- `npm start` sirve un solo idioma (`npm start -- --locale en`). Para probar el selector entre idiomas usa `npm run build && npm run serve`.

## Estilos

Los tokens (colores, tipografías Baloo 2 / Space Grotesk / JetBrains Mono, espaciados, radios y sombras) vienen de `packages/landing/src/styles/global.css` y `packages/dashboard/src/styles/globals.css` del repo de Kiba. El modo oscuro se deriva de la escala `ink` del proyecto.

Para agregar un ícono al sidebar, define `.icon-<nombre> { --icon: url(...svg) }` en `custom.css` y usa `className: 'icon-<nombre>'` en `sidebars.ts`.
