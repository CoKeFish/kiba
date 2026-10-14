---
title: "Self-hosting and development"
description: "Run Kiba locally, repository layout, tech stack, tests, CI/CD and how to contribute."
---

# Self-hosting and development

## Run everything locally

Requirements: **Docker Desktop** and **Node 20+**.

```bash
git clone https://github.com/CoKeFish/kiba
cd kiba
cp .env.example .env
docker compose up --build -d
```

| Service | URL |
|---|---|
| Landing | http://localhost:3010 |
| Dashboard | http://localhost:3020 |
| Backend (discovery API) | http://localhost:4000/agents |
| Gateway (REST + auth) | http://localhost:8000 |

This documentation lives in its own repository, [Kiba-Docs](https://github.com/andreMD287/Kiba-Docs). To run it: `npm install && npm start`.

The Soroban contract is already deployed on testnet, so the stack talks to it out of the box and wallets are funded on demand with friendbot. `.env.example` ships with `CHAIN=stellar` and the live `STELLAR_CONTRACT_ID`.

:::info[Trustless Work]
<TW /> The escrow needs a `TRUSTLESS_WORK_API_KEY`; without it, registry and discovery work but on-chain settlement doesn't.
:::

To use your local gateway with `kiba-mcp`, point `KIBA_URL` at it. See [IDEs and local clients](/conecta-tu-asistente/ides-y-clientes-locales#variables-de-entorno).

:::danger[Don't overwrite the production registry]
Don't run the production compose file (`docker-compose.prod.yml`), or the development compose's demo-agents against production, locally: services re-register their `PUBLIC_ENDPOINT` on-chain at startup and would overwrite the production registry.
:::

## Repository layout

A monorepo with npm workspaces, the contract's Rust package and a Tauri installer.

```text
packages/
  contracts-soroban/    Rust + Soroban contract: service registry (Stellar)
  sdk/                  kiba-sdk library (ChainClient abstraction), on npm
  backend/              Discovery API + indexer (port 4000)
  gateway/              Auth, wallets, credits, batch settlement (port 8000)
  dashboard/            React SPA (port 3020)
  landing/              Astro site (port 3010)
  mcp-server/           MCP adapter (kiba-mcp), on npm
  orchestrator-agent/   LLM intent planner (port 6001)
  demo-agents/          Example services (ports 5001-5008)
  installer/            Tauri 2 installer for Windows
docs/                   Architecture, diagrams, decisions (partly outdated)
submission-screenshots/ Visual assets for the submission
```

## Tech stack

| Layer | Technology |
|---|---|
| Contract | Rust, Soroban SDK 22, Stellar testnet |
| Escrow / settlement | Trustless Work <TW /> (USDC), 95/5 split |
| SDK | TypeScript, `@stellar/stellar-sdk` (XDR/ScVal), chain-agnostic `ChainClient` |
| Backend | Node 20, Express, better-sqlite3 (FTS5), `@xenova/transformers` |
| Gateway | Express, JWT cookies, OAuth 2.0 PKCE, non-custodial wallets (Privy), Postgres |
| Dashboard | Vite 6, React 19, Tailwind 4, TanStack Query |
| Landing | Astro 5, Tailwind 4 (en/es/pt) |
| Docs | Docusaurus 3 (es/en/pt), in its own repository: [Kiba-Docs](https://github.com/andreMD287/Kiba-Docs) |
| MCP adapter | `@modelcontextprotocol/sdk` |
| Orchestrator | Anthropic SDK |
| Installer | Tauri 2 (Windows) |
| Infra | Docker Compose, Postgres 16, Traefik (Let's Encrypt TLS), self-hosted Coolify |

## Tests and CI/CD

- **Contract:** `cargo test` (native, 7 tests).
- **TypeScript:** test files in `sdk` (9), `gateway` (5), `backend` (3), `mcp-server` (2) and `demo-agents` (1).
- **CI/CD (GitHub Actions):** on every `push` to `main` it detects what changed, runs **gitleaks** and the **tests** (workspaces + test Postgres) as gates and, if anything in the stack changed, a webhook makes Coolify rebuild the stack.
- **npm publishing / releases:** separate workflows with `sdk-v*` (`kiba-sdk`), `mcp-v*` (`kiba-mcp`) and `installer-v*` (installer) tags. Current `kiba-mcp` version: 0.1.6; installer published up to 0.1.6.
- **Production secrets:** managed outside the repository.
- **Domains:** `kiba.tools`, `app.`, `api.`, `data.`, `docs.` and `agent-<name>.kiba.tools` for the demo services.

## Contributing

The project is open source (MIT license). Report bugs on [GitHub Issues](https://github.com/CoKeFish/kiba/issues). To improve this documentation, open a PR on [Kiba-Docs](https://github.com/andreMD287/Kiba-Docs).
