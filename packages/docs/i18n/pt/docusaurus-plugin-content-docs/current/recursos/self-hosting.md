---
title: "Self-hosting e desenvolvimento"
description: "Suba a Kiba localmente, estrutura do repositório, stack técnico, testes, CI/CD e como contribuir."
---

# Self-hosting e desenvolvimento

## Subir tudo localmente

Requisitos: **Docker Desktop** e **Node 20+**.

```bash
git clone https://github.com/CoKeFish/kiba
cd kiba
cp .env.example .env
docker compose up --build -d
```

| Serviço | URL |
|---|---|
| Landing | http://localhost:3010 |
| Dashboard | http://localhost:3020 |
| Backend (API de descoberta) | http://localhost:4000/agents |
| Gateway (REST + auth) | http://localhost:8000 |
| Docs (`docker compose up docs`) | http://localhost:3030 |

Para editar esta documentação com recarga automática: `npm --prefix packages/docs install` e `npm --prefix packages/docs start`.

O contrato Soroban já está implantado na testnet, então o stack conversa com ele desde o início e as wallets são financiadas sob demanda com o friendbot. O `.env.example` traz `CHAIN=stellar` e o `STELLAR_CONTRACT_ID` ativo.

:::info[Trustless Work]
<TW /> O escrow precisa de um `TRUSTLESS_WORK_API_KEY`; sem ele, o registro e a descoberta funcionam, mas a liquidação on-chain não.
:::

Para usar seu gateway local com o `kiba-mcp`, aponte `KIBA_URL` para ele. Veja [IDEs e clientes locais](/conecta-tu-asistente/ides-y-clientes-locales#variables-de-entorno).

:::danger[Não sobrescreva o registro de produção]
Não suba localmente o compose de produção (`docker-compose.prod.yml`), nem os demo-agents do compose de desenvolvimento apontando para produção: os serviços registram de novo seu `PUBLIC_ENDPOINT` on-chain ao iniciar e sobrescreveriam o registro de produção.
:::

## Estrutura do repositório

Monorepo com npm workspaces, o pacote Rust do contrato e um instalador Tauri.

```text
packages/
  contracts-soroban/    Contrato Rust + Soroban: registro de serviços (Stellar)
  sdk/                  Biblioteca kiba-sdk (abstração ChainClient), no npm
  backend/              API de descoberta + indexador (porta 4000)
  gateway/              Auth, wallets, créditos, liquidação em lote (porta 8000)
  dashboard/            SPA React (porta 3020)
  landing/              Site Astro (porta 3010)
  mcp-server/           Adaptador MCP (kiba-mcp), no npm
  docs/                 Site de documentação, Docusaurus 3 (docs.kiba.tools)
  orchestrator-agent/   Planejador de intenção com LLM (porta 6001)
  demo-agents/          Serviços de exemplo (portas 5001-5008)
  installer/            Instalador Tauri 2 para Windows
docs/                   Arquitetura, diagramas, decisões (parte desatualizada)
submission-screenshots/ Recursos visuais da entrega
```

## Stack técnico

| Camada | Tecnologia |
|---|---|
| Contrato | Rust, Soroban SDK 22, Stellar testnet |
| Escrow / liquidação | Trustless Work <TW /> (USDC), divisão 95/5 |
| SDK | TypeScript, `@stellar/stellar-sdk` (XDR/ScVal), `ChainClient` agnóstico de cadeia |
| Backend | Node 20, Express, better-sqlite3 (FTS5), `@xenova/transformers` |
| Gateway | Express, cookies JWT, OAuth 2.0 PKCE, wallets não custodiais (Privy), Postgres |
| Dashboard | Vite 6, React 19, Tailwind 4, TanStack Query |
| Landing | Astro 5, Tailwind 4 (en/es/pt) |
| Docs | Docusaurus 3 (es/en/pt), em `packages/docs` (pacote independente fora dos workspaces) |
| Adaptador MCP | `@modelcontextprotocol/sdk` |
| Orquestrador | Anthropic SDK |
| Instalador | Tauri 2 (Windows) |
| Infra | Docker Compose, Postgres 16, Traefik (TLS Let's Encrypt), Coolify auto-hospedado |

## Testes e CI/CD

- **Contrato:** `cargo test` (nativo, 7 testes).
- **TypeScript:** arquivos de teste em `sdk` (9), `gateway` (5), `backend` (3), `mcp-server` (2) e `demo-agents` (1).
- **CI/CD (GitHub Actions):** a cada `push` na `main` detecta o que mudou, roda **gitleaks** e os **testes** (workspaces + Postgres de teste) como portões e, se algo do stack mudou, um webhook faz o Coolify reconstruir o stack.
- **Publicação no npm / releases:** workflows separados com tags `sdk-v*` (`kiba-sdk`), `mcp-v*` (`kiba-mcp`) e `installer-v*` (instalador). Versão atual do `kiba-mcp`: 0.1.6; instalador publicado até a 0.1.6.
- **Segredos de produção:** gerenciados fora do repositório.
- **Domínios:** `kiba.tools`, `app.`, `api.`, `data.`, `docs.` e `agent-<nome>.kiba.tools` para os serviços de demonstração.

## Contribuir

O projeto é de código aberto (licença MIT). Informe erros no [GitHub Issues](https://github.com/CoKeFish/kiba/issues). Para melhorar esta documentação, edite `packages/docs` e abra um PR.
