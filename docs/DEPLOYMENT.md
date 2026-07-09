# Despliegue / CI-CD de Kiba

Pipeline de despliegue del monorepo. **Frontends → Vercel**, **backends → Coolify**
(auto-hospedado en el VPS), orquestado por **GitHub Actions** (`.github/workflows/deploy.yml`).
Los secretos de producción viven en **Doppler** (proyecto `kiba`, config `prd`); la única
variable que conoce Coolify es `DOPPLER_TOKEN`.

## Topología

| Paquete | Plataforma | Recurso | URL de producción |
|---|---|---|---|
| `packages/landing` (Astro) | Vercel | `kiba-landing` | https://kiba-landing.vercel.app |
| `packages/dashboard` (Vite) | Vercel | `kiba-dashboard` | https://kiba-dashboard.vercel.app |
| `packages/gateway` (Express) | Coolify | stack `kiba` / `gateway` | https://kiba-api.rodion.com.co |
| `packages/backend` (Express) | Coolify | stack `kiba` / `backend` | https://kiba-data.rodion.com.co |
| Postgres 16 | Coolify | stack `kiba` / `postgres` | (solo red interna) |
| `demo-agents` × 8 | Coolify | stack `kiba` / `agent-<x>` | https://kiba-agent-`<x>`.rodion.com.co |

Agentes: `translator`, `yield`, `risk`, `price`, `code`, `firecrawl` (sirve el servicio
on-chain **web-scraper**), `world`, `randomizer`. Todo el stack de backends es UN recurso
docker-compose de Coolify definido en **`docker-compose.prod.yml`** (raíz del repo).

Los demás paquetes (`sdk`, `contracts`, `contracts-soroban`, `mcp-server`, `installer`,
`orchestrator-agent`) **no se despliegan** en este pipeline (`kiba-mcp` y `kiba-sdk` se
publican a npm con los tags `mcp-v*` / `sdk-v*`; el installer con `installer-v*`).

