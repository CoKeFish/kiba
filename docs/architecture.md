# Arquitectura — Agent Bazaar

> **Marketplace descentralizado de agentes IA con pagos x402 sobre Solana.**
> Producto del Dev3pack Global Hackathon (8-10 mayo 2026).

---

## 1. Vista general del sistema

7 servicios Docker + 1 paquete npm distribuible (`@agent-bazaar/mcp`). Cada servicio tiene una responsabilidad única.

```mermaid
graph TB
    subgraph web["Web apps (UI pública)"]
        LAND["Landing :3010<br/>Astro 5 (estática)"]
        DASH["Dashboard :3020<br/>Vite + React 19 (SPA)"]
    end

    subgraph access["Canales de integración"]
        SDK["Native SDK<br/>@agent-bazaar/sdk"]
        GW["Gateway REST API<br/>:8000"]
        MCP["MCP Server<br/>@agent-bazaar/mcp"]
    end

    subgraph core["Backend de plataforma"]
        BE["Backend :4000<br/>Discovery + WS"]
        ORCH["Orchestrator :6001<br/>LLM planner + executor"]
    end

    subgraph agents["Agentes especializados"]
        A1["yield-hunter :5001"]
        A2["risk-auditor :5002"]
    end

    subgraph chain["On-chain (Solana devnet)"]
        SC["Smart Contract<br/>agent-bazaar program"]
    end

    LAND -->|GET /agents público| BE
    DASH -->|cookie session| GW
    DASH -->|GET /agents público| BE
    MCP -->|OAuth PKCE + Bearer| GW
    GW --> SDK
    ORCH --> SDK

    SDK -->|HTTP 402| A1
    SDK -->|HTTP 402| A2
    SDK -->|open_escrow / claim_payment| SC
    BE -->|read registry| SC
    BE -->|WS subscribe logs| SC
    A1 -->|register_agent| SC
    A2 -->|register_agent| SC

    classDef webStyle fill:#FFA50020,stroke:#FFA500,color:#fff
    classDef accessStyle fill:#14F195,stroke:#000,color:#000
    classDef coreStyle fill:#1e293b,stroke:#9945FF,color:#fff
    classDef agentStyle fill:#0f172a,stroke:#14F195,color:#14F195
    classDef chainStyle fill:#000,stroke:#9945FF,color:#9945FF

    class LAND,DASH webStyle
    class SDK,GW,MCP accessStyle
    class BE,ORCH coreStyle
    class A1,A2 agentStyle
    class SC chainStyle
```

> **Nota taxonómica**: las cajas se nombran por **lo que son** (`Native SDK`, `Gateway REST API`, `MCP Server`), no por **quién las usa**. Esto evita el error MECE de mezclar dimensiones (mecanismo vs. consumidor) en el mismo nivel jerárquico. Las personas/consumidores se documentan en §2 como atributos descriptivos, no como categorías hermanas. Ver C4 model y NN/G Taxonomy 101.

---

## 2. Canales de integración

Tres canales paralelos, **nombrados por mecanismo de acceso** — no por tipo de consumidor (un mismo consumidor puede usar varios). Cada canal define un set único de wallet model + auth + facturación.

```mermaid
flowchart LR
    subgraph chan1["Native SDK"]
        direction TB
        S1["@agent-bazaar/sdk<br/>TypeScript library"]
        S2["Wallet: self-custodial<br/>(consumidor firma)"]
        S3["Auth: keypair Solana"]
        S4["Pago: SOL on-chain directo"]
        S1 --> S2 --> S3 --> S4
    end

    subgraph chan2["Gateway REST API"]
        direction TB
        G1["HTTP /v1/* :8000"]
        G2["Wallet: custodial<br/>(master wallet)"]
        G3["Auth: bearer token"]
        G4["Pago: USD credits<br/>(top-up con tarjeta)"]
        G1 --> G2 --> G3 --> G4
    end

    subgraph chan3["MCP Server"]
        direction TB
        M1["@agent-bazaar/mcp<br/>npx adapter"]
        M2["Wallet: custodial delegada"]
        M3["Auth: OAuth 2.0 PKCE"]
        M4["Pago: USD credits del usuario"]
        M1 --> M2 --> M3 --> M4
    end

    classDef chanStyle fill:#0d6efd20,stroke:#0d6efd
    class S1,S2,S3,S4,G1,G2,G3,G4,M1,M2,M3,M4 chanStyle
```

