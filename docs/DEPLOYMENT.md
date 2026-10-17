# Despliegue / CI-CD de Kiba

Pipeline de despliegue del monorepo. **Todo corre en Coolify** (auto-hospedado en el VPS):
frontends, backends y docs son UN stack docker-compose, orquestado por **GitHub Actions**
(`.github/workflows/deploy.yml`). Vercel ya no sirve nada: solo redirige las URLs viejas
`*.vercel.app` a `kiba.tools` (ver § Vercel).
Los secretos de producción viven en **Doppler** (proyecto `kiba`, config `prd`); la única
variable que conoce Coolify es `DOPPLER_TOKEN`.

## Topología

| Paquete | Plataforma | Recurso | URL de producción |
|---|---|---|---|
| `packages/landing` (Astro, estático) | Coolify | stack `kiba` / `landing` | https://kiba.tools |
| `packages/dashboard` (Vite, estático + nginx) | Coolify | stack `kiba` / `dashboard` | https://app.kiba.tools |
| `packages/gateway` (Express) | Coolify | stack `kiba` / `gateway` | https://api.kiba.tools |
| `packages/backend` (Express) | Coolify | stack `kiba` / `backend` | https://data.kiba.tools |
| `packages/docs` (Docusaurus 3, estático, es/en/pt) | Coolify | stack `kiba` / `docs` | https://docs.kiba.tools |
| Postgres 16 | Coolify | stack `kiba` / `postgres` | (solo red interna) |
| `demo-agents` × 9 | Coolify | stack `kiba` / `agent-<x>` | https://agent-`<x>`.kiba.tools |
| Umami 3 (métricas internas) + Postgres propio | Coolify | stack `kiba` / `umami`, `umami-db` | https://metrics.kiba.tools (login) |

Agentes: `translator`, `yield`, `risk`, `price`, `code`, `firecrawl` (sirve el servicio
on-chain **web-scraper**), `world`, `randomizer`, `meshy` (sirve el servicio on-chain
**3d-generator**: modelos 3D con la API de Meshy, `MESHY_API_KEY` en Doppler `kiba/prd`).
Todo (backends, landing, dashboard y docs;
los tres últimos son sitios estáticos sin secretos) es UN recurso docker-compose de Coolify
definido en **`docker-compose.prod.yml`** (raíz del repo).

Los demás paquetes (`sdk`, `contracts`, `contracts-soroban`, `mcp-server`, `installer`,
`orchestrator-agent`) **no se despliegan** en este pipeline (`kiba-mcp` y `kiba-sdk` se
publican a npm con los tags `mcp-v*` / `sdk-v*`; el installer con `installer-v*`).

### IDs de referencia
- Vercel (solo redirects, ver § Vercel): org `team_9ih8tHa4Rdt6QMgOLYFGnBAx`, proyecto
  `kiba-landing` `prj_gLOztq0RbVqTKyIaf5skUBkIDtW3`, proyecto `kiba-dashboard`
  `prj_rAW3qHsRmUw9UavD37nRaMZxG2qC`
