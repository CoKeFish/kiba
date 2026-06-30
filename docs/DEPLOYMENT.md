# Despliegue / CI-CD de Kiba

Pipeline de despliegue del monorepo. **Frontends → Vercel**, **backends → Railway**,
orquestado por **GitHub Actions** (`.github/workflows/deploy.yml`).

## Topología

| Paquete | Plataforma | Proyecto / Servicio | URL de producción |
|---|---|---|---|
| `packages/landing` (Astro) | Vercel | `kiba-landing` | https://kiba-landing.vercel.app |
| `packages/dashboard` (Vite) | Vercel | `kiba-dashboard` | https://kiba-dashboard.vercel.app |
| `packages/backend` (Express) | Railway | `kiba` / `backend` | https://backend-production-c019.up.railway.app |
| `packages/gateway` (Express) | Railway | `kiba` / `gateway` | https://gateway-production-be17.up.railway.app |
| `demo-agents` (translator-pro) | Railway | `kiba` / `kiba-agent-translator` | https://kiba-agent-translator-production.up.railway.app |
| `demo-agents` (yield-hunter) | Railway | `kiba` / `kiba-agent-yield` | https://kiba-agent-yield-production.up.railway.app |
| `demo-agents` (risk-auditor) | Railway | `kiba` / `kiba-agent-risk` | https://kiba-agent-risk-production.up.railway.app |
| `demo-agents` (price-oracle) | Railway | `kiba` / `kiba-agent-price` | https://kiba-agent-price-production.up.railway.app |
| `demo-agents` (code-reviewer) | Railway | `kiba` / `kiba-agent-code` | https://kiba-agent-code-production.up.railway.app |
| `demo-agents` (world-clock) | Railway | `kiba` / `kiba-agent-world` | https://kiba-agent-world-production.up.railway.app |
| `demo-agents` (randomizer) | Railway | `kiba` / `kiba-agent-randomizer` | https://kiba-agent-randomizer-production.up.railway.app |

Los demás paquetes (`sdk`, `contracts`, `contracts-soroban`, `mcp-server`, `installer`,
`orchestrator-agent`) **no se despliegan** en este pipeline.

### Demo-agents en Railway (1 servicio por agente)

Los 5 agentes corren en servicios Railway separados (un puerto público c/u). Imagen:
`packages/demo-agents/Dockerfile.railway` (selecciona el agente con `AGENT_NAME`).
Variables por servicio: `AGENT_NAME` (translator-pro|yield-hunter|risk-auditor|price-oracle|code-reviewer|world-clock|randomizer),
`AGENT_WALLET_SECRET` (keypair del owner on-chain; secreto `S...` o JSON array de bytes),
`PUBLIC_ENDPOINT` (su URL pública — el agente actualiza su endpoint on-chain en boot vía
`bootstrap()`), más las compartidas `CHAIN=stellar`, `STELLAR_*`, `BACKEND_URL`,
`KIBA_PLATFORM_PUBLIC_KEY`, `TRUSTLESS_WORK_PLATFORM_ADDRESS`, `RAILWAY_DOCKERFILE_PATH`.
No están en el pipeline de CI; se despliegan con `railway up --service kiba-agent-<x>`
(o con el script de abajo, que automatiza todo el alta).

### Agregar otro demo-agent (script)

`scripts/deploy-railway-agent.sh <AGENT_NAME>` hace el alta completa de un agente nuevo
en Railway: genera su keypair Stellar, lo fondea en testnet (friendbot), crea el servicio
`kiba-agent-<corto>` **clonando las variables compartidas** de un agente ya desplegado
(`REF_SERVICE`, def. `kiba-agent-code`) para garantizar paridad de envs, despliega con
`Dockerfile.railway`, genera el dominio y fija `PUBLIC_ENDPOINT`. El registro on-chain lo
hace `bootstrap()` en el primer arranque (y corrige el endpoint vía drift en el redeploy).

```bash
# requiere: railway CLI logueado+linkeado a kiba/production, docker, curl
scripts/deploy-railway-agent.sh world-clock
scripts/deploy-railway-agent.sh randomizer
```

Tras desplegar, agrega su fila a la tabla de arriba con la URL generada. Desplegados con
este flujo: **world-clock** (`kiba-agent-world`) y **randomizer** (`kiba-agent-randomizer`),
ambos vivos, registrados on-chain y llamables vía MCP (`call_agent`).

> ⚠️ **El master wallet del gateway debe estar fondeado on-chain.** En modo virtual el
> gateway refilla la custodial del usuario desde el master (`ensureFunded`) para abrir el
> escrow. Si el master (ver "Master wallet:" en los logs de boot del gateway) no existe
> on-chain, todo `call_agent` falla con "apertura de escrow no confirmó". En testnet:
> `curl "https://friendbot.stellar.org/?addr=<MASTER_PUBKEY>"`.