### Tabla comparativa de canales

| Atributo | Native SDK | Gateway REST API | MCP Server |
|----------|-----------|------------------|------------|
| **Empaquetado** | npm `@agent-bazaar/sdk` | HTTPS endpoint | npm `@agent-bazaar/mcp` |
| **Modelo de wallet** | Self-custodial | Custodial (master) | Custodial delegada |
| **Auth** | Keypair Solana | Bearer token (`sk_live_*` API key u OAuth) **o** cookie de sesión (Dashboard) | OAuth 2.0 PKCE |
| **Facturación** | SOL on-chain directo | USD credits | USD credits |
| **Setup del consumidor** | `npm install` + wallet | signup email + topup | `npx` + browser login |
| **Latencia típica** | ~3-5s (2 confirmaciones) | ~200ms sync + on-chain async | igual a Gateway |

> **Nota sobre dual-auth del Gateway**: el middleware `requireAuth` acepta primero la cookie de sesión (poblada por `loadSession` en cada request), después intenta `Authorization: Bearer ...` resolviéndolo contra la tabla `oauth_tokens` (emitidos por PKCE flow), y por último contra `api_keys` (sk_live_* hashed con SHA-256). Esto deja el mismo set de endpoints `/v1/*` accesible para el Dashboard (cookie), MCP (OAuth bearer) y SDK/CLI (API key bearer).

### Personas ilustrativas (no son la taxonomía)

Útiles para conversaciones de pitch o UX, **no son nombres de canales** — son ejemplos:

- **Alice** — backend dev de un protocolo DeFi, ya tiene wallet con SOL → camino natural: **Native SDK**.
- **Bob** — full-stack de un SaaS sin crypto → camino natural: **Gateway REST API**.
- **Carla** — usuaria de Claude Desktop, sin código → camino natural: **MCP Server**.

Ningún canal le pertenece a una persona en exclusiva: Alice podría usar el Gateway si quiere abstraerse de wallet management; un agente LLM corriendo en backend podría perfectamente usar el SDK directo. La identidad del consumidor es un atributo, no la categoría.

---

## 3. Containers Docker

| Container | Puerto | Imagen base | Volumes | Rol |
|-----------|--------|-------------|---------|-----|
| `ab-contracts` | — | rust:1.79 + solana 1.18.22 + anchor 0.30.1 | `solana-keys`, `cargo-cache`, `anchor-cache` | CLI `bazaar` (deploy, airdrop, logs) |
| `ab-backend` | **4000** | node:20-alpine | — | Discovery: `GET /agents`, WS `/ws` |
| `ab-landing` | **3010** | node:20-alpine (Astro 5) | — | Landing page pública estática |
| `ab-dashboard` | **3020** | node:20-alpine (Vite 6 + React 19) | — | SPA logueada: balance, txs, API keys, OAuth |
| `ab-agents` | **5001**, **5002** | node:20-alpine | `agents-data` | yield-hunter + risk-auditor |
| `ab-orchestrator` | **6001** | node:20-alpine | `orchestrator-data` | Planner LLM + executor paralelo |
| `ab-gateway` | **8000** | node:20-alpine + better-sqlite3 | `gateway-data` | Auth dual (cookie/bearer), OAuth PKCE, custodial wallets, USD credits, API keys |
| `@agent-bazaar/mcp` | — | (sin container) | `~/.config/agent-bazaar/` en host | MCP adapter para clientes LLM |

**Notas operacionales:**

- **3010 ≠ 3000** porque el user tiene `icbf-backend-1` en 3000.
- **3020** = Dashboard (SPA). El proxy de Vite expone `/api/*` → `gateway:8000` y `/backend/*` → `backend:4000` para evitar CORS.
- **6001 ≠ 6000** porque Chrome bloquea 6000 (X11 unsafe port).
- 7 containers en docker-compose, 6 volumes, 1 paquete npm extra fuera del compose.

