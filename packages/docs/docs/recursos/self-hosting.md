---
title: "Self-hosting y desarrollo"
description: "Levanta Kiba en local, estructura del repo, stack técnico, pruebas, CI/CD y cómo contribuir."
---

# Self-hosting y desarrollo

## Levantar todo en local

Requisitos: **Docker Desktop** y **Node 20+**.

```bash
git clone https://github.com/CoKeFish/kiba
cd kiba
cp .env.example .env
docker compose up --build -d
```

| Servicio | URL |
|---|---|
| Landing | http://localhost:3010 |
| Dashboard | http://localhost:3020 |
| Backend (API de descubrimiento) | http://localhost:4000/agents |
| Gateway (REST + auth) | http://localhost:8000 |
| Docs (`docker compose up docs`) | http://localhost:3030 |

Para editar esta documentación con recarga en caliente: `npm --prefix packages/docs install` y `npm --prefix packages/docs start`.

El contrato Soroban ya está desplegado en testnet, así que el stack habla con él de entrada y las wallets se fondean bajo demanda con friendbot. `.env.example` trae `CHAIN=stellar` y el `STELLAR_CONTRACT_ID` vivo.

:::info[Trustless Work]
<TW /> El escrow necesita un `TRUSTLESS_WORK_API_KEY`; sin él, el registro y el descubrimiento funcionan pero la liquidación on-chain no.
:::

Para usar tu gateway local con `kiba-mcp`, apunta `KIBA_URL` a él. Ver [IDEs y clientes locales](/conecta-tu-asistente/ides-y-clientes-locales#variables-de-entorno).

:::danger[No pises el registro de producción]
No levantes el compose de producción (`docker-compose.prod.yml`), ni los demo-agents del compose de desarrollo contra producción, en local: los servicios re-registran su `PUBLIC_ENDPOINT` on-chain al arrancar y pisarían el registro de producción.
:::

## Estructura del repositorio

Monorepo con npm workspaces, el paquete Rust del contrato y un instalador Tauri.

```text
packages/
  contracts-soroban/    Contrato Rust + Soroban: registro de servicios (Stellar)
  sdk/                  Librería kiba-sdk (abstracción ChainClient), en npm
  backend/              API de descubrimiento + indexador (puerto 4000)
  gateway/              Auth, wallets, créditos, liquidación por lotes (puerto 8000)
  dashboard/            SPA React (puerto 3020)
  landing/              Sitio Astro (puerto 3010)
  mcp-server/           Adaptador MCP (kiba-mcp), en npm
  docs/                 Sitio de documentación, Docusaurus 3 (docs.kiba.tools)
  orchestrator-agent/   Planificador de intención con LLM (puerto 6001)
  demo-agents/          Servicios de ejemplo (puertos 5001-5008)
  installer/            Instalador Tauri 2 para Windows
docs/                   Arquitectura, diagramas, decisiones (parte desactualizada)
submission-screenshots/ Recursos visuales de la entrega
```

## Stack técnico

| Capa | Tecnología |
|---|---|
| Contrato | Rust, Soroban SDK 22, Stellar testnet |
| Escrow / liquidación | Trustless Work <TW /> (USDC), reparto 95/5 |
| SDK | TypeScript, `@stellar/stellar-sdk` (XDR/ScVal), `ChainClient` agnóstico de cadena |
| Backend | Node 20, Express, better-sqlite3 (FTS5), `@xenova/transformers` |
| Gateway | Express, cookies JWT, OAuth 2.0 PKCE, wallets no custodiales (Privy), Postgres |
| Dashboard | Vite 6, React 19, Tailwind 4, TanStack Query |
| Landing | Astro 5, Tailwind 4 (en/es/pt) |
| Docs | Docusaurus 3 (es/en/pt), en `packages/docs` (paquete independiente fuera de los workspaces) |
| Adaptador MCP | `@modelcontextprotocol/sdk` |
| Orquestador | Anthropic SDK |
| Instalador | Tauri 2 (Windows) |
| Infra | Docker Compose, Postgres 16, Traefik (TLS Let's Encrypt), Coolify auto-hospedado |

## Pruebas y CI/CD

- **Contrato:** `cargo test` (nativo, 7 tests).
- **TypeScript:** archivos de prueba en `sdk` (9), `gateway` (5), `backend` (3), `mcp-server` (2) y `demo-agents` (1).
- **CI/CD (GitHub Actions):** en cada `push` a `main` se detecta qué cambió, corren **gitleaks** y las **pruebas** (workspaces + Postgres de prueba) como compuertas y, si cambió algo del stack, un webhook hace que Coolify reconstruya el stack.
- **Publicación a npm / releases:** workflows separados con tags `sdk-v*` (`kiba-sdk`), `mcp-v*` (`kiba-mcp`) e `installer-v*` (instalador). Versión actual de `kiba-mcp`: 0.1.6; instalador publicado hasta 0.1.6.
- **Secretos de producción:** gestionados fuera del repositorio.
- **Dominios:** `kiba.tools`, `app.`, `api.`, `data.`, `docs.` y `agent-<nombre>.kiba.tools` para los servicios de demostración.

## Contribuir

El proyecto es de código abierto (licencia MIT). Reporta errores en [GitHub Issues](https://github.com/CoKeFish/kiba/issues). Para mejorar esta documentación, edita `packages/docs` y abre un PR.
