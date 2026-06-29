# Plan de Pruebas — Kiba

> Documento de consolidación. Define **qué se debería cubrir** (no ejecuta pruebas). Consolida los hallazgos de 10 dominios en un plan único, priorizado y accionable.
> Fecha: 2026-06-24 · Rama: `feat/slidev-deploy` · Cadena activa: **Stellar testnet (Soroban)**

---

## 1. Resumen ejecutivo

**Kiba** (rebrand de *agent-bazaar*) es un monorepo web3: un **marketplace de agentes de IA** que se descubren, se contratan y se pagan vía el protocolo **x402** con un **split atómico 95/5** (95 % al owner del agente, 5 % al treasury de la plataforma). Es **multi-cadena**: contratos hermanos en **Solana/Anchor** (SOL nativo, lamports) y **Stellar/Soroban** (token SAC, XLM/USDC). El stack lo componen contratos on-chain, un SDK de pago, un backend de descubrimiento (API + indexer + búsqueda semántica), un gateway custodial (créditos virtuales + OAuth/PKCE para humanos), 5 agentes demo, un orquestador LLM, un servidor MCP (cliente IDE) y dos frontends (landing + dashboard).

### Estado real del despliegue (a reflejar en todo el plan)

| Hecho | Implicación para las pruebas |
|---|---|
| **Stellar es la cadena ACTIVA**. Contrato Soroban `CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`, token XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, `initialize` + smoke OK. | Toda la cobertura on-chain "real" se valida contra este contrato y con identidades de testnet fondeadas por friendbot. |
| **El ID activo solo vive en `.env` (gitignored)**. Todo lo trackeado defaultea al ID **viejo/stale** `CA5M54YV4KG3E75YDJEUXY2C4FYBIEHTQJVZQASYF2WPJUO4KHEIQ62M` (verificado en `docker-compose.yml` líneas 44/119/149, `smoke-testnet.sh`, `sdk/scripts/stellar-{smoke,e2e}.ts`, `contracts-soroban/README.md`, `memory/`). | **Drift de configuración P0** transversal. Múltiples escenarios validan consistencia de IDs y exigen override explícito. |
| **`.env.example` NO trae `CHAIN` ni `STELLAR_CONTRACT_ID`** (verificado). El quickstart `cp .env.example .env && docker compose up` reproduce un stack **Solana en modo demo**, no el deploy Stellar activo. | **Reproducibilidad rota P0**. El entregable no se reconstruye desde el repo. |
| **Solana NO está redesplegado para kiba**: `declare_id`, `Anchor.toml` y `.env PROGRAM_ID` son el ID heredado `3CsQnAua...` (`TODO(kiba-redeploy)`). | Los escenarios on-chain de Anchor están **bloqueados**; los unit de Anchor (localnet) sí corren. La cadena Solana es rebrand-incorrecta hasta el redeploy. |
| **Stack local (CHAIN=stellar) corriendo**: backend `:4000`, gateway `:8000`, landing `:3010`, dashboard `:3020`, demo-agents `:5001-5005`, orchestrator `:6001`. `backend /health` OK pero **`indexedAgents=0`** (ningún agente registrado on-chain todavía). | El marketplace está "vacío": discovery, catálogo y todo flujo de pago E2E parten de cero agentes. Es el estado por defecto que el frontend y el backend deben manejar con gracia. |
| **El orquestador necesita `ANTHROPIC_API_KEY` real** (hoy hay placeholder `sk-ant-xxxx`). | La planificación LLM no opera; cae a modo keyword. La ruta feliz LLM requiere clave real (no automatizable en CI sin secreto). |
| **El bloque orchestrator de `docker-compose.yml` NO recibe `CHAIN`/`STELLAR_*`** (verificado). | El orquestador cae a modo degradado → todo pago a specialist falla. **P0 de dinero.** |
| **El dashboard despliega con `npm run dev`** (Vite dev server) y `tsc` no se ejecuta en deploy; `Billing.tsx` tiene un import faltante (`baseUnitsToUsd`) que rompe el build (verificado). | El typecheck no es puerta de deploy; un error de compilación ya está en producción. **P0.** |

### Objetivo del plan

1. **Blindar el dinero y la seguridad**: split 95/5, autorización on-chain real, anti-replay, idempotencia, custodia, caps de precio.
2. **Cerrar el drift de configuración** que hoy hace que un deploy roto "se vea sano" (contract ID, modo degradado, `.env.example`, compose del orquestador).
3. **Llevar a cero los dominios sin cobertura** (backend HTTP/WS/indexer, SDK chain/builders, orchestrator, ambos frontends).
4. **Verificar el rebrand en runtime** (cero "agent-bazaar" en respuestas, nombre `kiba` en MCP/servicios).
5. **Dar un orden de ejecución** que priorice lo barato-y-crítico (unit de dinero, lints de config) antes de lo caro (E2E on-chain con fondos).

### Números del plan

- **517 escenarios** en **10 dominios**.
- Por prioridad: **P0 = 163** (negocio/seguridad/dinero/on-chain) · **P1 = 256** · **P2 = 98**.
- Automatizables hoy en CI: la mayoría de unit/integration con red mockeada. **No automatizables sin recursos**: los `onchain`/`e2e` que requieren keypairs de testnet fondeados (friendbot) y los que requieren `ANTHROPIC_API_KEY` real.

---

## 2. Alcance y estrategia de prueba

### 2.1 Pirámide de prueba

```
                 ┌───────────────────────────┐
   manual / UI   │  OAuth IDE, a11y, lighthouse, regresión   │   pocos, humanos
                 ├───────────────────────────┤
   e2e / onchain │  x402 completo, split 95/5, gateway,       │   caros, requieren
                 │  Playground, registro on-chain            │   fondos/LLM
                 ├───────────────────────────┤
   integration   │  HTTP (supertest/fetch), WS, indexer,      │   medios, red mockeada
                 │  provider en modo cadena (mock ChainClient)│
                 ├───────────────────────────┤
       unit      │  split/fee, Borsh, PKCE, builders, regex,  │   muchos, baratos,
                 │  decoders, validaciones, chain factory     │   deterministas
                 └───────────────────────────┘
   contract/sandbox  │  cargo test (test.rs), Anchor localnet │  base de la lógica on-chain
```

La base (unit + contract sandbox) es donde vive la lógica de dinero y debe ser **exhaustiva y barata**. La cúspide (e2e/onchain/manual) confirma que el wiring real funciona y se reserva para los flujos P0 de extremo a extremo.

### 2.2 Niveles, herramientas y notas

| Nivel | Qué cubre | Herramientas sugeridas | Requisitos especiales |
|---|---|---|---|
| **unit** | Lógica pura: `computeFeeSplit`, codecs Borsh, discriminadores, PKCE, `priceFn`, regex del planner, `chain.ts`, validaciones de formulario. | `cargo test` (Rust), `node --import tsx --test` (ya usado en sdk/backend/mcp), **Vitest + RTL** (frontends, hoy ausente). | Ninguno. 100 % CI. |
| **contract/sandbox** | Contrato Soroban en host sandbox (mock auth o auth real), Anchor en localnet. | `cargo test` con `test_snapshots`; **harness sin `mock_all_auths`** para auth; `anchor test` + **`litesvm`/`anchor-bankrun`** para control de reloj (refund). | Ninguno (localnet airdrop). |
| **integration** | HTTP de backend/gateway/agents (sin red externa), WS, indexer con fake reader, provider en modo cadena con **mock `ChainClient`**, proxies de Vite. | `supertest`/`fetch`, **MSW** (frontends), `ws` cliente, fake timers. **Requiere exportar `app`** en `backend/index.ts` y orchestrator. | Red mockeada. CI. |
| **e2e** | Flujo x402 de punta a punta, gateway `/v1/call`, Playground, MCP `call_agent`. | **Playwright** o **chrome-devtools MCP** contra `docker compose`; `AgentClient`+`AgentProvider` reales. | **Keypair de testnet fondeado** (friendbot) y/o **`ANTHROPIC_API_KEY`** según el objetivo. |
| **onchain** | Liquidación real en Soroban/Anchor, split por balances, máquina de estados del escrow, refund tras 300 s. | `stellar contract invoke` (imagen `kiba/stellar-cli`), `StellarChainClient`, Horizon para verificar firmas. | **Identidades de testnet fondeadas** (friendbot autofondea); Anchor **bloqueado** hasta redeploy. |
| **manual / UI** | OAuth en IDE real, auditorías de a11y/contraste, lighthouse, reescritura del baseline E2E. | Navegador real, MCP Inspector, axe-core, Lighthouse. | Humano / juicio de producto. |

### 2.3 Qué requiere recursos (no automatizable en CI plano)

- **Keypair de testnet fondeado (friendbot)**: todos los `onchain` y los `e2e` con liquidación real. Friendbot autofondea cuentas nuevas, pero **rate-limitea** varias cuentas desde una IP (riesgo real con 5 agentes + cliente + orquestador).
- **Clave LLM real (`ANTHROPIC_API_KEY`)**: ruta feliz del planner del orquestador (`orchestrator-21`), prompt-injection (`orchestrator-32`), truncamiento por `max_tokens` (`orchestrator-29`), y cualquier `call_agent` cuyo target sea el orquestador. Mitigación CI: **mockear `@anthropic-ai/sdk`** para devolver bloques `tool_use` deterministas; usar un demo-agent determinista (p.ej. `translator`) para no depender de la clave.
- **Solana devnet redeploy de kiba**: bloquea `contracts-57`, `sdk-57`, y la verificación del program link de la landing (`frontend-landing-11`).
- **Espera wall-clock de 300 s**: refund on-chain (`contracts-72`, `integration-deploy-10`). El caso ya está cubierto en sandbox (`cargo`); on-chain es lento/incómodo para CI.

### 2.4 Convenciones

- **Prioridad** — **P0**: toca dinero / seguridad / on-chain / disponibilidad del marketplace. **P1**: importante (corrección funcional, resiliencia, rebrand). **P2**: deseable (a11y, perf, edge raros, limpieza).
- **Auto** — Sí = automatizable en CI hoy (posiblemente con mocks). No = requiere fondos de testnet, clave LLM, redeploy o juicio humano.
- **Estado** — `Existe` (ya hay test) · `Parcial` (cubierto a medias) · `Gap` (sin cobertura).

---

## 3. Matriz de cobertura por dominio

| Dominio | P0 | P1 | P2 | Total | Cobertura existente | Mayor gap (P0) |
|---|---:|---:|---:|---:|---|---|
| **Contracts** (Soroban + Anchor) | 30 | 38 | 7 | 75 | 14 tests `cargo` (`test.rs`) + 7 Anchor/TS (`kiba.ts`) + smoke on-chain | **Autorización real sin probar** (`mock_all_auths`); replay/nonce; estados terminales; dirección del fee; drift de ID |
| **SDK** (`@kiba/sdk`) | 33 | 32 | 6 | 71 | 4 unit (anchor-helpers, keypair-store, client, provider) en modo degradado + 2 scripts on-chain Stellar | `createChainClient`/selección de cadena, builders `program.ts` y Borsh, verificación on-chain del provider — **sin tests** |
| **Backend** (API/indexer) | 12 | 39 | 9 | 60 | `db.ts`, `search.ts`, `cosineSim` | `index.ts` (HTTP/WS), `indexer.ts`, `registry.ts` **sin NINGÚN test**; pérdida de catálogo por fallo RPC |
| **Demo-agents** | 7 | 10 | 13 | 30 | Indirecta vía `sdk/provider.test.ts` (modo degradado) | **Cero tests propios**; modo cadena (Stellar), registro/escrow/claim/idempotencia/underpayment sin probar |
| **MCP server** (`kiba-mcp`) | 9 | 29 | 17 | 55 | `tools.test.ts` + `auth.test.ts` (axios mock, vector PKCE) | **Money path `call_agent` sin E2E**; header auth en POST; OAuth handshake completo; sin timeout/abort |
| **Orchestrator** | 8 | 23 | 14 | 45 | **Cero propios**; indirecta vía `sdk/client.test.ts` + `keypair-store` | Paquete **sin tests**; compose **sin `CHAIN`/`STELLAR_*`** (pagos rotos); `/intent` sin auth/CORS; cap mal denominado |
| **Frontend — Landing** | 3 | 20 | 15 | 38 | **Ninguna** (sin runner) | Cero cobertura; build/deploy; sin fuga de secretos; CTA del instalador |
| **Frontend — Dashboard** | 24 | 34 | 7 | 65 | **Ninguna** UI (solo `tsc` + react-doctor, **no en deploy**) | **Build roto** (Billing); chain default `solana`; flujos de dinero (Playground/topup/keys); sesión |
| **Integración / Deploy** | 11 | 16 | 7 | 34 | ~14 `cargo` + smoke + deploy scripts + `stellar-{smoke,e2e}.ts` + `E2E_MCP_VALIDATION.md` (infra muerta) | Drift de ID; reproducibilidad; modo degradado silencioso; sin healthchecks; `indexedAgents=0` |
| **Gateway** (`@kiba/gateway`) | 26 | 15 | 3 | 44 | 4 suites unit de helpers (`auth/oauth/billing/wallets.test.ts`): JWT, PKCE, `debit` atómico, custodia | **JWT_SECRET débil por defecto**; `redirect_uri` sin validar (phishing) + code sin expiración; **secretos custodiales en claro** + master hot key; doble-gasto/carrera + `/topup` drena treasury; API keys sin scope; XSS en consent. **HTTP/middleware/`proxy.ts`/`views.ts`/`api-keys.ts` sin test** |
| **TOTAL** | **163** | **256** | **98** | **517** | | |

> **Nota sobre el gateway**: ahora con **dominio propio en §5.10**. La cobertura existente son **4 suites unit de helpers** (`auth/oauth/billing/wallets.test.ts`, todas en el script `test`): JWT, PKCE, `debit` atómico y carga de custodiales. Lo NO cubierto es **toda la capa HTTP/middleware** (`index.ts`), `api-keys.ts`, `agents.ts`, `proxy.ts`, `views.ts` y las **propiedades de seguridad**. El flujo de dinero del proxy `/v1/call` se valida vía **FLUJO-E2E-1** e `integration-deploy-04/05/11`; el consent OAuth lo renderiza el gateway (`frontend-dashboard-38/39`).

---

## 4. Flujos E2E consolidados (deduplicación)

Varios escenarios de distintos dominios validan **el mismo flujo subyacente** desde perspectivas diferentes. Para evitar duplicar trabajo, se definen **flujos canónicos** y los demás se referencian. El conteo de la matriz mantiene los IDs por dominio (cada uno es un punto de entrada legítimo); aquí solo se agrupan para planificar la **automatización compartida**.

### FLUJO-E2E-1 — Handshake x402 completo con liquidación Soroban (la "ruta del dinero")

> **Canónico:** `integration-deploy-01` (AgentProvider HTTP real + AgentClient + liquidación Soroban, trace de 4 pasos con firmas reales).