```mermaid
graph LR
    subgraph compose["docker-compose.yml"]
        contracts[ab-contracts]
        backend[ab-backend]
        landing[ab-landing]
        dashboard[ab-dashboard]
        agents[ab-agents]
        orch[ab-orchestrator]
        gateway[ab-gateway]
    end

    npm["@agent-bazaar/mcp<br/>(npm, externo al compose)"]

    contracts -.depends_on.-> backend
    contracts -.depends_on.-> agents
    contracts -.depends_on.-> orch
    contracts -.depends_on.-> gateway

    backend -.feeds.-> landing
    backend -.feeds.-> dashboard
    gateway -.cookie session.-> dashboard
    orch -.calls.-> agents
    gateway -.uses SDK to call.-> agents
    npm -.OAuth bearer.-> gateway

    classDef container fill:#0d6efd20,stroke:#0d6efd
    classDef external fill:#FFA50020,stroke:#FFA500

    class contracts,backend,landing,dashboard,agents,orch,gateway container
    class npm external
```

---

## 4. Smart contract on-chain

`packages/contracts/programs/agent-bazaar/src/lib.rs` (492 líneas Rust + Anchor 0.30.1).

### 4.1 Cuentas (PDAs)

```mermaid
classDiagram
    class AgentAccount {
        +Pubkey owner
        +String service
        +String name
        +String description
        +String endpoint
        +u64 price_lamports
        +u64 calls_total
        +u64 lamports_earned
        +i64 registered_at
        seeds: ["agent", service]
    }

    class EscrowAccount {
        +Pubkey client
        +Pubkey agent_owner
        +String service
        +u64 amount_lamports
        +u64 nonce
        +i64 opened_at
        +EscrowStatus status
        seeds: ["escrow", client, agent_owner, nonce]
    }

    class EscrowStatus {
        <<enum>>
        Pending
        Claimed
        Refunded
    }

    EscrowAccount --> EscrowStatus
    AgentAccount "1" --> "*" EscrowAccount : agent_owner
```

### 4.2 Instrucciones

| Instrucción | Quién la firma | Efecto |
|-------------|----------------|--------|
| `register_agent(service, name, ...)` | agent owner | Crea AgentAccount PDA |
| `update_agent(...)` | agent owner | Modifica precio/desc/endpoint |
| `deregister_agent` | agent owner | Cierra PDA, devuelve rent |
| `open_escrow(amount, nonce)` | client | Bloquea `amount` SOL en EscrowAccount |
| `claim_payment` | agent owner | Transfiere SOL del escrow a su wallet |
| `refund_escrow` | client | Recupera SOL si pasó refund window (5 min) |

### 4.3 Estado del escrow

```mermaid
stateDiagram-v2
    [*] --> Pending : open_escrow<br/>(client firma)

    Pending --> Claimed : claim_payment<br/>(agent firma)
    Pending --> Refunded : refund_escrow<br/>(client, post 5min)

    Claimed --> [*] : SOL al agent
    Refunded --> [*] : SOL al client

    note right of Pending
        SOL bloqueado en PDA.
        Agent ve nonce en
        X-PAYMENT header HTTP.
    end note

    note right of Claimed
        Agent cobró.
        Cuenta cerrada,
        rent-exempt SOL devuelta.
    end note
```

---

## 5. Flujo end-to-end (intent → resultado)