### IDs de referencia
- Vercel org (team): `team_9ih8tHa4Rdt6QMgOLYFGnBAx`
- Vercel project `kiba-landing`: `prj_gLOztq0RbVqTKyIaf5skUBkIDtW3`
- Vercel project `kiba-dashboard`: `prj_rAW3qHsRmUw9UavD37nRaMZxG2qC`
- Railway project `kiba`: `61a4dba1-3dd1-449c-a06f-422444591ad9`
- Railway env `production`: `36b0c441-ab30-4f91-840e-67e90aec7ec5`

## Cómo funciona el CI/CD

En cada `push` a `main`:
1. **`changes`** detecta qué paquetes cambiaron (`dorny/paths-filter`).
2. **`test`** corre `npm ci` + `npm test --workspaces --if-present` (gate).
3. Si los tests pasan, se despliega **solo lo que cambió**:
   - `packages/landing/**` → `vercel pull/build/deploy --prod` (kiba-landing)
   - `packages/dashboard/**` → idem (kiba-dashboard)
   - `packages/backend/**` o `packages/sdk/**` → `railway up --service backend`
   - `packages/gateway/**` o `packages/sdk/**` → `railway up --service gateway`

También se puede lanzar a mano desde la pestaña Actions (`workflow_dispatch`).

## Secrets de GitHub requeridos

| Secret | Estado | Cómo obtenerlo |
|---|---|---|
| `RAILWAY_TOKEN` | ✅ configurado | Project token (scope `production`) creado para el proyecto `kiba`. |
| `VERCEL_TOKEN` | ⏳ **pendiente (manual)** | Crear en https://vercel.com/account/tokens y añadirlo (ver abajo). |

```bash
# Crear el token en https://vercel.com/account/tokens, luego:
gh secret set VERCEL_TOKEN --repo CoKeFish/kiba
# (pega el token cuando lo pida)
```

## Configuración de Railway (servicios backend y gateway)

Build vía Dockerfiles de **producción** (`packages/<svc>/Dockerfile.railway`), seleccionados
con la variable `RAILWAY_DOCKERFILE_PATH` por servicio. Arrancan con `tsx` (sin watch).

Variables ya configuradas (entorno `production`):
- Comunes: `NODE_ENV=production`, `CHAIN=stellar`, `STELLAR_*` (testnet), `RAILWAY_DOCKERFILE_PATH`.
- `backend`: `BACKEND_DATA_DIR`, `TRANSFORMERS_CACHE`, `SEMANTIC_SEARCH`, `STELLAR_SERVICES`.
- `gateway`: `JWT_SECRET` (generado), `PUBLIC_URL`, `BACKEND_URL`, `CORS_ORIGINS`,
  `DB_PATH`, `MASTER_KEYPAIR_PATH`, `SOL_USD_RATE`, `XLM_USD_RATE`.

**Volúmenes persistentes** (críticos — no borrar):
- `backend` → `/app/packages/backend/data` (SQLite + cache de modelos transformers.js)
- `gateway` → `/app/data` (SQLite + **master-wallet custodial**)

El puerto lo inyecta Railway (`$PORT`); ambos servicios usan `process.env.PORT`.

## Configuración de Vercel

- Cada proyecto despliega desde su carpeta (`packages/landing`, `packages/dashboard`)
  con su propio `vercel.json` (framework + build + rewrites).
- **Dashboard**: SPA estática; llama a rutas relativas que Vercel reescribe:
  - `/api/*` → gateway (Railway)
  - `/backend/*` → backend (Railway)
- **Landing**: Astro hornea en build-time `PUBLIC_BACKEND_URL`, `PUBLIC_GATEWAY_URL`,
  `PUBLIC_DASHBOARD_URL` (configuradas como env vars de producción en Vercel).
- **Dashboard** env build-time: `VITE_CHAIN=stellar`, `VITE_XLM_USD_RATE=0.12`.

## Pendientes conocidos

- ⚠️ **WebSocket en el dashboard**: abre `wss://{location.host}/ws`. Vercel **no proxea
  WebSockets** por rewrites, así que la función en vivo (feed de agentes) no funcionará
  tras Vercel sin un cambio: apuntar el WS directo a la URL pública del backend
  (`packages/dashboard/src/routes/Agents.tsx`). HTTP (`/api`, `/backend`) sí funciona.
- **Dominios personalizados**: el antiguo `vercel.json` raíz apuntaba a
  `kiba-api.rodion.com.co` (gateway) y `kiba-data.rodion.com.co` (backend). Si se quieren
  usar, mapearlos con `railway domain <dominio> -s <svc>` + DNS, y actualizar los rewrites.
- **Comunicación interna**: el gateway llama al backend por su URL pública. Se puede
  optimizar con la red privada de Railway (`*.railway.internal`) si hace falta.