| Perspectiva | ID | Aporte específico |
|---|---|---|
| SDK marketplace | `sdk-61` | E2E SDK puro sobre Stellar |
| Demo-agent | `demo-agents-03` | El servicio corre **solo** tras pago verificado on-chain |
| Gateway (virtual) | `integration-deploy-04` | Debita crédito virtual + refill master + claim |
| Gateway (wallet-direct) | `integration-deploy-05` | Crédito agotado → custodial paga on-chain |
| MCP | `mcp-server-45` | `call_agent` debita **exactamente una vez** |
| Orquestador | `orchestrator-44` | Orquestador paga al specialist, split 95/5 |
| Dashboard | `frontend-dashboard-51` | Playground ejecuta el call y refleja saldo/firma |

### FLUJO-E2E-2 — Split 95/5 verificado on-chain por balances

> **Canónico:** `integration-deploy-02` (treasury sube exactamente 5 % sin firmar ninguna tx).

Referencias: `contracts-17` (unit Soroban), `contracts-46` (Anchor localnet), `contracts-67` (smoke CLI), `contracts-64` (paridad aritmética por vector de montos), `sdk-01`/`sdk-03` (computeFeeSplit y consistencia de constantes SDK↔contrato), `frontend-dashboard-59` (split mostrado usa `fee.pct` dinámico).

### FLUJO-E2E-3 — Anti-replay / idempotencia del escrow

> **Canónico (on-chain):** `demo-agents-05` (reintentar el mismo X-PAYMENT tras claim → 402, sin doble servicio).

Referencias: `contracts-24`/`contracts-25` (`EscrowExists` y reuso de nonce tras claim/refund), `contracts-28`/`contracts-30` (doble claim, claim tras refund), `contracts-58` (colisión de init de PDA en Anchor), `sdk-44` (provider rechaza escrow no-`Pending`), `mcp-server-46`.

### FLUJO-E2E-4 — Underpayment y cap de precio (`maxPrice`)

> **Canónico:** `sdk-30` (el cap se compara contra `manifest.pricePerCall`, **no** contra `quote.amount` → provider malicioso sobrecobra).

Referencias: `sdk-45` (provider rechaza underpayment), `demo-agents-06`, `orchestrator-38` (cap mal denominado: XLM/SOL, no USDC), `integration-deploy-11` (circuit breaker 2× en el proxy), `contracts-20` (`AmountBelowPrice`).

### CONFIG-DRIFT — Configuración que hace que un deploy roto "se vea sano"

| Tema | Canónico | Referencias |
|---|---|---|
| Drift de contract ID (stale vs activo) | `integration-deploy-06` | `contracts-74`, `sdk-66`, `backend-56`, `integration-deploy-20` |
| Modo degradado silencioso (sin `STELLAR_CONTRACT_ID`) | `integration-deploy-07` | `demo-agents-07`, `orchestrator-41`, `sdk-17`, `backend-04` |
| Reproducibilidad (`.env.example` incompleto) | `integration-deploy-08` | — |
| `indexedAgents=0` (registro vacío) | `integration-deploy-09` | `demo-agents-04`, `demo-agents-13`, `backend-09`, `backend-36` |
| Chain default = `solana` en frontends/servicios | `frontend-dashboard-45` | `frontend-dashboard-44`, `integration-deploy-13`, `frontend-landing-28` |

---

## 5. Escenarios priorizados por dominio

### 5.1 Contracts (Soroban desplegado + Anchor/Solana no redesplegado)

Dos contratos en paridad: Soroban (`packages/contracts-soroban/src/lib.rs`, **desplegado**, custodia SAC, split 500 bps, ventana refund 300 s) y Anchor (`packages/contracts/programs/kiba/src/lib.rs`, SOL nativo, treasury hardcodeada, **no redesplegado**). La lógica feliz del split está bien cubierta; los gaps P0 son de **seguridad/dinero**.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| contracts-01 | initialize fija token+treasury | happy | unit | P1 | `get_config()` devuelve lo provisto | Sí | Existe |
| contracts-02 | initialize dos veces → AlreadyInitialized | error | unit | P1 | 2.ª vez `Err`, config intacta | Sí | Existe |
| contracts-03 | register + get_agent, stats en 0 | happy | unit | P1 | datos guardados; calls/earned=0 | Sí | Existe |
| contracts-04 | register duplicado → AgentExists | error | unit | P1 | unicidad 1 agente/servicio | Sí | Existe |
| contracts-05 | register service vacío → ServiceEmpty | error | unit | P1 | `Err(ServiceEmpty)` | Sí | Existe |
| contracts-06 | register price=0 → PriceMustBePositive | error | unit | P1 | `Err` | Sí | Existe |
| contracts-07 | register price negativo (i128) → PriceMustBePositive | error | unit | P1 | i128 negativo rechazado (Anchor N/A, u64) | Sí | Gap |
| contracts-08 | service límite 32/33 bytes | edge | unit | P1 | 32 OK, 33 → ServiceTooLong | Sí | Gap |
| contracts-09 | endpoint límite 256/257 | edge | unit | P2 | 256 OK, 257 → EndpointTooLong | Sí | Gap |
| contracts-10 | description límite 512/513 | edge | unit | P2 | 512 OK, 513 → DescriptionTooLong | Sí | Gap |
| contracts-11 | update_agent cambia campos, conserva None | happy | unit | P1 | None no sobrescribe | Sí | Existe |
| contracts-12 | update sobre inexistente → AgentNotFound | error | unit | P1 | `Err` (Anchor: AccountNotInitialized) | Sí | Gap |
| contracts-13 | update price<=0 → PriceMustBePositive | error | unit | P1 | agente sin cambios | Sí | Gap |
| contracts-14 | update endpoint/description demasiado largos | error | unit | P2 | `Err(...TooLong)` | Sí | Gap |
| contracts-15 | deregister elimina el agente | happy | unit | P1 | Soroban None; Anchor PDA cerrada + rent | Sí | Existe |
| contracts-16 | deregister inexistente → AgentNotFound | error | unit | P1 | `Err` | Sí | Gap |
| **contracts-17** | **Flujo open→claim: split 95/5, balances, stats, Completed** | happy | unit | **P0** | owner 95 %, treasury 5 %, contrato 0 | Sí | Existe |
| contracts-18 | fee=0 con amount diminuto (=1) | edge | **P0** | unit | platform_fee=0, owner=1; omite transfer | Sí | Parcial |
| **contracts-19** | **Dirección del redondeo del fee (199→fee 9, owner 190)** | edge | unit | **P0** | el código trunca el fee a favor del **owner**; **CONTRADICE el brief** | Sí | Gap |
| **contracts-20** | open con amount<price → AmountBelowPrice | error | unit | **P0** | sin transferencia | Sí | Existe |
| contracts-21 | open con amount==price exacto (boundary) | edge | unit | P1 | escrow Pending | Sí | Gap |
| contracts-22 | open con amount<=0 → AmountMustBePositive | error | unit | P1 | `Err` | Sí | Gap |
| contracts-23 | open sobre agente inexistente → AgentNotFound | error | unit | P1 | `Err` | Sí | Gap |
| **contracts-24** | **open duplicado (mismo nonce) → EscrowExists (anti-replay)** | security | unit | **P0** | 2.º open `Err`; Anchor: PDA already in use | Sí | Gap |
| **contracts-25** | **Reuso de nonce tras claim/refund → EscrowExists** | security | unit | **P0** | la entrada terminal persiste y bloquea replay | Sí | Gap |
| **contracts-26** | open con saldo insuficiente → falla transfer del token | error | unit | **P0** | token::transfer falla; escrow no se crea | Sí | Gap |
| contracts-27 | open antes de initialize → NotInitialized | error | unit | P1 | `Err` al cargar config | Sí | Gap |
| **contracts-28** | **Doble claim → EscrowNotPending** | security | unit | **P0** | sin doble pago | Sí | Parcial |
| contracts-29 | claim sobre inexistente → EscrowNotFound | error | unit | P1 | `Err` | Sí | Gap |
| **contracts-30** | **claim tras refund → EscrowNotPending** | security | unit | **P0** | no se paga un escrow reembolsado | Sí | Gap |
| contracts-31 | claim sobrevive a deregister (DIVERGENCIA) | edge | unit | P1 | Soroban paga; Anchor falla (cuenta agent cerrada) | Sí | Gap |
| **contracts-32** | refund tras ventana (>300 s) devuelve fondos | happy | unit | **P0** | client recupera amount; Refunded | Sí | Existe |
| **contracts-33** | refund antes de ventana → RefundTooEarly | error | unit | **P0** | `Err` | Sí | Existe |
| contracts-34 | boundary refund: +300 temprano, +301 OK | edge | unit | P1 | condición `<=` created_at+300 | Sí | Gap |
| **contracts-35** | **refund tras claim (Completed) → EscrowNotPending** | security | unit | **P0** | evita drenar el contrato tras pago | Sí | Gap |
| contracts-36 | refund dos veces → EscrowNotPending | security | unit | P1 | 2.º refund `Err` | Sí | Gap |
| contracts-37 | Invariante de custodia: múltiples escrows concurrentes | edge | unit | P1 | balance contrato == suma Pending; aislamiento | Sí | Gap |
| contracts-38 | Emisión de eventos con payload correcto | integration | unit | P1 | topics/datos que indexa el backend | Sí | Gap |
| contracts-39 | Lecturas devuelven None si no existe | edge | unit | P2 | get_agent/escrow/config None | Sí | Gap |
| **contracts-40** | **AUTH: register exige require_auth del owner** | security | unit | **P0** | sin auth falla; **`mock_all_auths` NUNCA lo ejercita** | Sí | Gap |
| **contracts-41** | **AUTH: claim solo por agent_owner** | security | unit | **P0** | tercero no reclama pago ajeno | Sí | Gap |
| **contracts-42** | **AUTH: refund solo por el client** | security | unit | **P0** | solo el client reembolsa | Sí | Gap |
| **contracts-43** | **AUTH: update/deregister solo por owner** | security | unit | **P0** | no-owner falla | Sí | Gap |
| contracts-44 | Anchor: register crea PDA correcta | happy | integration | P1 | PDA `[b'agent',service]` poblada | Sí | Existe |
| contracts-45 | Anchor: update cambia precio+descripción | happy | integration | P1 | endpoint None sin cambio | Sí | Existe |
| **contracts-46** | **Anchor: open+claim split 95/5, delta treasury exacto** | happy | integration | **P0** | total_earned=neto; Completed | Sí | Existe |
| **contracts-47** | **Anchor: claim rechaza treasury falsa → InvalidTreasury** | security | integration | **P0** | nadie redirige el fee | Sí | Existe |
| **contracts-48** | Anchor: refund antes de 5 min → RefundTooEarly | error | integration | **P0** | `Err` | Sí | Existe |
| **contracts-49** | Anchor: open amount<price → AmountBelowPrice | error | integration | **P0** | `Err` | Sí | Existe |
| contracts-50 | Anchor: deregister cierra PDA y devuelve rent | happy | integration | P1 | balance owner sube | Sí | Existe |
| contracts-51 | Anchor: validaciones de register (empty/long/price) | error | integration | P1 | Anchor no prueba NINGUNA hoy | Sí | Gap |
| **contracts-52** | **Anchor: claim por firmante != owner → Unauthorized** | security | integration | **P0** | check alcanzable (signer separado) | Sí | Gap |
| **contracts-53** | **Anchor: doble claim → EscrowNotPending** | security | integration | **P0** | 2.º claim `Err` | Sí | Gap |
| **contracts-54** | **Anchor: refund feliz tras 300 s devuelve lamports** | happy | integration | **P0** | requiere bankrun/litesvm (control de reloj) | Sí | Gap |
| **contracts-55** | **Anchor: refund tras claim → EscrowNotPending** | security | integration | **P0** | `Err` | Sí | Gap |
| contracts-56 | Anchor: refund por no-client → Unauthorized | security | integration | P1 | check `escrow.client==client.key()` | Sí | Gap |
| **contracts-57** | **Anchor: update/deregister no-owner → ConstraintHasOne** | security | integration | **P0** | has_one rechaza | Sí | Gap |
| contracts-58 | Anchor: nonce duplicado → colisión init PDA | security | integration | P1 | 'account already in use' (divergencia vs Soroban) | Sí | Gap |
| contracts-59 | Anchor: fee=0 y redondeo no-redondo | edge | integration | P1 | paridad numérica con Soroban | Sí | Gap |
| contracts-60 | Anchor: open amount<=0 → AmountMustBePositive | error | integration | P1 | `Err` | Sí | Gap |
| contracts-61 | Anchor: claim falla tras deregister (DIVERGENCIA) | edge | integration | P1 | cuenta agent requerida y cerrada | Sí | Gap |
| contracts-62 | Anchor: claim con agent no ligado infla stats ajenas | security | integration | P2 | falta constraint has_one/seeds (bug integridad) | Sí | Gap |
| contracts-63 | Anchor: open sobre agente inexistente → AccountNotInitialized | error | integration | P1 | no deserializa | Sí | Gap |
| **contracts-64** | **Paridad aritmética del split (vector de montos)** | integration | unit | **P0** | fee/owner IDÉNTICOS Soroban↔Anchor para [1,19,21,199,1000,1e7,…] | Sí | Gap |
| contracts-65 | Matriz de paridad de errores/comportamiento documentada | config | manual | P1 | ADR de divergencias | No | Gap |
| contracts-66 | Paridad de constantes (500 bps, 10000, 300 s, 32/256/512) | config | unit | P2 | guard anti-deriva | Sí | Gap |
| **contracts-67** | **On-chain Soroban: smoke register→open→claim, treasury +5 %** | onchain | onchain | **P0** | treasury +500000 stroops exacto | No | Existe |
| contracts-68 | On-chain: get_config del contrato ACTIVO | onchain | onchain | P1 | XLM SAC + treasury esperados | No | Gap |
| contracts-69 | On-chain: re-initialize → AlreadyInitialized | onchain | onchain | P1 | idempotente-seguro | No | Gap |
| **contracts-70** | **On-chain: doble claim rechazado** | onchain | onchain | **P0** | `EscrowNotPending` en testnet | No | Gap |
| **contracts-71** | **On-chain: auth negativa, no-owner no reclama** | onchain | onchain | **P0** | valida require_auth REAL (2 identidades) | No | Gap |
| contracts-72 | On-chain: refund (open, esperar 300 s, refund) | onchain | onchain | P1 | espera ~5 min de pared | No | Gap |
| contracts-73 | On-chain: open con saldo insuficiente rechazado | onchain | onchain | P2 | falla transfer del SAC | No | Gap |
| **contracts-74** | **Consistencia de contract ID: scripts/docs/compose vs .env** | config | manual | **P0** | todo debe apuntar a `CDYLMRS2...` (hoy al stale) | Sí | Gap |
| contracts-75 | Consistencia Anchor declare_id/Anchor.toml/.env tras redeploy | config | manual | P1 | bloqueante para on-chain Anchor | Sí | Gap |