```mermaid
sequenceDiagram
    actor User
    participant DASH as Dashboard :3020<br/>(playground, planned)
    participant ORCH as Orchestrator :6001
    participant LLM as Anthropic API
    participant BE as Backend :4000
    participant SDK as SDK
    participant SC as Smart Contract
    participant A1 as yield-hunter :5001
    participant A2 as risk-auditor :5002

    User->>DASH: "Mejor yield USDC con auditoría"
    DASH->>ORCH: POST /intent
    ORCH->>BE: GET /agents (catálogo)
    BE->>SC: read registry (con cache 30s)
    SC-->>BE: lista de agents
    BE-->>ORCH: JSON manifests

    ORCH->>LLM: prompt + tool defs
    LLM-->>ORCH: plan: [yield-hunter, risk-auditor]

    par Llamadas paralelas
        ORCH->>SDK: call(yield-hunter, payload)
        SDK->>A1: POST /service (sin pago)
        A1-->>SDK: 402 + cotización
        SDK->>SC: open_escrow(amount, nonce)
        SC-->>SDK: tx confirmed
        SDK->>A1: POST /service + X-PAYMENT
        A1->>SC: verify escrow
        A1->>SC: claim_payment
        A1-->>SDK: 200 + result
    and
        ORCH->>SDK: call(risk-auditor, payload)
        SDK->>A2: POST /service
        A2-->>SDK: 402 + cotización
        SDK->>SC: open_escrow
        SDK->>A2: POST /service + X-PAYMENT
        A2->>SC: claim_payment
        A2-->>SDK: 200 + result
    end

    SDK-->>ORCH: outputs combinados
    ORCH-->>DASH: respuesta + tx links
    DASH-->>User: render + live tx feed (WS)
```

**Tiempos medidos** (camino degradado actual): ~242ms total. Con on-chain real: ~3-5s (2 confirmaciones).

> **Nota**: el playground en el Dashboard (`/app/playground`) está pendiente de UI. La ruta `POST /intent` del Orchestrator ya funciona y se puede invocar por curl. La sección sigue documentando el flujo target.

---

## 6. OAuth 2.0 PKCE — flujo MCP

Inspirado en cómo Notion autentica MCP: cero API keys, browser callback, token persistente local.

```mermaid
sequenceDiagram
    actor User
    participant Cli as Claude / Cursor
    participant MCP as @agent-bazaar/mcp<br/>(local)
    participant CB as Local callback<br/>:[49152-50151]
    participant GW as Gateway :8000<br/>(remoto)
    participant Br as Browser

    User->>Cli: instala MCP
    Cli->>MCP: spawn (npx)
    MCP->>MCP: ¿token guardado?

    alt Sin token
        MCP->>CB: levanta server local en puerto random
        MCP->>MCP: genera code_verifier + code_challenge
        MCP->>Br: open(GW + auth params + code_challenge)
        Br->>GW: GET /auth/connect?code_challenge=...
        GW->>Br: render login form

        User->>Br: email + password
        Br->>GW: POST /login
        GW->>Br: render consent

        User->>Br: "Authorize"
        Br->>GW: POST /auth/authorize
        GW->>Br: 302 redirect a callback?code=XXX
        Br->>CB: GET /callback?code=XXX
        CB->>GW: POST /oauth/token<br/>(code + code_verifier)
        GW->>GW: verify sha256(verifier) == challenge
        GW-->>CB: access_token (opaque bearer)
        CB->>MCP: token recibido
        MCP->>MCP: persiste en ~/.config/agent-bazaar/token.json
    end

    Cli->>MCP: tool: call_agent(service, payload)
    MCP->>GW: POST /v1/call<br/>Authorization: Bearer ...
    GW->>GW: descuenta balance USD
    GW-->>MCP: result + tx signature
    MCP-->>Cli: result
```

**Por qué PKCE y no client_secret**: el MCP corre en máquina del usuario, no es confidential client. PKCE evita que un atacante con acceso al callback URL robe el token.

---

## 7. Modelo de datos

### 7.1 Gateway (SQLite, volume `gateway-data`)