### IDs de referencia
- Vercel org (team): `team_9ih8tHa4Rdt6QMgOLYFGnBAx`
- Vercel project `kiba-landing`: `prj_gLOztq0RbVqTKyIaf5skUBkIDtW3`
- Vercel project `kiba-dashboard`: `prj_rAW3qHsRmUw9UavD37nRaMZxG2qC`
- Coolify (https://coolify.rodion.com.co): server `xsgscwskwkgoossw00oo04gs`,
  proyecto `kiba` `utx4h07woljtpce6lna02bzl`, app compose `vd3vty7v3zqe5qmbuuvljp6r`
- VPS: `207.246.114.85` (DNS de `*.rodion.com.co` en Hostinger)

## Cómo funciona el CI/CD

En cada `push` a `main`:
1. **`changes`** detecta qué cambió (`dorny/paths-filter`).
2. **`gitleaks`** + **`test`** (npm workspaces + Postgres de test) — gates.
3. Se despliega **solo lo que cambió**:
   - `packages/landing/**` → `vercel pull/build/deploy --prod` (kiba-landing)
   - `packages/dashboard/**` → idem (kiba-dashboard)
   - `packages/{gateway,backend,demo-agents,sdk}/**`, `docker-compose.prod.yml`,
     `docker/**`, `scripts/agent-entrypoint.sh` → **webhook de Coolify**
     (`GET /api/v1/deploy?uuid=$COOLIFY_APP_UUID`): Coolify hace pull del repo y
     reconstruye el stack (el build cache amortigua los servicios sin cambios).

También se puede lanzar a mano desde la pestaña Actions (`workflow_dispatch`), o
redesplegar solo el stack con:
`curl -H "Authorization: Bearer $COOLIFY_TOKEN" "https://coolify.rodion.com.co/api/v1/deploy?uuid=<APP_UUID>"`.

## Secrets de GitHub requeridos

| Secret | Cómo obtenerlo |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens |
| `COOLIFY_TOKEN` | Panel de Coolify → Keys & Tokens → API tokens |
| `COOLIFY_APP_UUID` | UUID de la app compose `kiba` (ver IDs de referencia) |

## Secretos de runtime (Doppler)

- **Proyecto `kiba`**, configs `dev` (local) / `prd` (producción). El contrato de claves
  está en `.env.example`; los valores reales SOLO en Doppler.
- Cada contenedor del stack arranca con `doppler run` (ver `Dockerfile.coolify` de cada
  paquete y `docker/postgres.Dockerfile`); Coolify inyecta únicamente `DOPPLER_TOKEN`
  (service token `coolify-prd`, scope solo-prd).
- Claves por agente: `AGENT_WALLET_SECRET_<AGENTE>` (namespaced); el shim
  `scripts/agent-entrypoint.sh` mapea la del `AGENT_NAME` en curso a `AGENT_WALLET_SECRET`
  y limpia el resto.
- La **master wallet** del gateway viaja como `MASTER_WALLET_SECRET` (el gateway es
  stateless; no hay volumen de wallets). ⚠️ Si esa clave falta, el gateway **genera una
  treasury nueva en silencio** — verificar siempre en logs que `Master wallet:` sea
  `GAJNTKOPP733TXDRBLPAVKA6TS3KQMR2HNXAEPLCL3WSXIW6EFDQOL5U`.

## Stack de Coolify (docker-compose.prod.yml)

- 11 servicios: `gateway` (8000), `backend` (4000), `postgres` y 8 `agent-<x>` (5001-5008).
  Traefik de Coolify termina TLS (Let's Encrypt) y enruta cada dominio al puerto del
  contenedor; no se publican puertos al host.
- **Volúmenes**: `postgres-data` (la DB de negocio — crítico) y `backend-data`
  (SQLite del indexer + cache de modelos transformers.js — reconstruible).
- Healthchecks por servicio (`/health`); el backend tarda en el primer boot
  (descarga modelos, `start_period: 300s`).
- El catálogo del backend se siembra con `STELLAR_SERVICES` (Doppler) — el volumen nuevo
  no ve eventos on-chain viejos, así que los servicios existentes deben estar en la semilla.
- ⚠️ **NO levantar este compose (ni los demo-agents del compose dev) en local**: los
  agentes re-registran su `PUBLIC_ENDPOINT` on-chain al arrancar y pisan producción.

### Agregar otro demo-agent

1. Generar keypair Stellar (fondearlo con friendbot) y guardarlo en Doppler `kiba/prd`
   como `AGENT_WALLET_SECRET_<NUEVO>`.
2. Añadir el servicio al `docker-compose.prod.yml` (copiar un `agent-*`: `AGENT_NAME`,
   `PORT` nuevo, `PUBLIC_ENDPOINT=https://kiba-agent-<x>.rodion.com.co`).
3. Añadir el mapeo al `unset` de `scripts/agent-entrypoint.sh` y el script `start:<x>`
   en `packages/demo-agents/package.json` si no existe.
4. Registro A `kiba-agent-<x>.rodion.com.co → 207.246.114.85` en Hostinger.
5. Dominio del servicio en el panel de Coolify (app kiba → servicio → Domains, con
   `:puerto`) y añadirlo a `STELLAR_SERVICES` en Doppler.
6. Push a main (el CI dispara el deploy). `bootstrap()` registra el agente on-chain
   en el primer arranque.

> ⚠️ **El master wallet del gateway debe estar fondeado on-chain.** En modo virtual el
> gateway refilla la custodial del usuario desde el master (`ensureFunded`) para abrir el
> escrow. Si el master no existe on-chain, todo `call_agent` falla. En testnet:
> `curl "https://friendbot.stellar.org/?addr=<MASTER_PUBKEY>"`.

## Configuración de Vercel

- Cada proyecto despliega desde su carpeta (`packages/landing`, `packages/dashboard`)
  con su propio `vercel.json`.
- **Dashboard**: SPA estática; rutas relativas reescritas por Vercel:
  - `/api/*` → `https://kiba-api.rodion.com.co` (gateway)
  - `/backend/*` → `https://kiba-data.rodion.com.co` (backend)
- **Landing**: Astro hornea en build-time `PUBLIC_BACKEND_URL`, `PUBLIC_GATEWAY_URL`,
  `PUBLIC_DASHBOARD_URL` (env vars de producción en Vercel; los defaults del código ya
  apuntan a los dominios nuevos).

## Railway (legado — en desmontaje)

Los backends vivieron en Railway hasta 2026-07-08 (cutover a Coolify). Los servicios
quedaron **pausados** (`railway down`) con sus volúmenes intactos como fallback durante
el periodo de convivencia; el teardown definitivo (borrar servicios, volúmenes,
`RAILWAY_TOKEN` y `scripts/deploy-railway-agent.sh` + `Dockerfile.railway`) procede tras
≥7 días de E2E verde y la republicación de `kiba-mcp`/installer. Rollback durante la
convivencia: reactivar los servicios en Railway y revertir los rewrites del dashboard.

## Pendientes conocidos

- ⚠️ **WebSocket en el dashboard**: abre `wss://{location.host}/ws`. Vercel **no proxea
  WebSockets** por rewrites. Con el backend en dominio propio ya se puede apuntar el WS
  directo a `wss://kiba-data.rodion.com.co/ws` (`packages/dashboard/src/routes/Agents.tsx`).
- **Comunicación interna**: gateway → backend y gateway → agentes van por la red interna
  de compose (`http://backend:4000`) o por el dominio público (agentes, hairpin vía
  Traefik) según el registro on-chain.