### 5.2 SDK (`@kiba/sdk`) — la capa que mueve el dinero

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **sdk-01** | computeFeeSplit 95/5 exacto, invariante en toda magnitud | happy | unit | **P0** | owner+fee==amount hasta 2^63 sin overflow | Sí | Parcial |
| sdk-02 | computeFeeSplit trunca el fee hacia abajo | edge | unit | P1 | nunca redondea arriba | Sí | Parcial |
| **sdk-03** | Constantes de fee del SDK == contrato | config | unit | **P0** | 500 bps / 10000 / treasury coinciden | Sí | Gap |
| **sdk-04** | encode/decodeString round-trip (vacío, UTF-8) | happy | unit | **P0** | prefijo u32 LE; cuenta bytes | Sí | Gap |
| **sdk-05** | Codecs enteros Borsh (u64 máx, i64 negativos) | happy | unit | **P0** | LE correcto; createdAt i64 no se confunde con u64 | Sí | Gap |
| **sdk-06** | encodeOption (None=0x00, Some=0x01||valor) | happy | unit | **P0** | un None mal codificado sobrescribiría el precio | Sí | Gap |
| **sdk-07** | discriminator = sha256("kind:name")[0..8] (golden) | security | unit | **P0** | rename/typo cambia el discriminador | Sí | Gap |
| **sdk-08** | decodeAgent a offsets correctos | happy | unit | **P0** | price/earned BigInt, createdAt i64, owner PublicKey | Sí | Gap |
| **sdk-09** | decodeEscrow estado 0/1/2 → Pending/Completed/Refunded | happy | unit | **P0** | el estado gobierna claim/refund/replay | Sí | Gap |
| sdk-10 | decoders fallan claro ante buffer truncado | error | unit | P2 | RangeError, no basura | Sí | Gap |
| **sdk-11** | registerAgentInstr: orden cuentas, flags, data | security | unit | **P0** | flags signer/writable correctos | Sí | Gap |
| **sdk-12** | openEscrowInstr: escrowPda de (client,owner,nonce) | security | unit | **P0** | PDA equivocado = fondos perdidos | Sí | Gap |
| **sdk-13** | claimPaymentInstr: treasury default/override writable | security | unit | **P0** | el 5 % al treasury correcto | Sí | Gap |
| sdk-14 | update/refund/deregister builders | edge | unit | P1 | Option y flags correctos | Sí | Gap |
| sdk-15 | fetchAllAgents arma memcmp con discriminador base64 | integration | unit | P2 | filtro offset 0 | Sí | Gap |
| **sdk-16** | createChainClient stellar+contrato → StellarChainClient | happy | unit | **P0** | asset XLM, baseUnits 1e7, owner G... | Sí | Gap |
| **sdk-17** | stellar SIN contrato → null (degradado) | security | unit | **P0** | sirve SIN liquidación (riesgo consciente) | Sí | Gap |
| **sdk-18** | sin CHAIN + PROGRAM_ID válido → SolanaChainClient | happy | unit | **P0** | asset SOL, 1e9 | Sí | Gap |
| **sdk-19** | sin CHAIN + PROGRAM_ID ausente/<32 → null | edge | unit | **P0** | no construye KibaProgram | Sí | Gap |
| sdk-20 | PROGRAM_ID malformado capturado → null | error | unit | P1 | no crashea | Sí | Gap |
| sdk-21 | CHAIN case-insensitive ('Stellar') | edge | unit | P1 | toLowerCase | Sí | Gap |
| **sdk-22** | Derivación keypair Stellar: STELLAR_SECRET vs seed wallet | security | unit | **P0** | mismo wallet → mismo G... estable | Sí | Gap |
| sdk-23 | Clave Stellar derivada == pubkey Solana (2 codificaciones) | security | unit | P1 | raw 32 bytes coinciden | Sí | Gap |
| sdk-24 | createChainClient lee env en construcción (footgun de orden) | config | unit | P1 | fijar orden requerido | Sí | Gap |
| sdk-25 | callWithTrace happy 4 pasos (degradado) | happy | e2e | P0 | signature='NO_ONCHAIN_PROGRAM_ID' | Sí | Existe |
| sdk-26 | timestamps de pasos monótonos | edge | unit | P1 | no decrecientes | Sí | Existe |
| sdk-27 | agente legacy 200 sin 402 → traza parcial | edge | unit | P1 | solo 'discover' | Sí | Existe |
| sdk-28 | status != 200/402 lanza con detalle | error | unit | P1 | throw con cuerpo | Sí | Existe |
| **sdk-29** | maxPrice rechaza precio ANUNCIADO > cap | security | unit | **P0** | throw antes de pagar | Sí | Existe |
| **sdk-30** | **GAP: maxPrice NO acota quote.amount del 402** | security | unit | **P0** | provider anuncia barato, cotiza caro → sobrecobro | Sí | Gap |
| **sdk-31** | X-PAYMENT lleva clientWallet == dirección nativa | security | unit | **P0** | G... en Stellar; codificación errónea = escrow-not-found | Sí | Gap |
| sdk-32 | discover() prioriza registro on-chain | integration | unit | P1 | manifest desde cadena | Sí | Gap |
| sdk-33 | discover() cae a BACKEND_URL si on-chain null | integration | unit | P1 | GET /agents/{service} | Sí | Parcial |
| sdk-34 | getQuote: 402 real y synth (legacy) | happy | unit | P1 | synth amount=floor(price*1e7) | Sí | Existe |
| sdk-35 | getQuote: rutas de error del probe | error | unit | P1 | 'expected 402, got N' | Sí | Gap |
| sdk-36 | asset XLM se propaga al paso 402_received | edge | unit | P1 | no default 'SOL' | Sí | Gap |
| sdk-37 | Quote malformada (amount/nonce) falla claro | error | unit | P1 | no abre escrow con basura | Sí | Gap |
| sdk-38 | Cliente ignora quote.expiresAt (acepta vencidas) | security | unit | P1 | demostrar y motivar validación | Sí | Gap |
| sdk-39 | timeoutMs se propaga a axios | ux | unit | P2 | default 30000 | Sí | Gap |
| **sdk-40** | AgentProvider /manifest, /health, 402 floor | happy | integration | **P0** | dynamicPricing=true | Sí | Existe |
| sdk-41 | priceFn > floor respetado; X-PAYMENT inválido 400; sin handler 500 | edge | integration | P1 | — | Sí | Existe |
| sdk-42 | Provider degradado acepta sin verificar (breadcrumb) | integration | integration | P1 | mode='degraded-no-onchain-verification' | Sí | Existe |
| **sdk-43** | Provider: escrow inexistente → 402 'not found' | security | integration | **P0** | handler NO corre | Sí | Gap |
| **sdk-44** | Provider: escrow Completed/Refunded → 402 (anti-replay) | security | integration | **P0** | no re-reclama | Sí | Gap |
| **sdk-45** | Provider: monto < precio → 402 (anti-underpayment) | security | integration | **P0** | handler no corre | Sí | Gap |
| **sdk-46** | Provider: ruta feliz → handler → claim → _payment.claimed | happy | integration | **P0** | núcleo del cobro | Sí | Gap |
| sdk-47 | Provider: handler lanza → 500 y NO reclama | error | integration | P1 | no cobrar trabajo fallido | Sí | Gap |
| **sdk-48** | **Provider: claim falla DESPUÉS del handler → servicio sin cobro** | error | integration | **P0** | ventana de pérdida (orden serve→claim) | Sí | Gap |
| **sdk-49** | priceFn no determinista rompe el pago | security | integration | **P0** | mayor→DoS; menor→underpayment | Sí | Gap |
| sdk-50 | computeAmountBaseUnits floor robusto ante priceFn inválido | edge | unit | P1 | NaN/Inf/neg → floor | Sí | Gap |
| sdk-51 | computeAmountBaseUnits: priceFn que lanza → floor | error | unit | P1 | no rompe el 402 | Sí | Gap |
| sdk-52 | generateNonce positivo, en u64, distinto entre llamadas | edge | unit | P1 | clave del escrow PDA/replay | Sí | Gap |
| sdk-53 | /manifest reporta ownerWallet base58 con CHAIN=stellar | security | integration | P1 | payTo legacy equivocado en Stellar | Sí | Gap |
| sdk-54 | X-PAYMENT base64 válido sin campos → 500 sin crash | edge | integration | P2 | BigInt(undefined) lanza | Sí | Gap |
| sdk-55 | SolanaChainClient.fetchAgent → ChainAgentInfo | integration | unit | P1 | BigInt/base58/createdAt | Sí | Gap |
| sdk-56 | SolanaChainClient.ensureFunds (skip/airdrop/error) | integration | unit | P1 | traga error de airdrop | Sí | Gap |
| **sdk-57** | **Liquidación Solana E2E register→open→claim 95/5** | onchain | onchain | **P0** | **BLOQUEADO: Anchor no redesplegado** | No | Gap |
| **sdk-58** | parseEscrowState normaliza string/{tag}/[Symbol] | security | unit | **P0** | función privada: exportar para test | Sí | Gap |
| sdk-59 | Conversores ScVal (optI128/optStr → void en null) | edge | unit | P1 | mapea Option del contrato | Sí | Gap |
| **sdk-60** | Smoke on-chain Stellar register→open(Pending)→claim(Completed) | onchain | onchain | **P0** | corregir CONTRACT_ID viejo | Sí | Existe |
| **sdk-61** | E2E on-chain marketplace x402 sobre Stellar | onchain | onchain | **P0** | claimedAmount = 95 %; ver FLUJO-E2E-1 | Sí | Existe |
| sdk-62 | Stellar fetchAgent/Escrow inexistente → null, discover a backend | integration | onchain | P1 | None ≠ fallo de simulación | Sí | Gap |
| sdk-63 | Stellar ensureFunds: ramas de friendbot | integration | onchain | P1 | warn sin lanzar | Sí | Gap |
| sdk-64 | Stellar getBalanceBaseUnits (Horizon, precisión float) | integration | onchain | P1 | parseFloat*1e7 → BigInt | Sí | Gap |
| sdk-65 | Stellar invoke()/read(): rutas de error | error | onchain | P1 | ERROR/NOT_FOUND/simulación falló | Sí | Gap |
| **sdk-66** | Scripts smoke/e2e con CONTRACT_ID desactualizado | config | manual | **P0** | default `CA5M…` ≠ `CDYLMRS2…` | Sí | Gap |
| **sdk-67** | keypair-store: archivo corrupto → lanza, NO regenera | security | unit | **P0** | fail-closed; preserva identidad/fondos | Sí | Gap |
| sdk-68 | loadKeypairFromEnvOrFile: env malformado → lanza | error | unit | P1 | no cae en silencio al archivo | Sí | Gap |
| sdk-69 | keypair-store: casos felices | happy | unit | P1 | 64 bytes, idempotente, mode 600 | Sí | Existe |
| sdk-70 | Barrel público (index.ts) exporta todo | integration | unit | P2 | import smoke | Sí | Gap |
| sdk-71 | tsc compila el SDK sin errores | config | unit | P2 | sin regresiones de tipo | Sí | Gap |

### 5.3 Backend (`@kiba/backend`) — API discovery + indexer

`index.ts` (HTTP/WS), `indexer.ts` y `registry.ts` **no tienen NINGÚN test**. Solo `db.ts`, `search.ts` y `cosineSim` están cubiertos. Riesgos P0: pérdida de catálogo por fallo RPC, serialización de precios, reconciliación del indexer.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| backend-01 | GET /health forma completa | happy | integration | P1 | chain/asset/registry/indexedAgents/embeddings | Sí | Gap |
| backend-02 | /health refleja CHAIN/asset/registry | config | integration | P1 | stellar→XLM; sin reader→demo/fallback | Sí | Gap |
| backend-03 | indexedAgents tope 1000, full-scan por llamada | perf | unit | P2 | debería usar countAgents() | Sí | Gap |
| backend-04 | stellar sin contrato → demo inconsistente | config | integration | P2 | chain=stellar pero asset=SOL | Sí | Gap |
| **backend-05** | GET /agents (sin q) ordenado por reputación | happy | integration | **P0** | total_calls DESC, created_at ASC | Sí | Gap |
| **backend-06** | Serialización manifest: unidades base→decimal | happy | integration | **P0** | /1e7 stroops; acceptedToken=ASSET | Sí | Gap |
| backend-07 | Límite default 20 y ?limit=N | edge | integration | P1 | respeta límite | Sí | Gap |
| backend-08 | ?limit=-5 sin-q → LIMIT negativo = ilimitado | edge | integration | P2 | bug a corregir | Sí | Gap |
| backend-09 | ?limit=abc → NaN → posible 500 | error | integration | P1 | debe degradar a default | Sí | Gap |
| **backend-10** | Registro vacío (0 agentes) → [] | edge | integration | **P0** | estado REAL actual | Sí | Gap |
| **backend-11** | ?q&mode=keyword → forma envuelta con scores | happy | integration | **P0** | {query,mode,count,results} | Sí | Gap |
| backend-12 | mode=semantic con modelo listo | happy | integration | P1 | hits por cosine reescalado | Sí | Gap |
| backend-13 | mode=hybrid (default) fusiona kw+sem | happy | integration | P1 | peso 0.6/0.4 | Sí | Gap |
| **backend-14** | mode inválido con q → 400 | error | integration | **P0** | validación de input | Sí | Gap |
| backend-15 | tokens <3 chars → 0 resultados sin throw | edge | integration | P1 | sanitizeFtsQuery | Sí | Gap |
| backend-16 | Inyección FTS sanitizada | security | integration | P1 | sin throw ni inyección | Sí | Gap |
| backend-17 | Diacríticos/español matchean | edge | integration | P1 | remove_diacritics=2 | Sí | Gap |
| backend-18 | ?q solo espacios → forma envuelta (quirk) | edge | integration | P2 | documentar | Sí | Gap |
| backend-19 | Cold-start hybrid/semantic bloquea hasta cargar modelo | perf | integration | P1 | 10-30 s sin timeout | Sí | Gap |
| backend-20 | search() lanza → /agents 500 controlado | error | integration | P1 | sin filtrar stack | Sí | Gap |
| backend-21 | GET /agents/:service existente → 200 | happy | integration | P1 | toManifest | Sí | Gap |
| backend-22 | GET /agents/:service inexistente/borrado → 404 | error | integration | P1 | incluye deleted=1 | Sí | Gap |
| **backend-23** | SEMANTIC_SEARCH=false → degrada a keyword | config | integration | **P0** | hybrid→keyword puro | Sí | Gap |
| backend-24 | Fallo de carga del modelo → disabled | error | unit | P1 | no crashea | Sí | Gap |
| backend-25 | embed() dims 384, norma L2≈1, null si disabled | integration | integration | P1 | — | Sí | Gap |
| backend-26 | Embedding corrupto rompe TODA búsqueda semantic/hybrid | error | unit | P1 | falta try/catch por candidato → 500 | Sí | Gap |
| backend-27 | normalize() casos límite | edge | unit | P1 | []→[], rango→[0,1] | Sí | Gap |
| backend-28 | searchHybrid con kw Y sem → fusión ponderada | happy | unit | P1 | matchType 'hybrid' | Sí | Gap |
| backend-29 | searchHybrid kw vacío pero sem presente → sem puro | edge | unit | P1 | matchType semantic | Sí | Gap |
| **backend-30** | upsertAgent insert/update/resucita (ON CONFLICT) | happy | unit | **P0** | define precios/catálogo | Sí | Existe |
| backend-31 | Triggers FTS sincronizan en UPDATE de description | edge | unit | P1 | término viejo deja de matchear | Sí | Gap |
| backend-32 | listAgents offset y gap de paginación HTTP | edge | unit | P1 | HTTP no expone offset | Sí | Gap |
| **backend-33** | Persistencia SQLite: escribir, reabrir, conservar | integration | integration | **P0** | WAL; bootstrap reconcilia | Sí | Gap |
| **backend-34** | Bootstrap demo (reader null) siembra 5 FALLBACK | integration | integration | **P0** | + embedAgent best-effort | Sí | Gap |
| **backend-35** | Bootstrap con reader: upsert + soft-delete + eventos | integration | integration | **P0** | marca deleted los ausentes | Sí | Gap |
| **backend-36** | **Fallo transitorio RPC → []=BORRA todo el catálogo** | error | integration | **P0** | bug crítico de disponibilidad/dinero | Sí | Gap |
| backend-37 | reader.listAgents THROWS → catch, sin borrados (asimetría) | error | integration | P1 | Solana seguro; Stellar borra | Sí | Gap |
| backend-38 | Bootstrap solapado sin mutex (carrera) | integration | integration | P1 | no perder updates ni doble-borrar | Sí | Gap |
| backend-39 | subscribeToChain: Solana onLogs; Stellar no-op | integration | integration | P1 | Stellar sin push live (5 min) | Sí | Gap |
| backend-40 | startHeartbeat cada 5 min; idempotente; stop limpia | integration | integration | P1 | fake timers | Sí | Gap |
| backend-41 | on/emit: unsubscribe y aislamiento de listener que lanza | integration | unit | P1 | emit con try/catch | Sí | Gap |
| backend-42 | embedAgent best-effort: embed lanza, upsert ocurre | integration | integration | P1 | fire-and-forget | Sí | Gap |
| backend-43 | createRegistryReader stellar+contrato → StellarRegistryReader | config | unit | P1 | 1e7/XLM/services | Sí | Gap |
| backend-44 | createRegistryReader stellar sin contrato → null | config | unit | P1 | siembra FALLBACK | Sí | Gap |
| backend-45 | createRegistryReader Solana válido/inválido/ausente | config | unit | P1 | catch → null | Sí | Gap |
| **backend-46** | StellarRegistryReader mapea ChainAgentInfo → AgentRecord | onchain | integration | **P0** | price stroops, source='chain' | Sí | Gap |
| backend-47 | get_agent por-servicio que lanza → warn+continue | error | integration | P1 | RAÍZ de backend-36 | Sí | Gap |
| backend-48 | Lectura live contra el contrato desplegado | onchain | onchain | P1 | 5 servicios → null → [] | No | Gap |
| backend-49 | E2E registrar on-chain y verificar que el indexer lo capta | onchain | onchain | P1 | requiere keypair FONDEADO | No | Gap |
| backend-50 | Precio bigint > 2^53 → pérdida de precisión | edge | unit | P2 | Number(bigint) | Sí | Gap |
| backend-51 | SolanaRegistryReader mapea fetchAllAgents + filtra logs | integration | unit | P1 | regex de eventos | Sí | Gap |
| backend-52 | WS /ws: snapshot inicial al conectar | integration | integration | P1 | {type:snapshot, agents:[≤100]} | Sí | Gap |
| backend-53 | WS /ws: eventos del indexer se difunden | integration | integration | P1 | snapshot/agent_removed/program_event | Sí | Gap |
| backend-54 | WS broadcast omite no-OPEN; limpia en close | edge | integration | P2 | ws.on('error') no manejado | Sí | Gap |
| backend-55 | WS sin auth ni rate limit | security | integration | P2 | superficie DoS | Sí | Gap |
| backend-56 | Drift STELLAR_CONTRACT_ID compose vs .env | config | integration | P1 | indexa contrato equivocado/vacío | Sí | Gap |
| backend-57 | Agentes Stellar calls/earned=0 → ranking degenera | ux | integration | P1 | ORDER BY total_calls no-op | Sí | Gap |
| backend-58 | index.ts auto-arranca, no exporta app → no testeable | config | unit | P1 | refactor bloqueante para 01-22/52-55 | Sí | Gap |
| backend-59 | Sin rate limit/tope de q; CORS abierto | security | integration | P2 | documentar/limitar | Sí | Gap |
| backend-60 | better-sqlite3 nativo + alineación Buffer→Float32Array | integration | integration | P2 | byteOffset múltiplo de 4 | Sí | Gap |