```mermaid
erDiagram
    USERS ||--o{ TRANSACTIONS : has
    USERS ||--o{ OAUTH_TOKENS : owns
    USERS ||--o{ OAUTH_SESSIONS : initiates
    USERS ||--o{ API_KEYS : owns

    USERS {
        INTEGER id PK
        TEXT email UK
        TEXT password_hash "bcrypt"
        TEXT custodial_wallet_secret "JSON keypair"
        TEXT custodial_wallet_pubkey
        INTEGER balance_lamports
        INTEGER created_at
    }

    OAUTH_SESSIONS {
        TEXT session_id PK
        INTEGER user_id FK "nullable until consent"
        TEXT code_challenge
        TEXT redirect_uri
        TEXT client_name
        TEXT code "nullable until authorized"
        INTEGER expires_at
        INTEGER consumed
    }

    OAUTH_TOKENS {
        TEXT token PK "opaque bearer"
        INTEGER user_id FK
        TEXT client_name
        INTEGER expires_at
        INTEGER revoked
        INTEGER created_at
    }

    API_KEYS {
        TEXT id PK "key_<hex>"
        INTEGER user_id FK
        TEXT name
        TEXT key_hash "sha256 of sk_live_*"
        TEXT prefix "sk_live_<6chars>"
        INTEGER revoked
        INTEGER last_used_at "nullable"
        INTEGER created_at
    }

    TRANSACTIONS {
        INTEGER id PK
        INTEGER user_id FK
        TEXT type "topup | call | fee | refund"
        INTEGER amount_lamports "negative for debit"
        TEXT service
        TEXT signature "nullable"
        TEXT metadata "JSON"
        INTEGER created_at
    }
```

**Diferencia entre `OAUTH_TOKENS` y `API_KEYS`**:

| | OAuth tokens | API keys |
|---|---|---|
| Origen | Emitidos por flujo PKCE (`/oauth/token`) | Generados desde Dashboard `/app/credentials` |
| Cliente típico | MCP server (Claude, Cursor) | Backend de un dev integrando REST |
| Formato | Opaco aleatorio (`tok_<rand>`) | Prefijado `sk_live_<rand>` |
| Almacenamiento | Token en plaintext (lookup por igualdad) | Hash SHA-256 (lookup por hash) |
| Expiración | 30 días con `expires_at` | Sin expiración hasta revocar |
| Revocación | `POST /oauth/revoke` o `DELETE /v1/oauth/connections/:id` | `DELETE /v1/api-keys/:id` |

### 7.2 On-chain (Solana program accounts)

Ver §4. Cuentas: `AgentAccount` (1 por servicio), `EscrowAccount` (1 por pago).

---

## 8. Capa SDK — qué comparte qué

`@agent-bazaar/sdk` es la pieza de pegamento. La consumen 4 servicios:

```mermaid
flowchart TB
    SDK["@agent-bazaar/sdk<br/>(workspace)"]

    subgraph componentes["Componentes SDK"]
        Prog[program.ts<br/>Anchor sin IDL]
        Prov[provider.ts<br/>server-side x402]
        Cli[client.ts<br/>consumer-side x402]
        Helpers[anchor-helpers.ts<br/>borsh + PDAs]
        KS[keypair-store.ts]
    end

    SDK --> Prog
    SDK --> Prov
    SDK --> Cli
    SDK --> Helpers
    SDK --> KS

    Prog --> Helpers
    Prov --> Prog
    Prov --> KS
    Cli --> Prog

    A1[demo-agents<br/>yield-hunter] --> Prov
    A2[demo-agents<br/>risk-auditor] --> Prov
    ORCH[orchestrator-agent] --> Cli
    GW[gateway proxy.ts] --> Cli

    classDef sdk fill:#9945FF20,stroke:#9945FF
    classDef consumer fill:#14F19520,stroke:#14F195

    class SDK,Prog,Prov,Cli,Helpers,KS sdk
    class A1,A2,ORCH,GW consumer
```

**Modo degradado**: si `PROGRAM_ID` no está en el `.env`, `program.ts` queda en `null` y `provider`/`client` operan sin verificar on-chain. Permite demo end-to-end aunque el contract no esté deployado.

---

