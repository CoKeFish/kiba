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

Los demás paquetes (`sdk`, `contracts`, `contracts-soroban`, `mcp-server`, `installer`,
`demo-agents`, `orchestrator-agent`) **no se despliegan** en este pipeline.

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