### 5.4 Demo-agents (5 servicios x402, puertos 5001-5005)

Wrappers delgados sobre el `AgentProvider` del SDK. La cobertura real del runtime vive en el SDK (modo degradado). **Cero tests propios.** Gaps mayores: modo cadena, registro/escrow/claim/idempotencia/underpayment, y handlers de negocio.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **demo-agents-01** | POST /service sin pago → 402 body x402 completo | happy | integration | **P0** | amount/payTo/asset/service/nonce/expiresAt | Sí | Parcial |
| demo-agents-02 | 402 incluye WWW-Authenticate (ACTUALMENTE FALTA) | error | integration | P1 | fix de 1 línea en provider.ts (E2E F-7) | Sí | Gap |
| **demo-agents-03** | Servicio corre SOLO tras pago verificado on-chain | security | onchain | **P0** | ver FLUJO-E2E-1 | No | Gap |
| **demo-agents-04** | Registro on-chain al arrancar (bootstrap) en Stellar | onchain | onchain | **P0** | indexedAgents 0→5; causa raíz probable | No | Gap |
| **demo-agents-05** | Idempotencia/anti-replay: reintentar X-PAYMENT tras claim | security | onchain | **P0** | escrow != Pending → 402; sin doble servicio | No | Gap |
| **demo-agents-06** | Rechazo de underpayment | security | onchain | **P0** | escrow < precio → 402 | No | Gap |
| **demo-agents-07** | **Modo degradado sirve GRATIS sin verificación** | security | integration | **P0** | guard de arranque que falle si falta contrato | Sí | Gap |
| **demo-agents-08** | Claim tras servir → split 95/5 on-chain | onchain | onchain | **P0** | _payment.claimed con signature | No | Gap |
| demo-agents-09 | Pricing dinámico por servicio cotiza según payload | happy | integration | P1 | un caso por agente | Sí | Gap |
| demo-agents-10 | Determinismo quote↔verify | integration | onchain | P1 | mismo payload = mismo monto | No | Gap |
| demo-agents-11 | Endpoint registrado == URL alcanzable (drift) | onchain | onchain | P1 | PUBLIC_ENDPOINT vs default docker | No | Gap |
| demo-agents-12 | Reconciliación de config drift (update_agent) | onchain | onchain | P1 | si price difiere, update | No | Gap |
| demo-agents-13 | bootstrap fallido NO degrada el pago (log engañoso) | error | onchain | P1 | agente zombi: 402 OK pero pago falla | No | Gap |
| demo-agents-14 | Mismatch SOL vs XLM en pricingNote/description | ux | integration | P1 | textos mienten sobre el activo | Sí | Gap |
| demo-agents-15 | X-PAYMENT mal formado → 400 | error | integration | P1 | replicar por agente | Sí | Parcial |
| demo-agents-16 | Salud y manifest de cada puerto 5001-5005 | integration | integration | P1 | mapeo puerto↔service; falta healthcheck | Sí | Gap |
| demo-agents-17 | yield-hunter: ordena por APY, filtra por token | happy | integration | P2 | token sin match → crash (bug latente) | Sí | Gap |
| demo-agents-18 | risk-auditor: batch y rating por protocolo | happy | integration | P2 | count == precio | Sí | Gap |
| demo-agents-19 | translator-pro: diccionario, fallback, confidence | happy | integration | P2 | pricing por longitud | Sí | Gap |
| demo-agents-20 | price-oracle: batch, jitter, fuentes | happy | integration | P2 | jitter solo en respuesta | Sí | Gap |
| demo-agents-21 | code-reviewer: heurísticas, líneas, summary | happy | integration | P2 | regex /any/ falsos positivos | Sí | Gap |
| demo-agents-22 | Payloads inválidos/edge en POST /service | edge | integration | P2 | límite 100kb acota precio | Sí | Gap |
| demo-agents-23 | priceFn lanza/NaN/Infinity → floor | edge | unit | P2 | nunca cotiza inválido | Sí | Gap |
| demo-agents-24 | Overpayment: escrow mayor → se reclama el total | edge | onchain | P2 | sin reembolso del excedente | No | Gap |
| demo-agents-25 | expiresAt NO aplicado por el agente | edge | onchain | P2 | solo timeout on-chain | No | Gap |
| demo-agents-26 | Claim falla tras handler → trabajo no pagado | error | onchain | P1 | orden serve→claim (ver sdk-48) | No | Gap |
| demo-agents-27 | Persistencia de keypair entre reinicios (volumen) | config | integration | P2 | AGENT_WALLET_SECRET en efímero | Sí | Gap |
| demo-agents-28 | Selección de agente por AGENT_NAME en Dockerfile | config | manual | P2 | corre tsx watch en prod | Sí | Gap |
| demo-agents-29 | Friendbot: sin fondear o rate-limit en ensureFunds | onchain | onchain | P2 | degrada sin registrar | No | Gap |
| demo-agents-30 | Concurrencia: llamadas pagadas simultáneas | perf | onchain | P2 | mismo nonce → una gana | No | Gap |

### 5.5 MCP server (`kiba-mcp`) — adaptador stdio para IDE

4 tools (`list_agents`, `call_agent`, `get_balance`, `get_transactions`) que proxean al gateway. Auth headless (`KIBA_API_KEY`) u OAuth 2.0 + PKCE. Cobertura unit sólida pero **basada en mocks** (re-implementa `loadToken`/PKCE inline). Money path sin E2E.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| mcp-server-01 | tools/list devuelve exactamente las 4 tools | happy | unit | P1 | length 4 | Sí | Existe |
| mcp-server-02 | Nombre del server 'kiba' y versión consistente | config | unit | P1 | ctor 0.1.0 vs package 0.1.1 (rebrand) | Sí | Gap |
| mcp-server-03 | Cada tool con inputSchema válido | happy | unit | P1 | required/optional correctos | Sí | Parcial |
| mcp-server-04 | Descripciones precisas y accionables | ux | unit | P2 | guían selección del LLM | Sí | Gap |
| mcp-server-05 | list_agents (no query) → GET /v1/agents | happy | unit | P1 | JSON text | Sí | Existe |
| mcp-server-06 | list_agents con query → ?q=urlencoded | happy | unit | P1 | encodeURIComponent | Sí | Existe |
| mcp-server-07 | list_agents UTF-8 percent-encoded | edge | unit | P2 | traducción→%C3%B3 | Sí | Existe |
| mcp-server-08 | list_agents whitespace → sin filtro | edge | unit | P2 | GET /v1/agents | Sí | Existe |
| mcp-server-09 | list_agents query no-string no crashea | edge | unit | P2 | typeof guard | Sí | Gap |
| mcp-server-10 | get_balance → GET /v1/balance | happy | unit | P1 | — | Sí | Existe |
| mcp-server-11 | get_transactions → GET /v1/transactions | happy | unit | P1 | — | Sí | Existe |
| **mcp-server-12** | call_agent → POST /v1/call {service,payload} (money) | happy | unit | **P0** | gasta el balance; sin drift | Sí | Existe |
| mcp-server-13 | call_agent payload omitido → {} | edge | unit | P1 | — | Sí | Existe |
| **mcp-server-14** | call_agent sin service → isError, CERO requests | error | unit | **P0** | sin intento de cobro | Sí | Parcial |
| mcp-server-15 | Tool desconocida → isError | error | unit | P1 | — | Sí | Existe |
| **mcp-server-16** | Error del gateway → isError (call_agent también) | error | unit | **P0** | pago fallido debe reportarse | Sí | Parcial |
| **mcp-server-17** | **Authorization: Bearer en TODA tool, incl. POST** | security | unit | **P0** | hoy solo se asserta en list_agents | Sí | Gap |
| mcp-server-18 | Envelope {content:[{text}]} JSON válido | happy | unit | P2 | todas las tools | Sí | Parcial |
| mcp-server-19 | tools/call sin arguments object | edge | unit | P2 | args ?? {} | Sí | Gap |
| mcp-server-20 | token.json round-trip | happy | unit | P1 | — | Sí | Existe |
| mcp-server-21 | Token expirado ignorado, fuerza re-auth | edge | unit | P1 | exercise REAL loadToken | Sí | Parcial |
| mcp-server-22 | token malformado → null sin throw | error | unit | P1 | mismo gap de función real | Sí | Parcial |
| mcp-server-23 | Sin token ni API key → authorize() | edge | unit | P1 | mock open+loopback | Sí | Gap |
| mcp-server-24 | saveToken mode 0600 | security | unit | P1 | bearer gastable 30 días | Sí | Gap |
| mcp-server-25 | saveToken expires_at = now+expires_in, crea dir | edge | unit | P2 | — | Sí | Parcial |
| mcp-server-26 | expires_at == now válido (estricto <) | edge | unit | P2 | sin tolerancia de skew | Sí | Gap |
| **mcp-server-27** | PKCE == fórmula del gateway (vector RFC 7636) | security | unit | **P0** | mismatch rompe OAuth | Sí | Existe |
| mcp-server-28 | PKCE base64url y verifiers únicos | security | unit | P2 | — | Sí | Existe |
| **mcp-server-29** | KIBA_API_KEY → OAuth skipped, sin browser | happy | integration | **P0** | única ruta para CI/servers | Sí | Existe |
| mcp-server-30 | Con API key, token.json nunca se lee | edge | integration | P1 | short-circuit | Sí | Existe |
| mcp-server-31 | Sin API key + token válido → reusa, sin browser | happy | integration | P1 | assert no authorize() | Sí | Parcial |
| mcp-server-32 | API key precede a token válido | edge | integration | P2 | — | Sí | Gap |
| **mcp-server-33** | PKCE handshake completo contra stub guarda token | integration | integration | **P0** | onboarding principal IDE | Sí | Gap |
| mcp-server-34 | Browser se abre a la URL correcta | integration | integration | P1 | code_challenge, redirect localhost | Sí | Gap |
| mcp-server-35 | Callback sin ?code → 400, sigue esperando | error | integration | P2 | — | Sí | Gap |
| mcp-server-36 | /oauth/token error → tool error, sin token malformado | error | integration | P1 | invalid_code_verifier | Sí | Gap |
| mcp-server-37 | Authorization timeout limpio | error | integration | P2 | inyectar timeout corto | Sí | Gap |
| mcp-server-38 | redirect_uri solo loopback | security | integration | P1 | code no sale de la máquina | Sí | Gap |
| mcp-server-39 | /oauth/token malformado no persiste NaN | error | integration | P2 | — | Sí | Gap |
| mcp-server-40 | Token rechazado server-side (401) sin auto re-auth | error | integration | P1 | usuario atascado; decidir/documentar | Sí | Gap |
| mcp-server-41 | Gateway inalcanzable → error limpio | error | integration | P1 | ECONNREFUSED | Sí | Gap |
| mcp-server-42 | **Gateway colgado no cuelga la tool (sin timeout)** | error | integration | P1 | hoy cuelga para siempre (money path) | Sí | Gap |
| mcp-server-43 | AbortSignal cancela la tool in-flight | edge | integration | P2 | hoy no se cablea a axios | Sí | Gap |
| mcp-server-44 | Body 5xx HTML → mensaje limpio | error | integration | P2 | sin crash de parse | Sí | Gap |
| **mcp-server-45** | call_agent happy E2E debita exactamente una vez | happy | e2e | **P0** | ver FLUJO-E2E-1 | Sí | Gap |
| **mcp-server-46** | call_agent saldo insuficiente: sin cobro | error | e2e | **P0** | balance intacto, sin tx | Sí | Gap |
| mcp-server-47 | call_agent a servicio desconocido sin cobro | error | e2e | P1 | debit refunded | Sí | Gap |
| mcp-server-48 | get_balance/transactions reflejan call real | integration | e2e | P1 | requiere stack+fondos | Sí | Gap |
| mcp-server-49 | call_agent trae firma on-chain verificable | onchain | onchain | P1 | Horizon | Sí | Gap |
| mcp-server-50 | npx kiba-mcp boota y conecta por stdio | integration | integration | P1 | shebang, bin, ESM | Sí | Gap |
| mcp-server-51 | initialize + tools/list real por stdio | integration | integration | P1 | SDK Client/Inspector | Sí | Gap |
| mcp-server-52 | tsc build emite dist/index.js runnable | config | integration | P2 | — | Sí | Gap |
| mcp-server-53 | KIBA_URL override retarget real | config | integration | P2 | hoy solo assert.ok(true) | Sí | Gap |
| mcp-server-54 | Secretos nunca en logs | security | integration | P1 | grep token/sk_live | Sí | Gap |
| mcp-server-55 | Onboarding OAuth real en IDE | ux | manual | P1 | humano hace clic | No | Gap |