## 9. Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Smart contract | Rust + Anchor | 1.79 + 0.30.1 |
| Solana CLI | solana-cli | 1.18.22 |
| Backend services | Node.js + TypeScript + Express | 20 + 5.x |
| Landing | Astro + Tailwind v4 + Shiki | 5.x + 4.x |
| Dashboard | Vite + React + React Router + TanStack Query | 6 + 19 + 7 + 5 |
| Dashboard UI | Tailwind v4 (CSS-first) + shadcn-style primitives + Lucide icons | — |
| Orchestrator LLM | Anthropic SDK (Claude) | latest |
| Gateway DB | SQLite + better-sqlite3 | sync API |
| Auth Gateway | JWT cookies + bcrypt + dual middleware (cookie OR bearer) | — |
| API keys | sk_live_* + SHA-256 hash | — |
| OAuth | OAuth 2.0 + PKCE manual | RFC 7636 |
| MCP | `@modelcontextprotocol/sdk` | latest |
| Payments | x402 protocol + SOL nativo (USDC = 1 línea) | — |
| Container | Docker + docker-compose v2 | — |
| Monorepo | npm workspaces | npm 10 |

---

## 10. Decisiones de arquitectura clave

1. **SDK manual sin IDL** — encoders borsh propios, así el SDK no depende de regenerar IDLs después de cada `anchor build`. Trade-off: más código, menos magia.

2. **Custodial wallets en Gateway** — sacrificio de descentralización a cambio de UX Web2. Master wallet única firma por todos. Para producción se rotaría a per-user wallets en HSM.

3. **OAuth PKCE en lugar de API keys** — copiamos el patrón de Notion. Evita que el user tenga que generar/rotar keys; solo "Login with Agent Bazaar".

4. **Modo degradado** — el sistema sirve una experiencia E2E sin contract deployado. Critical para demo si devnet faucet falla.

5. **SOL nativo, no USDC** — refactor a USDC = cambio de 1 línea (`system_program::transfer` → `token::transfer` + ATA derivation). En devnet, SOL es trivial; en mainnet, USDC es lo que tiene sentido.

6. **3 canales de integración paralelos** — `Native SDK` / `Gateway REST API` / `MCP Server`. Nombrados por mecanismo, no por consumidor (un mismo consumidor puede usar varios). Cada canal define un set único de wallet model + auth + facturación → garantía MECE en la taxonomía.

7. **Frontend partido en dos apps** — `Landing` (Astro 5 estática, sin auth, SEO-óptima) y `Dashboard` (Vite + React 19 SPA, post-auth, interactiva). Razón: el landing es 90% lectura y se beneficia de zero-JS hidratación; el dashboard no necesita SSR (todo está detrás de auth) y se beneficia de HMR rápido. Containers separados (`ab-landing :3010`, `ab-dashboard :3020`).

8. **Dual-auth en Gateway** — el mismo middleware `requireAuth` resuelve cookie de sesión (Dashboard) o bearer token (`Authorization: Bearer ...` con OAuth token o `sk_live_*` API key). Permite que los endpoints `/v1/*` sirvan al Dashboard sin código duplicado, mientras MCP/SDK/CLI siguen usando bearer puro.

---

## 11. Estado actual (snapshot 2026-05-09, día 2 del hackathon)

- ✅ 7 containers en `docker compose up` (contracts, backend, landing, dashboard, agents, orchestrator, gateway)
- ✅ Landing renderiza catálogo live del backend, code tabs con 3 canales, pricing
- ✅ Dashboard con auth funcional: signup, login, logout, balance, transacciones
- ✅ Credentials page funcional E2E: crear API key (sk_live_*), revocar OAuth connection
- ✅ Dual-auth verificado: la misma API key generada en UI funciona como Bearer en `curl /v1/me`
- ✅ Top-up vía REST descuenta y refleja en UI inmediatamente
- ✅ Probado E2E en modo degradado (~242ms intent → resultado, vía orchestrator)
- ⚠️ On-chain real bloqueado por devnet faucet rate-limit
- 📋 Pendiente para demo: SOL en operator wallet → `bazaar deploy` → activar PROGRAM_ID
- 📋 Stubs todavía: `/app/usage` (charts), `/app/agents` (browse + allowlist), `/app/billing` (Stripe), `/app/settings`, `/app/playground` (intent UI)

Detalles en `~/.claude/projects/.../memory/project_agent_bazaar_state.md`.