- Coolify (https://coolify.rodion.com.co): server `xsgscwskwkgoossw00oo04gs`,
  proyecto `kiba` `utx4h07woljtpce6lna02bzl`, app compose `vd3vty7v3zqe5qmbuuvljp6r`
- VPS: `207.246.114.85` (DNS de `*.kiba.tools` en Cloudflare; los `*.suchima.com` viejos siguen apuntando aquí solo para redirigir)

### Dominios

Dominio de producto: **`kiba.tools`** (DNS en Cloudflare, registros *DNS only* — sin proxy,
para que Let's Encrypt (Traefik) valide directo). Hay un token de API de Cloudflare
con permiso `Zone.DNS:Edit` solo sobre `kiba.tools` en Doppler `shared/prd` →
`CLOUDFLARE_API_TOKEN` (las demás configs de `shared` lo heredan), para crear registros sin
entrar al panel:

```bash
CF=$(doppler secrets get CLOUDFLARE_API_TOKEN --plain --project shared --config prd)
ZONE=$(curl -s -H "Authorization: Bearer $CF" 'https://api.cloudflare.com/client/v4/zones?name=kiba.tools' | jq -r '.result[0].id')
curl -s -X POST -H "Authorization: Bearer $CF" -H 'Content-Type: application/json' \n  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \n  -d '{"type":"A","name":"agent-nuevo","content":"207.246.114.85","ttl":1,"proxied":false}'
``` Mapa de servicios en la tabla de
arriba. En Coolify el mapa vive en `docker_compose_domains` de la app compose; se lee o ajusta
sin entrar al panel con el workflow `coolify-domains.yml`:

```bash
gh workflow run coolify-domains.yml                 # muestra los actuales
gh workflow run coolify-domains.yml -f domains='[{"name":"gateway","domain":"https://api.kiba.tools:8000"},{"name":"backend","domain":"https://data.kiba.tools:4000"},{"name":"agent-translator","domain":"https://agent-translator.kiba.tools:5003"},{"name":"agent-yield","domain":"https://agent-yield.kiba.tools:5001"},{"name":"agent-risk","domain":"https://agent-risk.kiba.tools:5002"},{"name":"agent-price","domain":"https://agent-price.kiba.tools:5004"},{"name":"agent-code","domain":"https://agent-code.kiba.tools:5005"},{"name":"agent-firecrawl","domain":"https://agent-firecrawl.kiba.tools:5006"},{"name":"agent-world","domain":"https://agent-world.kiba.tools:5007"},{"name":"agent-randomizer","domain":"https://agent-randomizer.kiba.tools:5008"},{"name":"agent-meshy","domain":"https://agent-meshy.kiba.tools:5009"},{"name":"docs","domain":"https://docs.kiba.tools:4321"},{"name":"landing","domain":"https://kiba.tools:4321"},{"name":"dashboard","domain":"https://app.kiba.tools:80"},{"name":"umami","domain":"https://metrics.kiba.tools:3000"}]'
```

> Desde Coolify 4.4.6 el `:puerto` de cada dominio se guarda aparte, en el campo
> `domain_port_overrides` (host → puerto), que la API **no devuelve**: `docker_compose_domains`
> sale sin puertos y es normal. El PATCH sigue aceptando `https://host:puerto` y rellena ambos.
> Para verlo: `select domain_port_overrides from applications where uuid='<APP_UUID>'` en la
> DB de Coolify (por SSH, `docker exec coolify-db psql -U coolify -d coolify`).

Los dominios anteriores **redirigen** al nuevo:

- Backends `kiba-api.suchima.com`, `kiba-data.suchima.com`, `kiba-agent-<x>.suchima.com` →
  labels Traefik `legacy-<servicio>` en `docker-compose.prod.yml` (router propio con prioridad
  1000 + `redirectregex`, conserva path y query; GET responde 301 y el resto 308). Esos hosts
  siguen apuntando al VPS en DNS y NO van en `docker_compose_domains`.
- `kiba.suchima.com` (resuelve por el wildcard `*.suchima.com` → VPS) → `kiba.tools` con las
  labels `legacy-landing` en el servicio `landing` del compose, igual que los backends;
  `www.kiba.tools` → `kiba.tools` con las labels `www-landing` del mismo servicio.
- `kiba-landing.vercel.app` → `kiba.tools` y `kiba-dashboard.vercel.app` → `app.kiba.tools`:
  los dos proyectos de Vercel ya no construyen nada, sirven solo un `vercel.json` con un
  redirect 308 (`scripts/vercel-redirect/<landing|dashboard>/`, ver § Vercel).
- ⚠️ Un cliente API con `Authorization: Bearer` que siga usando `kiba-api.suchima.com` recibe
  el 308 pero `fetch` elimina el header al cambiar de origen → hay que actualizar `KIBA_URL`
  (`kiba-mcp` ≥ 0.1.6 e installer ≥ 0.1.6 ya traen `https://api.kiba.tools`).

## Cómo funciona el CI/CD

En cada `push` a `main`:
1. **`changes`** detecta qué cambió (`dorny/paths-filter`).
2. **`gitleaks`** + **`test`** (npm workspaces + Postgres de test) — gates.
3. Si cambió algo del stack (`packages/{gateway,backend,demo-agents,sdk,landing,dashboard,docs}/**`,
   `package-lock.json`, `docker-compose.prod.yml`, `docker/**`, `scripts/agent-entrypoint.sh`)
   → **webhook de Coolify** (`POST /api/v1/deploy?uuid=$COOLIFY_APP_UUID`; desde Coolify 4.4 solo POST, GET devuelve 405): Coolify hace pull
   del repo y reconstruye el stack (el build cache amortigua los servicios sin cambios).

También se puede lanzar a mano desde la pestaña Actions (`workflow_dispatch`), o
redesplegar solo el stack con:
`curl -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" "https://coolify.rodion.com.co/api/v1/deploy?uuid=<APP_UUID>"`.

## Secrets de GitHub requeridos

| Secret | Cómo obtenerlo |
|---|---|
| `COOLIFY_TOKEN` | Panel de Coolify → Keys & Tokens → API tokens |
| `COOLIFY_APP_UUID` | UUID de la app compose `kiba` (ver IDs de referencia) |

(`VERCEL_TOKEN` sigue guardado en el repo pero ya no lo usa ningún workflow.)

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

- 17 servicios: `gateway` (8000), `backend` (4000), `postgres`, 9 `agent-<x>` (5001-5009),
  `umami` (3000) + `umami-db` (métricas internas, ver § Métricas internas),
  `landing` (4321, build de Astro servido con `serve`; las `PUBLIC_*` van como build args en
  el compose), `dashboard` (80, build de Vite servido por nginx: `packages/dashboard/nginx.conf`
  reescribe `/api/*` → `gateway:8000` y `/backend/*` → `backend:4000` por la red interna) y
  `docs` (4321, estático con `serve`). Los tres estáticos no usan Doppler.
  Traefik de Coolify termina TLS (Let's Encrypt) y enruta cada dominio al puerto del
  contenedor; no se publican puertos al host.
- **Volúmenes**: `postgres-data` (la DB de negocio — crítico), `backend-data`
  (SQLite del indexer + cache de modelos transformers.js — reconstruible) y `umami-db-data`
  (histórico de visitas de Umami — si se pierde, se pierde el histórico, nada más).
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
   `PORT` nuevo, `PUBLIC_ENDPOINT=https://agent-<x>.kiba.tools`).
3. Añadir el mapeo al `unset` de `scripts/agent-entrypoint.sh` y el script `start:<x>`
   en `packages/demo-agents/package.json` si no existe.
4. Registro A `agent-<x>.kiba.tools → 207.246.114.85` en Cloudflare (DNS only, sin proxy; por
   API con `CLOUDFLARE_API_TOKEN`, ver § Dominios).
5. Dominio del servicio en Coolify (workflow `coolify-domains.yml` con la lista completa, o el
   panel: app kiba → servicio → Domains, con `:puerto`) y añadirlo a `STELLAR_SERVICES` en
   Doppler. ⚠️ Coolify solo acepta dominios de servicios que ya existen en el compose del
   último deploy: primero push/deploy, luego el dominio, luego otro redeploy (webhook).
6. Push a main (el CI dispara el deploy). `bootstrap()` registra el agente on-chain
   en el primer arranque.

> ⚠️ **El master wallet del gateway debe estar fondeado on-chain.** En modo virtual el
> gateway refilla la custodial del usuario desde el master (`ensureFunded`) para abrir el
> escrow. Si el master no existe on-chain, todo `call_agent` falla. En testnet:
> `curl "https://friendbot.stellar.org/?addr=<MASTER_PUBKEY>"`.

## Métricas internas (Umami)

Analítica web (visitas, visitantes, páginas, referidos, países, dispositivos) de `kiba.tools`,
`app.kiba.tools` y `docs.kiba.tools`, **solo para uso interno**: https://metrics.kiba.tools
(login de Umami: usuario `admin`, contraseña en Doppler `shared/prd` → `UMAMI_ADMIN_PASSWORD`).
Es [Umami](https://umami.is) 3 auto-hospedado (sin cookies, no identifica personas): servicios
`umami` (`docker/umami.Dockerfile`: imagen oficial fijada + CLI de Doppler) y `umami-db`
(`docker/umami-db.Dockerfile`: Postgres propio, volumen `umami-db-data`) del stack. Secretos en
Doppler `kiba/prd`: `UMAMI_DB_PASSWORD`, `UMAMI_DATABASE_URL` (referencia a la anterior),
`UMAMI_APP_SECRET`, `UMAMI_TWO_FACTOR_KEY`; cada contenedor los pide con `--only-secrets`
(no recibe el resto de secretos del stack) y los remapea a los nombres que espera Umami.

Cómo se mide: cada frontend inyecta el tracker (`https://metrics.kiba.tools/kb.js`) **solo si
el build trae el id de su sitio** (build args del compose: `PUBLIC_UMAMI_WEBSITE_ID` landing,
`VITE_UMAMI_WEBSITE_ID` dashboard, `UMAMI_WEBSITE_ID` docs). Los ids son uuids fijos y el sitio
se crea en Umami con ese mismo valor (`POST /api/websites` acepta `id`), así los frontends no
dependen de lo que genere Umami:

| Sitio | uuid en Umami |
|---|---|
| kiba.tools (landing) | `c68090c6-533f-4ed5-8e75-bb0ec6cbb45a` |
| app.kiba.tools (dashboard) | `68c60caf-8a7c-455f-9569-ee54313a44a4` |
| docs.kiba.tools (docs) | `c9090a87-d09c-4bc1-9891-504d6454b390` |

El script y el endpoint de recolección llevan nombres propios (`TRACKER_SCRIPT_NAME=kb.js`,
`COLLECT_API_ENDPOINT=/api/kb` en el compose) porque los de serie (`script.js`, `/api/send`)
los cortan los bloqueadores de anuncios. Apagar la medición de un sitio = quitar su build arg
del compose (sin id no se inyecta nada). En local no hay Umami ni tracker.

## Vercel (solo redirects)

Los proyectos `kiba-landing` y `kiba-dashboard` siguen existiendo únicamente para que las
URLs viejas `kiba-landing.vercel.app` y `kiba-dashboard.vercel.app` redirijan (308,
conservando la ruta) a `kiba.tools` / `app.kiba.tools`. No tienen dominios propios ni build:
su último deploy es el contenido de `scripts/vercel-redirect/<landing|dashboard>/` (un
`vercel.json` con el redirect). Cómo redesplegarlo: `scripts/vercel-redirect/README.md`.
Si algún día se borran los proyectos, solo dejan de resolver esas dos URLs viejas.

## Railway (desmontado)

Los backends vivieron en Railway hasta 2026-07-08 (cutover a Coolify) y quedaron pausados
como fallback durante la convivencia. El 2026-09-27 se completó el teardown: se eliminaron
`Dockerfile.railway` (×3), `scripts/deploy-railway-agent.sh`, `.railwayignore` y el secret
`RAILWAY_TOKEN` de GitHub, y se restauró `SETTLEMENT_INTERVAL_MS=3600000` en Doppler
`kiba/prd` (se había vaciado para evitar doble liquidación mientras ambos stacks convivían).
Lo único que queda por hacer es borrar el proyecto y sus volúmenes desde el panel de Railway.

## Pendientes conocidos

- **WebSocket en el dashboard**: el dashboard abre el WS directo al backend con
  `VITE_WS_URL=wss://data.kiba.tools/ws` (build arg en el compose;
  `packages/dashboard/src/routes/Agents.tsx`). Si hiciera falta, nginx podría proxearlo por `/ws`.
- **Comunicación interna**: gateway → backend y gateway → agentes van por la red interna
  de compose (`http://backend:4000`) o por el dominio público (agentes, hairpin vía
  Traefik) según el registro on-chain.