### 5.6 Orchestrator (`@kiba/orchestrator-agent`) — consumer LLM

Planifica (Anthropic tool-calling con fallback keyword), ejecuta en paralelo y paga vía el SDK. **Cero tests propios.** Hallazgos críticos: compose sin `CHAIN`/`STELLAR_*`, `/intent` sin auth/CORS, cap mal denominado, sin reintentos, sin límite de concurrencia.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **orchestrator-01** | GET /health OK sin clave LLM ni cadena | happy | integration | **P0** | no toca planner ni chain | Sí | Gap |
| orchestrator-02 | /health expone wallet/backend/programId | happy | integration | P2 | — | Sí | Gap |
| orchestrator-03 | POST /intent feliz modo keyword | happy | integration | P1 | plan+results+traza | Sí | Gap |
| orchestrator-04 | /intent intent ausente/vacío → 400 | error | unit | P1 | — | Sí | Gap |
| orchestrator-05 | /intent intent no-string → 400 | error | unit | P1 | typeof guard | Sí | Gap |
| orchestrator-06 | /intent body JSON malformado | error | integration | P2 | falta error-handler | Sí | Gap |
| orchestrator-07 | /intent intent gigante (1MB) | edge | integration | P2 | falta límite de longitud | Sí | Gap |
| orchestrator-08 | Sin match keyword y sin LLM → 500 (debería 4xx) | error | integration | P1 | throw no capturado | Sí | Gap |
| orchestrator-09 | /intent filtra err.message | security | integration | P2 | sanitizar | Sí | Gap |
| **orchestrator-10** | **/intent SIN auth permite gastar la wallet** | security | integration | **P0** | drena fondos + quema LLM | Sí | Gap |
| orchestrator-11 | CORS totalmente abierto en /intent | security | integration | P1 | web maliciosa contra localhost | Sí | Gap |
| orchestrator-12 | /intent duplicado → doble pago (sin idempotencia) | onchain | onchain | P1 | nonce fresco por probe | No | Gap |
| orchestrator-13 | Fallo de bootstrap no tumba el server | config | integration | P1 | try/catch | Sí | Gap |
| orchestrator-14 | listen tras await bootstrap (riesgo cuelgue) | config | integration | P2 | sin timeout propio | Sí | Gap |
| orchestrator-15 | Persistencia de wallet entre reinicios | config | integration | P1 | misma pubkey | Sí | Parcial |
| orchestrator-16 | Keyword: yield/APY → yield-hunter | happy | unit | P1 | — | Sí | Gap |
| orchestrator-17 | Keyword: risk/audit → risk-auditor | happy | unit | P1 | — | Sí | Gap |
| orchestrator-18 | Keyword: yield Y risk → dos tareas | happy | unit | P2 | — | Sí | Gap |
| orchestrator-19 | Keyword: sin match lanza error claro | error | unit | P1 | mensaje accionable | Sí | Gap |
| orchestrator-20 | Keyword: regex con acentos/español | edge | unit | P2 | interés/interes | Sí | Gap |
| orchestrator-21 | LLM: intent→tool_use→tareas (feliz) | happy | integration | P1 | **requiere clave real** o mock SDK | No | Gap |
| orchestrator-22 | LLM: /agents vacío → fallback keyword (estado LIVE) | edge | integration | P1 | indexedAgents=0 | Sí | Gap |
| orchestrator-23 | LLM: /agents inalcanzable → fallback | error | integration | P1 | — | Sí | Gap |
| orchestrator-24 | LLM: respuesta sin tool_use → fallback | edge | integration | P1 | — | Sí | Gap |
| orchestrator-25 | LLM: tool desconocida → descarta | edge | integration | P2 | — | Sí | Gap |
| orchestrator-26 | LLM: saneo nombre servicio (- → _) ida y vuelta | edge | unit | P2 | colisión a-b/a_b | Sí | Gap |
| orchestrator-27 | Clave placeholder/inválida → 401 → fallback | error | integration | P1 | sin romper | Sí | Gap |
| orchestrator-28 | LLM: nombre viola constraint Anthropic → 400 → fallback | edge | integration | P2 | sanear nombres | No | Gap |
| orchestrator-29 | LLM: truncamiento por max_tokens=1024 | edge | integration | P2 | no chequea stop_reason | No | Gap |
| orchestrator-30 | LLM: payload del modelo sin validar al agente | security | integration | P2 | esquematizar | No | Gap |
| orchestrator-31 | model 'claude-sonnet-4-6' válido pero hardcodeado | config | manual | P2 | mover a env | No | Gap |
| orchestrator-32 | Prompt injection fuerza fan-out caro | security | integration | P1 | sin presupuesto total | No | Gap |
| orchestrator-33 | Fallback keyword referencia services no registrados | edge | integration | P1 | discover 404 → todo falla | Sí | Gap |
| orchestrator-34 | Executor ejecuta en paralelo (Promise.all) | happy | unit | P1 | — | Sí | Gap |
| **orchestrator-35** | Executor: fallo parcial no aborta el lote | happy | unit | **P0** | resultados mixtos, 200 | Sí | Gap |
| orchestrator-36 | Executor aplica maxPrice y timeout por llamada | happy | unit | P1 | {maxPrice:0.5, timeoutMs:30000} | Sí | Parcial |
| **orchestrator-37** | Executor: error → TaskResult success:false | error | unit | **P0** | sin propagar | Sí | Gap |
| **orchestrator-38** | **Cap maxPrice: denominación equivocada, valida floor no quote** | onchain | integration | **P0** | pricing dinámico bypassa el cap | Sí | Gap |
| orchestrator-39 | Sin límite concurrencia: colisión de sequence (Stellar) | onchain | onchain | P1 | tx_bad_seq | No | Gap |
| orchestrator-40 | Ausencia total de reintentos | error | unit | P1 | GAP: consigna pide reintentos | Sí | Gap |
| **orchestrator-41** | **CONFIG: compose sin CHAIN/STELLAR_* → pagos fallan** | config | integration | **P0** | degradado → todo success:false | Sí | Gap |
| **orchestrator-42** | CONFIG Stellar correcta: bootstrap fondea, abre escrow | onchain | onchain | **P0** | friendbot fondea G... | No | Gap |
| orchestrator-43 | ANTHROPIC_API_KEY placeholder/vacía define el modo | config | integration | P1 | vacío → siempre keyword | Sí | Gap |
| **orchestrator-44** | E2E on-chain: orchestrator paga, split 95/5 | onchain | e2e | **P0** | ver FLUJO-E2E-1 | No | Gap |
| orchestrator-45 | Timeouts: 30s por tarea pero sin global de /intent | perf | integration | P2 | Promise.all espera indefinido | Sí | Gap |

### 5.7 Frontend — Landing (`@kiba/landing`, Astro SSG)

Sitio estático con 3 islas React; la lógica viva está en `AgentsCatalog.tsx` (fetch a `/agents`). **Cero cobertura, sin runner.** P0s estrechos: build/deploy, sin fuga de secretos, CTA del instalador.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **frontend-landing-01** | astro build produce dist estático y sirve index.html | config | integration | **P0** | exit 0, 200 en / | Sí | Gap |
| frontend-landing-02 | astro check pasa (tipos) | config | integration | P1 | 0 errores | Sí | Gap |
| **frontend-landing-03** | Bundle sin secretos, solo PUBLIC_* | security | integration | **P0** | grep sk-ant/PRIVATE KEY = 0 | Sí | Gap |
| frontend-landing-04 | PUBLIC_BACKEND_URL baked en window.__BACKEND_URL__ | config | integration | P1 | fallback rodion.com.co | Sí | Gap |
| frontend-landing-05 | PUBLIC_DASHBOARD_URL en cada CTA | config | integration | P1 | sin localhost en prod | Sí | Gap |
| frontend-landing-06 | PUBLIC_* documentados en env+compose+Dockerfile | config | manual | P1 | solo NEXT_PUBLIC_ documentado | Sí | Gap |
| frontend-landing-07 | PUBLIC_GATEWAY_URL declarado pero no usado | config | manual | P2 | dead config | No | Gap |
| **frontend-landing-08** | CTA Hero instalador .exe resuelve (no 404) | integration | integration | **P0** | URL hardcodea tag v0.1.0 | Sí | Gap |
| frontend-landing-09 | Links dashboard cargan signup/login | integration | e2e | P1 | 200, no SPA 404 | Sí | Gap |
| frontend-landing-10 | Links GitHub (CoKeFish/kiba) resuelven | integration | integration | P1 | HEAD 200 | Sí | Gap |
| frontend-landing-11 | Footer Solana explorer apunta al programa real | onchain | onchain | P1 | stale (Solana no redesplegado) | No | Gap |
| frontend-landing-12 | Catálogo mount GET /agents → Agent[] | integration | integration | P1 | renderiza cards | Sí | Gap |
| frontend-landing-13 | Search query → SearchResponse + badges | integration | integration | P1 | matchType, score% | Sí | Gap |
| frontend-landing-14 | Mode toggle keyword/semantic/hybrid; inválido manejado | integration | integration | P1 | 400 swallowed | Sí | Gap |
| frontend-landing-15 | Debounce 300ms search / 100ms clear | ux | unit | P1 | un request final | Sí | Gap |
| frontend-landing-16 | Backend DOWN → FALLBACK, sin crash | error | integration | P1 | 2 agentes fallback | Sí | Gap |
| **frontend-landing-17** | Backend UP, 0 agentes → copy roto "No results for ''" | ux | integration | P1 | estado LIVE actual; bug | Sí | Gap |
| frontend-landing-18 | Respuestas fuera de orden (sin AbortController) | edge | integration | P1 | resultados stale | Sí | Gap |
| frontend-landing-19 | SOL default mislabel XLM en cadena activa | edge | unit | P1 | priceToUsd default SOL | Sí | Gap |
| frontend-landing-20 | serviceToName y colisión de keys | edge | unit | P2 | React key warning | Sí | Gap |
| frontend-landing-21 | Campos de agente (atacante) escapados | security | integration | P1 | XSS inerte, layout acotado | Sí | Gap |
| frontend-landing-22 | Payloads malformados no crashean el catálogo | edge | integration | P2 | Array.isArray guards | Sí | Gap |
| frontend-landing-23 | Chips de sugerencia solo sin query | ux | unit | P2 | click dispara search | Sí | Gap |
| frontend-landing-24 | Nav anchors #discover/#scale/#trust MUERTOS | ux | integration | P1 | 3 de 5 no resuelven | Sí | Gap |
| frontend-landing-25 | Branding: cero 'Agent Bazaar', kiba presente | ux | integration | P1 | guard de CI | Sí | Gap |
| frontend-landing-26 | Social/SEO: og:image/twitter:image faltan | ux | integration | P1 | share roto | Sí | Gap |
| frontend-landing-27 | lang=en con title/description en español | ux | integration | P2 | reconciliar | Sí | Gap |
| frontend-landing-28 | Copy Solana-céntrico con CHAIN=stellar activo | ux | manual | P2 | decisión de producto | No | Gap |
| frontend-landing-29 | Deps/assets muertos (shiki, hero.png) | perf | integration | P2 | grep | Sí | Gap |
| frontend-landing-30 | Mobile: header fijo y CodeTabs overflow | ux | e2e | P1 | sin hamburger | Sí | Gap |
| frontend-landing-31 | Grids responsive sin scroll horizontal | ux | e2e | P2 | 360/768/1024/1280 | Sí | Gap |
| frontend-landing-32 | A11y de controles e imágenes | ux | e2e | P2 | axe sin críticos | Sí | Gap |
| frontend-landing-33 | prefers-reduced-motion honrado | perf | manual | P2 | dos rAF canvas | Sí | Gap |
| frontend-landing-34 | Lighthouse perf/SEO budget | perf | e2e | P2 | perf>=85, SEO>=90 | Sí | Gap |
| frontend-landing-35 | Demo island: autoplay/pausa/stepper | ux | e2e | P2 | index alineado | Sí | Gap |
| frontend-landing-36 | CodeTabs island: hydration y snippet por tab | ux | integration | P2 | sin 'Agent Bazaar' | Sí | Gap |
| frontend-landing-37 | No-JS/SSG: catálogo no crawlable | ux | manual | P2 | islas vacías sin JS | Sí | Gap |
| frontend-landing-38 | Directivas de hydration (client:load vs visible) | integration | e2e | P2 | fetch diferido al scroll | Sí | Gap |

### 5.8 Frontend — Dashboard (`@kiba/dashboard`, React 19 + Vite 6 SPA)

**Cero tests UI** (solo `tsc` + react-doctor, **no en deploy**). El deploy corre `npm run dev`. P0s: build roto (Billing), chain default `solana`, flujos de dinero, sesión.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **frontend-dashboard-01** | Signup happy crea cuenta, sesión, /app | happy | e2e | **P0** | $5 free credit | Sí | Gap |
| **frontend-dashboard-02** | Signup password<8 bloquea request | error | unit | **P0** | no llama api.signup | Sí | Gap |
| frontend-dashboard-03 | Signup error backend (duplicado) | error | integration | P1 | mensaje en form | Sí | Gap |
| frontend-dashboard-04 | Signup network/5xx → genérico | error | integration | P1 | 'Signup failed' | Sí | Gap |
| **frontend-dashboard-05** | Login happy autentica y redirige | happy | e2e | **P0** | balance header | Sí | Gap |
| **frontend-dashboard-06** | Login credenciales malas → sin sesión | security | integration | **P0** | 401, sin redirect | Sí | Gap |
| frontend-dashboard-07 | Login network → 'Login failed' | error | integration | P1 | — | Sí | Gap |
| frontend-dashboard-08 | Loading/disabled states (login/signup) | ux | integration | P2 | — | Sí | Gap |
| frontend-dashboard-09 | Branding auth + cross-nav | ux | integration | P2 | kiba wordmark | Sí | Gap |
| **frontend-dashboard-10** | Ruta protegida sin auth → /login | security | integration | **P0** | contenido nunca monta | Sí | Gap |
| frontend-dashboard-11 | Auth loading → 'Loading…' sin redirect prematuro | ux | integration | P1 | evita flash | Sí | Gap |
| **frontend-dashboard-12** | Sesión persiste tras reload (cookie) | integration | e2e | **P0** | /api/v1/me credentials:include | Sí | Gap |
| **frontend-dashboard-13** | Sesión expirada (me 401) → /login | security | integration | **P0** | sin datos stale | Sí | Gap |
| frontend-dashboard-14 | Sin return-URL tras login (deep link → /app) | ux | e2e | P1 | gap UX 'next' | Sí | Gap |
| **frontend-dashboard-15** | Logout (sidebar+Settings) limpia sesión | security | integration | **P0** | rutas inaccesibles | Sí | Gap |
| frontend-dashboard-16 | Logout resiliente si server falla | security | integration | P1 | igual limpia user | Sí | Gap |
| **frontend-dashboard-17** | Header balance desde /v1/balance | happy | integration | **P0** | '—' hasta cargar | Sí | Gap |
| frontend-dashboard-18 | Balance auto-refresh por intervalo | integration | integration | P2 | 15s/30s | Sí | Gap |
| frontend-dashboard-19 | Header balance vs tx USD consistentes (cadena activa) | edge | integration | P1 | rate puede divergir | Sí | Gap |
| **frontend-dashboard-20** | Transactions tabla: columnas, badges, montos firmados | happy | integration | **P0** | +/- topup verde | Sí | Gap |
| frontend-dashboard-21 | Transactions empty/loading | ux | integration | P1 | indexedAgents=0 hoy | Sí | Gap |
| frontend-dashboard-22 | Transactions filtros (all/call/topup/refund) | happy | integration | P1 | actualiza count | Sí | Gap |
| **frontend-dashboard-23** | Explorer links usan cadena ACTIVA y target seguro | onchain | integration | **P0** | stellar.expert, rel=noopener | Sí | Gap |
| frontend-dashboard-24 | Overview KPIs y recent list | happy | integration | P1 | balance + last-5 | Sí | Gap |
| **frontend-dashboard-25** | **Top-up happy: confirma y refresca (ROTO)** | happy | integration | **P0** | **Billing.tsx ReferenceError baseUnitsToUsd** | Sí | Gap |
| frontend-dashboard-26 | Top-up rechaza monto no positivo | error | unit | P1 | 'must be positive' | Sí | Gap |
| frontend-dashboard-27 | Top-up cap $1000 demo | error | unit | P1 | — | Sí | Gap |
| frontend-dashboard-28 | Top-up error backend auto-clears | error | integration | P1 | ~4s | Sí | Gap |
| **frontend-dashboard-29** | Create API key revela secreto una vez | security | integration | **P0** | nunca reaparece | Sí | Gap |
| frontend-dashboard-30 | Copy secret a clipboard con feedback | ux | integration | P1 | Check 1.5s | Sí | Gap |
| frontend-dashboard-31 | Create key ignora nombre vacío | edge | unit | P2 | name.trim() | Sí | Gap |
| frontend-dashboard-32 | Errores de mutación silenciados (key/oauth) | error | integration | P1 | revoke fallido sin señal | Sí | Gap |
| **frontend-dashboard-33** | Revoke API key lo quita de la lista | security | integration | **P0** | DELETE + invalidate | Sí | Gap |
| frontend-dashboard-34 | API keys empty/loading | ux | integration | P2 | — | Sí | Gap |
| frontend-dashboard-35 | Connected apps (OAuth) lista | happy | integration | P1 | scope, fechas | Sí | Gap |
| frontend-dashboard-36 | OAuth empty state instruye kiba-mcp | ux | integration | P1 | sin legacy naming | Sí | Gap |
| **frontend-dashboard-37** | Revoke OAuth quita acceso de la app | security | integration | **P0** | la app puede gastar | Sí | Gap |
| frontend-dashboard-38 | OAuth consent approve/deny + redirect (gateway) | security | e2e | P1 | gateway/src/views.ts | Sí | Gap |
| frontend-dashboard-39 | OAuth callback error + sin ruta /callback en SPA | security | e2e | P1 | responsabilidad del gateway | Sí | Gap |
| frontend-dashboard-40 | Branding kiba consistente, sin agent-bazaar | ux | integration | P1 | grep | Sí | Gap |
| **frontend-dashboard-41** | Settings profile + wallet con explorer cadena activa | onchain | integration | **P0** | XLM, treasury | Sí | Gap |
| frontend-dashboard-42 | Settings copy chain-drifted (Solana/PDA hardcoded) | config | manual | P1 | factual erróneo en Stellar | Sí | Gap |
| frontend-dashboard-43 | Settings wallet refresh con spinner | ux | integration | P2 | — | Sí | Gap |
| **frontend-dashboard-44** | Rendering con VITE_CHAIN=stellar | config | e2e | **P0** | XLM, stellar.expert, rate XLM | Sí | Gap |
| **frontend-dashboard-45** | **VITE_CHAIN unset/inválido → fallback Solana** | config | integration | **P0** | math 1e9/$150 erróneo; deploy debe exportar CHAIN | Sí | Gap |
| frontend-dashboard-46 | lib/format + lib/chain unit suite | edge | unit | P1 | round-trip por cadena | Sí | Gap |
| frontend-dashboard-47 | api.request error/status handling | edge | unit | P1 | 204→undefined; base /api vs /backend | Sí | Gap |
| **frontend-dashboard-48** | Proxy routing + requisito de env en prod | integration | e2e | **P0** | dev server ES la ruta prod | Sí | Gap |
| **frontend-dashboard-49** | Cookie auth sobrevive el proxy | security | e2e | **P0** | SameSite/secure con TLS | Sí | Gap |
| frontend-dashboard-50 | Agents live WebSocket + closed state | integration | integration | P1 | invalida queries | Sí | Gap |
| **frontend-dashboard-51** | Playground call ejecuta x402 y actualiza UI | onchain | onchain | **P0** | ver FLUJO-E2E-1 | No | Gap |
| frontend-dashboard-52 | Playground rechaza JSON inválido antes de gastar | edge | unit | P1 | api.call no se invoca | Sí | Gap |
| **frontend-dashboard-53** | Playground fallo deja balance intacto | onchain | onchain | **P0** | débito atómico (variante mock automatizable) | No | Gap |
| frontend-dashboard-54 | x402 trace timeline con unidades cadena activa | onchain | integration | P1 | trace mockeado | Sí | Gap |
| **frontend-dashboard-55** | Register agent on-chain (custodial firma) | onchain | onchain | **P0** | PDA+signature | No | Gap |
| frontend-dashboard-56 | Update/deregister agente propio on-chain | onchain | onchain | P1 | requiere keypair fondeado | No | Gap |
| frontend-dashboard-57 | Register form validación cliente | error | unit | P1 | slug 32, url 256, desc 512 | Sí | Gap |
| frontend-dashboard-58 | Agents search modes, debounce, empty | integration | integration | P1 | ~300ms | Sí | Gap |
| frontend-dashboard-59 | Platform revenue desde backend (fee.pct dinámico) | onchain | integration | P1 | no hardcodea 95/5 | Sí | Gap |
| frontend-dashboard-60 | A11y: botones icon-only sin nombre; sin focus ring | ux | integration | P1 | aria-label | Sí | Gap |
| frontend-dashboard-61 | A11y: mensajes error/éxito no anunciados | ux | integration | P1 | role=alert/aria-live | Sí | Gap |
| frontend-dashboard-62 | A11y: contraste y reduced-motion | ux | manual | P1 | WCAG AA | Sí | Gap |
| frontend-dashboard-63 | A11y: axe + Lighthouse en páginas clave | ux | e2e | P1 | sin críticos | Sí | Gap |
| **frontend-dashboard-64** | **Build/typecheck roto y no enforced en deploy** | config | unit | **P0** | TS2304 Billing; CI debe correr tsc/build | Sí | Gap |
| frontend-dashboard-65 | Clipboard sin guard en contexto inseguro | edge | integration | P2 | http no-localhost lanza | Sí | Gap |

### 5.9 Integración y despliegue

Flujo x402 completo, arranque de docker compose (7 servicios; 6 funcionales + `contracts` Solana inerte), wiring de env, rebrand en runtime, reproducibilidad, regresión contra `E2E_MCP_VALIDATION.md` (infra vieja muerta). El riesgo NO está en el contrato sino en el **wiring/repro/drift**.

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **integration-deploy-01** | **Flujo x402 completo E2E sobre Stellar (canónico)** | happy | e2e | **P0** | trace 4 pasos, firmas reales; FLUJO-E2E-1 | Sí | Existe |
| **integration-deploy-02** | **Split 95/5 verificado por balances (canónico)** | onchain | onchain | **P0** | treasury +500000 stroops exacto; FLUJO-E2E-2 | Sí | Existe |
| **integration-deploy-03** | Estados del escrow via SDK: Pending→Completed | onchain | onchain | **P0** | fetchEscrow refleja transición | Sí | Existe |
| **integration-deploy-04** | Gateway /v1/call virtual-cascade | happy | e2e | **P0** | debita virtual + refill + claim | Sí | Gap |
| **integration-deploy-05** | Gateway /v1/call wallet-direct | happy | e2e | **P0** | custodial paga, sin debitar virtual | Sí | Gap |
| **integration-deploy-06** | **Consistencia STELLAR_CONTRACT_ID en 3 servicios (canónico drift)** | config | integration | **P0** | mismo contrato activo, no el stale | Sí | Gap |
| **integration-deploy-07** | **Modo degradado: 200 pero NO liquida (canónico)** | error | e2e | **P0** | deploy roto se ve sano | Sí | Gap |
| **integration-deploy-08** | **Reproducibilidad fresh-clone (canónico)** | config | integration | **P0** | .env.example sin CHAIN/contrato | Sí | Gap |
| **integration-deploy-09** | **Registro on-chain → indexedAgents 0→5 (canónico)** | onchain | onchain | **P0** | discovery deja de estar vacío | Sí | Gap |
| **integration-deploy-10** | Refund: recuperable tras 300s, rechazado antes | onchain | onchain | **P0** | solo el client firmante | Sí | Parcial |
| **integration-deploy-11** | Circuit breaker maxPrice (2×) en el proxy | security | e2e | **P0** | aborta antes de open_escrow | Sí | Gap |
| integration-deploy-12 | Salud de los 6 servicios funcionales | happy | integration | P1 | sin healthchecks en compose | Sí | Gap |
| integration-deploy-13 | /health chain=stellar/asset=XLM/registry=stellar | config | integration | P1 | canary de mala config | Sí | Gap |
| integration-deploy-14 | Rebrand runtime: cero 'agent-bazaar' en HTTP/logs | ux | integration | P1 | 6 servicios | Sí | Gap |
| integration-deploy-15 | Program ID Solana heredado documentado | config | integration | P1 | stellar no depende de PROGRAM_ID | Sí | Gap |
| integration-deploy-16 | Carrera de sequence en Stellar (misma custodial) | edge | e2e | P1 | tx_bad_seq concurrente | Sí | Gap |
| integration-deploy-17 | Resiliencia a rate-limit de friendbot en bootstrap | error | integration | P1 | indexedAgents parcial | Sí | Gap |
| integration-deploy-18 | Build reproducible de kiba/stellar-cli | config | integration | P1 | pin de versión | Sí | Gap |
| integration-deploy-19 | deploy-testnet.sh produce wasm correcto, deploy+init | onchain | onchain | P1 | kiba_soroban.wasm wasm32v1-none | No | Existe |
| integration-deploy-20 | Drift del contrato stale en scripts/docs | config | unit | P1 | grep estático | Sí | Gap |
| integration-deploy-21 | Orchestrator requiere ANTHROPIC_API_KEY real | config | integration | P1 | arranque automatizable sin clave | Sí | Gap |
| integration-deploy-22 | Fix Dockerfile orchestrator (install scopeado) | config | integration | P1 | sin disparar prepare:tsc de mcp | Sí | Gap |
| integration-deploy-23 | Regresión adaptada de E2E_MCP (infra muerta→Stellar) | integration | manual | P1 | reescribir checklist | No | Parcial |
| integration-deploy-24 | Regresión F-2: filas type=call con tx_signature | integration | e2e | P1 | click-through al explorer | Sí | Gap |
| integration-deploy-25 | Persistencia de keypairs de agentes (volumen) | integration | integration | P1 | misma G... tras reinicio | Sí | Gap |
| integration-deploy-26 | Persistencia SQLite + cache de embeddings | integration | integration | P1 | sin cold-start | Sí | Gap |
| integration-deploy-27 | Custodial cross-chain: mismo seed Solana↔Stellar | integration | integration | P1 | G... determinista | Sí | Gap |
| integration-deploy-28 | Derivación de unidades/rate por CHAIN | config | unit | P2 | 1e7/XLM vs 1e9/SOL | Sí | Gap |
| integration-deploy-29 | Stellar discovery siempre calls/earned=0 | edge | integration | P2 | discrepancia vs Solana | Sí | Gap |
| integration-deploy-30 | Endpoint on-chain = hostname interno docker | edge | integration | P2 | frágil cross-host | Sí | Gap |
| integration-deploy-31 | Teardown: down (conserva) vs down -v (wipe) | integration | integration | P2 | sin huérfanos | Sí | Gap |
| integration-deploy-32 | Costo/fragilidad del build de contracts (inerte) | perf | integration | P2 | perfiles de compose | Sí | Gap |
| integration-deploy-33 | Doc drift en READMEs (wasm name, contrato stale) | config | manual | P2 | corregir | No | Gap |
| integration-deploy-34 | No idempotencia del deploy/initialize-once | edge | onchain | P2 | contratos huérfanos | No | Gap |

### 5.10 Gateway (`@kiba/gateway`) — auth, OAuth PKCE, x402 proxy, wallets custodiales, créditos USD, API keys

Capa de UX/seguridad sobre el SDK (`packages/gateway/src/`): `index.ts` (Express — auth dual cookie/bearer y rutas), `auth.ts` (JWT HMAC-SHA256 hand-rolled, signup/login, generación de custodial), `oauth.ts` (OAuth 2.0 PKCE para MCP), `wallets.ts` (custodiales + master treasury + refill), `billing.ts` (crédito USD virtual, `debit` atómico), `proxy.ts` (cascada x402 de `/v1/call`), `api-keys.ts`, `agents.ts` (CRUD on-chain firmado por la custodial) y `views.ts` (HTML server-rendered). **Cobertura existente real: 4 suites unit de helpers** (`auth/oauth/billing/wallets.test.ts`, todas en el script `test`) que cubren JWT, PKCE, `debit` atómico y carga de custodiales — pero **toda la capa HTTP/middleware (`index.ts`), `api-keys.ts`, `agents.ts`, `proxy.ts` y `views.ts` no tienen NINGÚN test**, y ninguna **propiedad de seguridad** está verificada. Los P0 se concentran aquí: **dinero** (crédito/topup/doble-gasto/treasury) y **seguridad** (JWT_SECRET débil por defecto, OAuth `redirect_uri`, custodia de llaves en claro, scopes de API key, XSS).

| ID | Título | Cat | Nivel | P | Esperado (resumen) | Auto | Estado |
|---|---|---|---|---|---|---|---|
| **gateway-01** | **JWT_SECRET por defecto débil `dev-secret-change-in-prod`** | security | unit | **P0** | compose lo shipea (línea 144); forjar la cookie de cualquier id = takeover; falta guard de arranque que rechace el default | Sí | Gap |
| **gateway-02** | signJwt/verifyJwt HS256: rechaza firma manipulada y <3 partes | security | unit | **P0** | tamper→null; no valida `alg` pero recomputa HMAC (sin alg:none) | Sí | Existe |
| **gateway-03** | verifyJwt rechaza token expirado (exp en el pasado) | security | unit | **P0** | cookie TTL 30 d; `exp<now`→null | Sí | Existe |
| gateway-04 | verifyJwt no valida el header `alg` explícitamente | security | unit | P1 | seguro por diseño (recomputa HMAC); fijar con test de header manipulado | Sí | Parcial |
| gateway-05 | Comparación de firma JWT no constant-time (timing) | security | unit | P2 | usar `timingSafeEqual` | Sí | Gap |
| **gateway-06** | requireAuth acepta cookie de sesión → bearerUser | security | integration | **P0** | `req.user` poblado por loadSession; downstream agnóstico | Sí | Gap |
| **gateway-07** | requireAuth acepta Bearer OAuth token; revocado/expirado→401 | security | integration | **P0** | getUserByToken filtra revoked/exp | Sí | Parcial |
| **gateway-08** | requireAuth acepta Bearer API key (`sk_live`) hasheada | security | integration | **P0** | precedencia OAuth-token→API-key | Sí | Gap |
| **gateway-09** | requireAuth sin credenciales → 401 json | security | integration | **P0** | `'authentication required'` | Sí | Gap |
| gateway-10 | loadSession cookie inválida no puebla user; requireSession→/login?next | error | integration | P1 | no crashea; redirect HTML con `next` | Sí | Gap |
| **gateway-11** | OAuth session round-trip + TTL 10 min + expiración | happy | unit | **P0** | getOAuthSession `exp<now`→null | Sí | Existe |
| **gateway-12** | authorizeSession emite code, consumed=1; 2.º authorize→null | security | unit | **P0** | no doble code por sesión | Sí | Existe |
| **gateway-13** | exchangeCodeForToken PKCE S256; verifier malo→invalid_code_verifier | security | unit | **P0** | `sha256(verifier)==challenge` base64url | Sí | Existe |
| **gateway-14** | code de un solo uso (delete tras exchange); reuso→invalid_code | security | unit | **P0** | anti-replay del authorization code | Sí | Existe |
| **gateway-15** | **`redirect_uri` NUNCA validado (sin allowlist)** | security | integration | **P0** | /auth/connect acepta cualquier URI → consent-phishing y robo de code+token; exigir allowlist (loopback/registrado) | Sí | Gap |
| **gateway-16** | **El code no expira en el intercambio** | security | unit | **P0** | exchangeCodeForToken consulta por `code` sin chequear `expires_at` → code eterno hasta usarse | Sí | Gap |
| gateway-17 | Consent no muestra `redirect_uri` ni scope real | security | manual | P1 | el usuario no puede detectar el destino (anti-phishing) | Sí | Gap |
| gateway-18 | exchange: session_not_authorized / grant_type / invalid_request | error | integration | P1 | 3 ramas de error de /oauth/token | Sí | Parcial |
| gateway-19 | revokeToken revoked=1; token revocado no autentica; /oauth/revoke sin auth | security | integration | P1 | revocación efectiva; revoke público (DoS) | Sí | Parcial |
| **gateway-20** | **Secretos de custodial en PLANO en SQLite** | security | unit | **P0** | `custodial_wallet_secret` JSON sin cifrar → DB/volumen leak = robo de TODAS las llaves | Sí | Gap |
| **gateway-21** | **Custodia de la master wallet (hot key única)** | security | integration | **P0** | env/`master-wallet.json` controla el treasury; su fuga = drenaje de la tesorería | Sí | Parcial |
| **gateway-22** | Aislamiento de fondos por usuario (sin IDOR) | security | integration | **P0** | loadUserWallet por id; /v1/call usa `bearerUser.id`; A no opera la wallet de B | Sí | Parcial |
| gateway-23 | loadUserWallet missing→throw; loadMasterWallet env>archivo | happy | unit | P1 | carga determinista | Sí | Existe |
| gateway-24 | Derivación cross-chain: misma keypair Solana/Stellar (`G...` estable) | integration | unit | P1 | ver `sdk-22/23` | Sí | Gap |
| **gateway-25** | debit atómico: suficiente/insuficiente/exacto, sin saldo negativo | happy | unit | **P0** | insuficiente no toca saldo ni inserta tx | Sí | Existe |
| **gateway-26** | **Doble-gasto / carrera: 2 `/v1/call` concurrentes, saldo para uno** | security | integration | **P0** | TOCTOU getBalance→debit; un solo debit gana (mitigado por tx atómica, sin test) | Sí | Gap |
| **gateway-27** | **Refund en fallo de call (refundDebit)** | error | integration | **P0** | débito y refund NO atómicos → ventana de inconsistencia si cae el proceso; falta idempotencia | Sí | Gap |
| **gateway-28** | **`/topup` mock acuña crédito sin cobro → drena el treasury** | security | integration | **P0** | cap $1000/call pero sin tope agregado ni rate-limit; el crédito dispara refills reales del master | Sí | Gap |
| gateway-29 | handleTopup valida `0<amount<=1000` (NaN/neg/>1000→400) | error | integration | P1 | rechazo de monto inválido | Sí | Parcial |
| gateway-30 | Bono signup $5 + tx `signup-bonus`; sin rate-limit → abuso masivo | security | integration | P1 | bono por cuenta; spam de cuentas = crédito infinito | Sí | Parcial |
| gateway-31 | Billing chain-aware (1e9/$150 vs 1e7/$0.12); `/v1/transactions` shape + limit 500 | edge | integration | P1 | round-trip; montos abs, `status=success` | Sí | Parcial |
| **gateway-32** | createApiKey SHA-256 (no plano), secret una vez; revoked=0 + last_used_at | security | unit | **P0** | hash en DB; secret irrecuperable tras crear | Sí | Gap |
| **gateway-33** | **Scoping/IDOR de API keys: revoke/list por `user_id`** | security | integration | **P0** | A no revoca ni lista las llaves de B | Sí | Gap |
| **gateway-34** | **API keys sin scopes ni expiración = acceso total persistente** | security | integration | **P0** | fuga = takeover (gastar, registrar agentes, crear más keys); no caducan | Sí | Gap |
| gateway-35 | listApiKeys no filtra secret/hash; `/v1/oauth/connections` expone 16 chars del token | security | integration | P1 | revokeOAuthByPrefix scoped por `user_id` | Sí | Gap |
| **gateway-36** | **XSS en consent (`client_name`) + `redirect_uri` `javascript:`** | security | integration | **P0** | authorizeView interpola sin escapar; `<a href>` de /auth/authorize ejecutable; escapar HTML + validar esquema http(s) | Sí | Gap |
| gateway-37 | CORS allowlist + credentials:true; request sin Origin permitido | security | integration | P1 | prod requiere `PUBLIC_URL` en la allowlist | Sí | Gap |
| gateway-38 | Cookie sin `Secure`; CSRF defendido solo por SameSite=Lax | security | integration | P1 | sin token CSRF en `/topup` ni `/auth/authorize`; tras TLS de Coolify requiere trust proxy | Sí | Gap |
| gateway-39 | Sin rate-limit en `/login` (fuerza bruta) ni `/oauth/token` | security | integration | P1 | limitar intentos | Sí | Gap |
| gateway-40 | Chain-drift en vistas (Solana hardcoded, `*150`) + branding kiba | ux | integration | P1 | landingView "en Solana"; dashboardView labels SOL/devnet con CHAIN=stellar; cero "Agent Bazaar" | Sí | Gap |
| gateway-41 | Vistas signup/login/consent/authorized renderizan + `next` (encodeURIComponent) | happy | integration | P2 | post al endpoint correcto; escape de `email`/error | Sí | Gap |
| gateway-42 | `/health` forma + `/v1/platform/stats` agrega treasury/fee/marketplace | happy | integration | P2 | revenue = balance on-chain del treasury (fuente de verdad) | Sí | Gap |
| **gateway-43** | Rol del gateway en el proxy x402 `/v1/call` (cascada + breaker 2× maxPrice) | happy | e2e | **P0** | ver **FLUJO-E2E-1**, `integration-deploy-04/05/11` (NO duplicar) | Sí | Gap |
| **gateway-44** | **Config drift: compose defaultea CHAIN=solana + STELLAR_CONTRACT_ID stale** | config | integration | **P0** | el proxy del gateway liquida contra el contrato equivocado/degradado; ver **CONFIG-DRIFT**, `integration-deploy-06/07` | Sí | Gap |

---

## 6. Concerns transversales

### 6.1 Seguridad

| Tema | Escenarios clave | Estado / riesgo |
|---|---|---|
| **Autorización on-chain (require_auth / has_one)** | `contracts-40..43`, `contracts-52/56/57`, `contracts-71` | **P0 sin cobertura.** Los 14 tests Soroban usan `mock_all_auths`; Anchor solo prueba `InvalidTreasury`. La propiedad central "solo la parte correcta mueve dinero" carece de tests negativos. |
| **Anti-replay / reuso de nonce** | `contracts-24/25/58`, `sdk-44`, `demo-agents-05`, `mcp-server-46` | **P0 sin cobertura.** Núcleo de x402. La idempotencia vive 100 % on-chain (estado del escrow); el nonce del 402 nunca se valida en el agente. |
| **JWT / sesión cookie** | `frontend-dashboard-12/13/49`, `mcp-server-40` | Sesión por cookie `credentials:include`; sin tests. Sin auto re-auth ante 401 server-side. Cuidar SameSite/secure tras TLS de Coolify. |
| **OAuth 2.0 + PKCE** | `mcp-server-27/33/34/36/38`, `frontend-dashboard-38/39` | Vector PKCE OK; handshake completo, `redirect_uri` loopback-only y errores de callback **sin test**. Consent/callback los renderiza el gateway, no la SPA. |
| **Secretos** | `frontend-landing-03`, `mcp-server-24/54`, `frontend-dashboard-29` | Bundle del frontend no debe filtrar nada distinto de `PUBLIC_*`. Token MCP es bearer gastable 30 días (mode 0600 sin test, ignorado en Windows). Secreto de API key se muestra una vez. |
| **CORS / rate limit / DoS** | `orchestrator-10/11`, `backend-55/59`, `frontend-dashboard-65` | **`/intent` del orquestador sin auth ni CORS → drena la wallet.** `/agents` y `/ws` sin rate limit. |
| **Caps de precio (sobrecobro)** | `sdk-30`, `orchestrator-38`, `integration-deploy-11` | **P0.** `maxPrice` compara el precio anunciado, no el `quote.amount` real → provider malicioso sobrecobra. Cap mal denominado (XLM/SOL vs USDC). |
| **Inyección (FTS / prompt)** | `backend-16`, `orchestrator-30/32` | Sanitización FTS sin test; payload del LLM se reenvía al agente sin validar. |

### 6.2 Correctitud del rebrand en runtime

- **Servicios/HTTP**: `kiba-backend`, `kiba-gateway` en `/health`; cero "agent-bazaar" en respuestas y logs de los 6 servicios (`integration-deploy-14`).
- **MCP**: nombre del server `kiba` (no `agent-bazaar`) y versión consistente; hoy ctor `0.1.0` ≠ package `0.1.1` (`mcp-server-02`).
- **Frontends**: cero "Agent Bazaar" en bundles; wordmark kiba, `kiba-mcp`, © 2026 Kiba (`frontend-landing-25`, `frontend-dashboard-40`).
- **Restos conocidos FUERA del runtime HTTP** (informativo): `installer/package-lock.json` (`@agent-bazaar/installer`), comentario `ab-agents` en `indexer.ts`, mensaje de bootstrap del agente que menciona `PROGRAM_ID` aun bajo Stellar.

### 6.3 Cross-chain (Solana ↔ Stellar)

- **Paridad de lógica**: `contracts-64` (aritmética del split por vector), `contracts-65/66` (matriz de divergencias + constantes), `sdk-03` (constantes SDK↔contrato). Divergencias reales conocidas: claim-tras-deregister (Soroban OK / Anchor falla), checks de identidad código-muerto en Soroban vs alcanzables en Anchor, taxonomías de error distintas, `agent` no ligado al escrow en Anchor (infla stats ajenas).
- **Derivación de cuenta**: `sdk-22/23`, `integration-deploy-27` — el mismo seed ed25519 deriva pubkey Solana y cuenta Stellar `G...`; estabilidad crítica (donde aterriza el dinero).
- **Unidades/rate**: `integration-deploy-28`, `frontend-dashboard-46` — 1e7 stroops/XLM vs 1e9 lamports/SOL; un mismatch infla/deflacta precios 100×.
- **Selección de cadena**: `sdk-16..21`, `frontend-dashboard-44/45`, `backend-43..45` — el factory y los defaults `solana` sin test; **deploy debe exportar `CHAIN`**.
- **Solana bloqueado**: `contracts-57`, `sdk-57`, `frontend-landing-11` — no redesplegado para kiba.

### 6.4 Manejo de dinero / split 95/5

- **Split exacto** (FLUJO-E2E-2): `contracts-17/46/67`, `integration-deploy-02`, `sdk-01`.
- **Dirección del redondeo del fee** (`contracts-19`): **el código trunca el fee a favor del owner, lo OPUESTO al brief.** Resolver intención y fijar con vector de montos. **P0 de decisión + test.**
- **Orden serve→claim** (`sdk-48`, `demo-agents-26`): trabajo entregado y claim falla → pérdida; falta idempotencia/reintento.
- **Underpayment/overpayment** (`sdk-45`, `demo-agents-06/24`): underpayment rechazado; overpayment se reclama completo sin reembolso del excedente.
- **Custodia/solvencia** (`contracts-37`): balance del contrato == suma de escrows Pending.
- **Precisión bigint** (`backend-50`, `frontend-dashboard-19/46`): `Number(bigint)` sobre 2^53 pierde precisión; USD del header (backend-authoritative) vs por-transacción (cliente) pueden divergir.
- **Build de dinero roto** (`frontend-dashboard-25/64`): el handler de éxito del topup nunca corre por el `ReferenceError`.

### 6.5 Concurrencia y datos

- **Sequence number Stellar** (`orchestrator-39`, `integration-deploy-16`): N escrows en paralelo desde la misma custodial → `tx_bad_seq`. Necesita cola/serialización.
- **Bootstrap del indexer sin mutex** (`backend-38`): carrera upsert/markDeleted.
- **Pérdida de catálogo por fallo RPC** (`backend-36`): `[]` interpretado como "todos desaparecieron" → marca todo deleted. **P0 disponibilidad/dinero.**
- **Persistencia** (`backend-33`, `integration-deploy-25/26`): SQLite (WAL), embeddings (alineación Buffer→Float32Array), keypairs de agentes (volumen) sobreviven reinicios.
- **Idempotencia de pago** (`orchestrator-12`): `/intent` duplicado abre escrows nuevos → doble pago.

---

## 7. Cobertura existente vs gaps

### 7.1 Lo que YA está testeado (mantener como regresión)

- **Contrato Soroban (sandbox)**: ~14 tests `cargo` con snapshots de ledger — registro y validaciones básicas, **split 95/5 por balances**, redondeo a fee=0, refund tras 300 s, doble-claim, errores (`AmountBelowPrice`, `AlreadyInitialized`, `EscrowNotPending`). **Caveat: usan `mock_all_auths` → no ejercitan `require_auth`.**
- **Contrato Anchor (localnet)**: 7 tests TS — register/update/deregister, **open+claim split 95/5 con delta de treasury exacto**, `InvalidTreasury`, `RefundTooEarly`, `AmountBelowPrice`.
- **SDK**: 4 suites unit en **modo degradado** — `computeFeeSplit`, `loadOrCreateKeypair`, `AgentClient.callWithTrace` (4 pasos, maxPrice anunciado, allowlist, legacy 200, errores), `AgentProvider` (manifest, 402+nonce, floor, X-PAYMENT degradado/inválido, health). + 2 scripts on-chain Stellar (`smoke`, `e2e`).
- **Backend**: `db.ts` (upsert/markDeleted/listAgents/FTS5), `search.ts` (keyword/hybrid sin embeddings, clamps), `cosineSim`.
- **MCP**: routing de las 4 tools, query handling, contratos de error, vector PKCE RFC 7636, modo headless (subprocess).
- **Gateway**: 4 suites unit de helpers (en el script `test`) — `auth.test.ts` (JWT sign/verify, tamper/expirado, createUser/authenticate, getUserByToken), `oauth.test.ts` (PKCE: session/authorize/exchange/consent, code single-use, revoke), `billing.test.ts` (usd↔lamports, `debit` atómico/insuficiente/exacto, topup, attachSignature), `wallets.test.ts` (master env/archivo, loadUserWallet). **Caveat: solo helpers — la capa HTTP/middleware (`index.ts`), `api-keys.ts`, `agents.ts`, `proxy.ts` y `views.ts` no tienen test, ni ninguna propiedad de seguridad.**
- **On-chain**: `smoke-testnet.sh` (split 5 % verificado), `deploy-testnet.sh` (deploy+initialize). **Caveat: defaultean al contrato stale.**

### 7.2 Lo que falta (gaps, por severidad)

**P0 sin cobertura (163 escenarios marcados P0; los más críticos):**
- **Autorización on-chain real** (Soroban con `mock_all_auths`, Anchor sin firmante-equivocado).
- **Anti-replay / reuso de nonce / estados terminales** (refund-tras-claim, claim-tras-refund) en ambos contratos.
- **Dirección del redondeo del fee** (contradice el brief).
- **Builders de instrucción y Borsh del SDK** (program.ts, decoders, discriminadores) — código de consenso/dinero, ni siquiera en el script `test`.
- **Verificación on-chain del provider** (escrow-not-found / no-Pending / underpayment) — los tests corren en modo degradado que acepta sin verificar.
- **`maxPrice` no acota el quote real** → sobrecobro.
- **Backend HTTP/WS/indexer/registry sin NINGÚN test** + pérdida de catálogo por fallo RPC.
- **Orchestrator sin tests** + compose sin `CHAIN`/`STELLAR_*` (pagos rotos) + `/intent` sin auth.
- **Dashboard sin UI tests** + build roto (Billing) + chain default `solana`.
- **Money path MCP (`call_agent`) sin E2E** + header auth en POST sin assert + sin timeout.
- **Drift de contract ID** + reproducibilidad rota + modo degradado silencioso + `indexedAgents=0`.
- **Gateway — JWT_SECRET por defecto débil** (`dev-secret-change-in-prod` en compose) → forja de cookie de sesión = toma de cuenta.
- **Gateway — secretos custodiales en claro en SQLite + master hot key única** → un leak de la DB/volumen drena todas las wallets y la tesorería.
- **Gateway — crédito acuñable sin cobro (`/topup` mock) + doble-gasto por carrera** → drena el treasury vía refills del master; débito/refund no atómicos.
- **Gateway — OAuth `redirect_uri` sin validar + code que no expira** → consent-phishing y robo de code+token.
- **Gateway — API keys sin scope ni expiración + XSS en la consent page** (`client_name`/`redirect_uri` sin escapar); auth dual (cookie/bearer/API-key) y `proxy.ts` sin test.

**P1/P2 destacados:** validaciones de límites en contratos; eventos sin aserción (rompe el indexer en silencio); OAuth handshake completo; rebrand en runtime; a11y/lighthouse de frontends; concurrencia (sequence, mutex); persistencia.

---

## 8. Riesgos principales y supuestos

### Riesgos (ordenados por impacto)

1. **Drift de contract ID (P0)** — el ID activo solo vive en `.env`; todo lo trackeado apunta al stale `CA5M54YV...`. Sin override, el agente registra en un contrato y el cliente abre escrow en otro → `AgentNotFound` o liquidación contra un contrato fantasma. **Riesgo de dinero.**
2. **Modo degradado silencioso (P0)** — sin `STELLAR_CONTRACT_ID`, el x402 da 200 pero no mueve dinero (firma `NO_ONCHAIN_PROGRAM_ID`). Un deploy roto se ve sano; no hay healthchecks que lo detecten.
3. **Orquestador no liquida (P0)** — su bloque de compose no recibe `CHAIN`/`STELLAR_*` → cae a Solana degradado → todas las tareas `success:false`. El flujo de dinero del consumer LLM está roto en el despliegue actual.
4. **Autorización on-chain sin verificar (P0)** — `mock_all_auths` oculta que "claim solo por owner", "refund solo por client" y "register/update/deregister solo por owner" no tienen tests negativos.
5. **Catálogo vacío / borrado (P0)** — `indexedAgents=0` (nadie registró on-chain) y, peor, un fallo transitorio de RPC hace que el indexer marque **todo** el catálogo como deleted hasta el próximo heartbeat (≤5 min).
6. **Reproducibilidad rota (P0)** — `.env.example` incompleto: el quickstart documentado no reconstruye el deploy Stellar activo.
7. **Build del dashboard roto en producción (P0)** — `Billing.tsx` no compila pero shipea porque el deploy corre `npm run dev`; el handler de éxito del topup nunca corre.
8. **Sobrecobro por cap mal aplicado (P0)** — `maxPrice` valida el precio anunciado, no el `quote.amount`.
9. **Toma de cuenta por JWT_SECRET débil (P0)** — el gateway shipea `dev-secret-change-in-prod` por defecto (`docker-compose.yml:144`); quien conozca el default forja la cookie de sesión de cualquier usuario → gasta su crédito, drena su custodial y crea API keys. Falta un guard de arranque que rechace el secreto por defecto.
10. **Custodia de llaves en claro (P0)** — los secretos de las custodiales se guardan en texto plano en SQLite (`custodial_wallet_secret`) y la tesorería depende de una única hot key (`MASTER_WALLET_SECRET`/`master-wallet.json`); un leak del volumen o de la DB drena todas las wallets y el treasury.
11. **Crédito acuñable sin cobro + drenaje del treasury (P0)** — `/topup` es un mock (`fake-stripe`) sin rail de pago, con cap por llamada ($1000) pero sin tope agregado ni rate-limit; como el crédito virtual dispara refills reales del master en `/v1/call`, es un vector directo de drenaje de la tesorería. Además débito y refund no son atómicos (ventana de pérdida) y la ventana TOCTOU getBalance→debit permite carreras de doble-gasto.
12. **OAuth consent-phishing (P0)** — `/auth/connect` acepta cualquier `redirect_uri` (sin allowlist) y el code no expira en el intercambio (`exchangeCodeForToken` no chequea `expires_at`); un sitio malicioso completa el flujo PKCE con su propio verifier, induce el "Autorizar" y recibe el code+token = acceso a la cuenta. Súmese XSS reflejado en la consent page (`client_name`/`redirect_uri` sin escapar).
13. **Solana no redesplegado (P1)** — toda validación on-chain de Anchor está bloqueada; la cadena Solana es rebrand-incorrecta.
14. **Orquestador sin clave LLM real (P1)** — la planificación "IA" no opera (placeholder); cae a keyword.
15. **Concurrencia de sequence en Stellar (P1)** — pagos paralelos desde la misma custodial colisionan.
16. **Baseline E2E muerto (P1)** — `E2E_MCP_VALIDATION.md` apunta a Solana devnet + URLs Railway eliminadas; no re-ejecutable, hay que reescribirlo a Stellar.

### Supuestos

- El contrato Soroban **activo** es `CDYLMRS2...` con token XLM SAC `CDLZFC3SY...`, ya inicializado. El plan asume que este es el contrato a validar (no el stale).
- friendbot autofondea identidades de testnet nuevas (con riesgo de rate-limit por IP).
- La lógica del contrato (split, overflow-checks, ventana 300 s, `require_auth`) es **sólida**; el riesgo está en el wiring/repro/drift, no en el contrato.
- CI puede ejecutar `cargo test`, `node --test`/tsx, Vitest, supertest y (con servicios) Playwright/chrome-devtools MCP. Los `onchain`/`e2e` con fondos y los que requieren clave LLM corren en un job aparte, no en el CI por-PR.
- Exportar `app`/`server` en `backend/index.ts` y orchestrator es un refactor aceptable (bloqueante para la cobertura HTTP).

---

## 9. Orden de ejecución recomendado / próximos pasos

Estrategia: **primero lo barato-y-crítico (config + unit de dinero), luego integración con mocks, al final E2E on-chain con fondos.**

### Fase 0 — Lints de configuración y arreglos de 1 línea (horas, máximo ROI)
1. **Lint de contract ID** (`contracts-74`, `sdk-66`, `backend-56`, `integration-deploy-06/20`): grep de CI que falle si algo difiere de `STELLAR_CONTRACT_ID` de `.env`. Unificar al activo `CDYLMRS2...`.
2. **Completar `.env.example`** con `CHAIN`, `STELLAR_CONTRACT_ID`, `XLM_USD_RATE` (`integration-deploy-08`).
3. **Añadir `CHAIN`/`STELLAR_*` al bloque orchestrator del compose** (`orchestrator-41`).
4. **Arreglar `Billing.tsx`** (import `baseUnitsToUsd`) y **correr `tsc -b`/`vite build` en CI** antes de deploy (`frontend-dashboard-64/25`).
5. **Guard de arranque**: fallar si `CHAIN=stellar` sin `STELLAR_CONTRACT_ID` (`demo-agents-07`, `integration-deploy-07`).
6. **WWW-Authenticate** en el 402 del provider (`demo-agents-02`).

### Fase 1 — Unit de dinero y seguridad (días, 100 % CI)
7. **Aritmética del split y constantes** (`sdk-01/03`, `contracts-64`, `contracts-66`) + **fijar la dirección del fee** (`contracts-19`, decisión de producto).
8. **Borsh y builders del SDK** (`sdk-04..14`) y **añadirlos al script `test`** del package.
9. **Factory de selección de cadena** (`sdk-16..21`) con aislamiento de `process.env`.
10. **Autorización on-chain en sandbox** (`contracts-40..43`) con harness **sin `mock_all_auths`**.
11. **Anti-replay y estados terminales** (`contracts-24/25/28/30/35`, Anchor `52..57`).
12. **keypair-store fail-closed** (`sdk-67/68`).

### Fase 2 — Integración con red mockeada (días)
13. **Exportar `app` en backend/orchestrator** (`backend-58`) y montar **supertest + MSW**.
14. **Backend HTTP/WS/indexer** (`backend-01/05/06/10/11/14/23/33..36`), priorizando la **pérdida de catálogo por fallo RPC** (`backend-36`).
15. **Provider en modo cadena con mock `ChainClient`** (`sdk-43..49`) — escrow-not-found, anti-replay, underpayment, orden serve→claim.
16. **Orchestrator** (`orchestrator-01/35/37/38/41`) — health, fallo parcial, cap, config rota.
17. **maxPrice acota el quote** (`sdk-30`) — test que demuestre el sobrecobro y motive el fix.
18. **Frontends con Vitest+RTL+MSW** — dashboard money/sesión (`frontend-dashboard-01..33`) y catálogo de landing (`frontend-landing-12..19`), incluido el estado `indexedAgents=0` (`frontend-landing-17`).
19. **MCP money path con assert de auth header** (`mcp-server-17`) y **OAuth handshake contra stub** (`mcp-server-33`).

### Fase 3 — E2E on-chain con fondos (requiere testnet; job aparte)
20. **Registro on-chain de los 5 agentes** → `indexedAgents` 0→5 (`integration-deploy-09`, `demo-agents-04`). Desbloquea el resto.
21. **FLUJO-E2E-1** (x402 completo, canónico `integration-deploy-01`) con `STELLAR_CONTRACT_ID` activo.
22. **FLUJO-E2E-2** (split 95/5 por balances, `integration-deploy-02`) y **auth negativa on-chain** (`contracts-71`).
23. **Gateway virtual-cascade y wallet-direct** (`integration-deploy-04/05`) + **circuit breaker** (`integration-deploy-11`).
24. **Idempotencia/anti-replay on-chain** (`demo-agents-05`) y **refund** (`integration-deploy-10`).

### Fase 4 — Manual / UI / perf y deuda
25. **OAuth en IDE real** (`mcp-server-55`), **a11y + Lighthouse** de ambos frontends (`frontend-dashboard-60..63`, `frontend-landing-32/34`).
26. **Healthchecks en docker-compose** (`integration-deploy-12`) y **rebrand en runtime** (`integration-deploy-14`).
27. **Reescribir el baseline E2E** a Stellar (`integration-deploy-23`).
28. **Bloqueados hasta redeploy de Solana**: `contracts-57`, `sdk-57`, `frontend-landing-11`.

---

> **Resumen accionable:** la lógica del contrato es sólida; el peligro está en **configuración, wiring y ausencia total de tests en capas enteras** (backend HTTP/indexer, SDK chain/builders, orchestrator, frontends). Empezar por los lints de config y los arreglos de 1 línea (Fase 0) elimina los P0 que hacen que "un deploy roto se vea sano", y los unit de dinero (Fase 1) blindan el split/auth/replay sin necesitar fondos. Lo caro (E2E on-chain) se reserva para cuando el registro on-chain deje de estar vacío.
