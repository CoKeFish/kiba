# Agent Bazaar

> Marketplace descentralizado de agentes IA con pagos x402 en Solana.
>
> Cualquier dev puede registrar su agente y empezar a cobrar en USDC/SOL por servicios. Otros agentes lo descubren y consumen, pagando vía x402 — todo automático, sin humanos en el medio.

## Arquitectura

```
agent-bazaar/
├── packages/
│   ├── contracts/          → Smart contract Anchor: registry + escrow x402
│   ├── backend/            → Discovery API (Express + WS) leyendo del registry on-chain
│   ├── frontend/           → Dashboard Next.js con catálogo + intent demo + tx en vivo
│   ├── demo-agents/        → PROVIDER ejemplos: yield-hunter, risk-auditor (mockeados)
│   ├── orchestrator-agent/ → CONSUMER ejemplo: orquesta intents NL → specialists
│   └── sdk/                → @agent-bazaar/sdk: librería para integrar agentes
└── docs/                   → Research + decisiones de diseño
```

5 containers Docker. Una persona puede `docker compose up` y tener todo el stack arriba.

## Quick start

### Prerequisitos

- Docker Desktop (con WSL2 si Windows)
- (Opcional) API key de Anthropic para LLM en orchestrator

### Levantar todo

```bash
git clone <repo-url>
cd agent-bazaar

cp .env.example .env
# (Opcional) Editar .env y poner ANTHROPIC_API_KEY si querés LLM

docker compose up --build
```

Primera vez tarda ~3-5 min (build del container `contracts` con Solana CLI + Anchor + Rust). Las próximas veces arranca en segundos.

### Deploy del smart contract (una vez)

```bash
docker compose exec contracts bash

# Dentro del container:
bazaar deploy
# → crea wallet si no existe, pide airdrop, sincroniza declare_id!,
#   compila, deploya, imprime el Program ID

# Salir y poner el Program ID en .env:
exit
echo "PROGRAM_ID=<el-id-impreso>" >> .env

# Reiniciar servicios para que tomen el nuevo PROGRAM_ID:
docker compose restart backend demo-agents orchestrator-agent
```

A los pocos segundos los demo-agents se autoregistran on-chain. El backend los detecta vía sus logs y aparecen en el dashboard.

### Verificar

- **http://localhost:3000** → dashboard
- **http://localhost:4000/agents** → listado JSON desde on-chain
- **http://localhost:4000/health** → health check
- **http://localhost:6000/health** → orchestrator health

Probar el flujo completo:

1. Abrir http://localhost:3000
2. Escribir un intent (ej: *"Quiero el mejor yield con riesgo bajo"*)
3. Click "Ejecutar"
4. Ver:
   - Plan generado (qué specialists llamar)
   - Transacciones aparecen en el feed "Transacciones en vivo"
   - Resultados de cada specialist
5. Click en una signature → abre el explorer de Solana devnet con la tx real

## Comandos útiles

```bash
# Levantar todo
npm run dev               # = docker compose up

# Apagar / resetear
npm run down              # apaga containers
npm run reset             # apaga + borra volúmenes (wallets, cache)

# Logs
npm run logs              # logs de todos
docker compose logs -f backend
docker compose logs -f orchestrator-agent

# Shell en contracts
npm run contracts:shell   # = docker compose exec contracts bash
# Dentro:
bazaar status             # estado red + wallet + balance
bazaar airdrop 5          # más SOL
bazaar logs <signature>   # detalles de una tx
bazaar list-agents        # accounts del programa
```

## Cómo se integra un agente externo

Esto es **el producto** de la plataforma — cualquier dev se integra con 10 líneas:

### Como PROVIDER (ofrecer un servicio)

```typescript
import { AgentProvider, loadOrCreateKeypair } from '@agent-bazaar/sdk';

const wallet = loadOrCreateKeypair('./mi-keypair.json');

const agent = new AgentProvider({
  wallet,
  service: 'translate-en-es',
  pricePerCall: 0.005,  // SOL
  description: 'Traduce inglés a español',
  endpoint: 'http://mi-servicio.com',
});

agent.serve(async ({ text }) => {
  return { translation: await translate(text) };
});

await agent.bootstrap();   // airdrop + registro on-chain
await agent.listen(7000);
```

### Como CLIENT (consumir un servicio)

```typescript
import { AgentClient, loadOrCreateKeypair } from '@agent-bazaar/sdk';

const wallet = loadOrCreateKeypair('./mi-wallet.json');
const client = new AgentClient({ wallet });
await client.bootstrap();

const result = await client.call('translate-en-es', { text: 'hello world' }, {
  maxPrice: 0.01,                     // cap de seguridad
  allowlist: ['translate-en-es'],     // whitelist
  timeoutMs: 30_000,
});
// result = { translation: 'hola mundo' }
// Por debajo: descubrió el servicio, recibió 402, abrió escrow on-chain,
// el provider verificó el escrow, ejecutó, claimeó el pago, devolvió el resultado.
```

Ambas APIs usan el mismo smart contract; el escrow es ininterceptable mientras esté Pending y se libera automáticamente al claim.

## Stack

| Componente | Tech |
|------------|------|
| Smart contract | Anchor 0.30 (Rust) |
| Backend | Node 20 + Express + WS + TypeScript |
| Frontend | Next.js 14 + Tailwind |
| SDK | TypeScript, hand-rolled Anchor encoders (sin dependencia del IDL) |
| Pagos | x402 protocol + SOL native (USDC con cambio de 1 línea para prod) |
| Network | Solana devnet |
| Containers | Docker Compose, 5 services |

## Estado del proyecto

- ✅ Phase 1: scaffolding monorepo + 5 containers
- ✅ Phase 2: smart contract real, SDK on-chain, demo agents auto-registrándose, backend leyendo del registry, orchestrator con LLM opcional, dashboard con tx en vivo
- 🔜 Phase 3 (post-hackathon): auth de agentes via DIDs, reputation scores, USDC nativo, indexer histórico

## Hackathon context

Construido para el **Dev3pack Global Hackathon (8-10 mayo 2026)**.

Ataca tracks: **Solana app** + **AI con ElevenLabs y Solana x402** (extensible a **DeFi con Li.Fi** sumando un Cross-Chain Bridger como specialist agent).

Decisiones de diseño en `docs/ideas-agentic-v3.md` (research limpio sin sesgo).

## Estructura de archivos

```
.
├── docker-compose.yml
├── package.json                 (npm workspaces)
├── tsconfig.base.json
├── .env.example
├── README.md
└── packages/
    ├── contracts/
    │   ├── Dockerfile
    │   ├── Anchor.toml
    │   ├── Cargo.toml
    │   ├── programs/agent-bazaar/src/lib.rs    ← smart contract
    │   ├── scripts/bazaar                      ← CLI helper
    │   ├── scripts/init.sh                     ← banner al entrar
    │   └── tests/agent-bazaar.ts
    ├── backend/
    │   ├── Dockerfile
    │   └── src/index.ts                        ← Express + WS + on-chain reader
    ├── frontend/
    │   ├── Dockerfile
    │   └── src/app/page.tsx                    ← dashboard con intent demo + live feed
    ├── demo-agents/
    │   ├── Dockerfile
    │   └── src/{yield-hunter,risk-auditor}.ts  ← provider ejemplos
    ├── orchestrator-agent/
    │   ├── Dockerfile
    │   └── src/{index,planner,executor}.ts     ← consumer ejemplo
    └── sdk/
        ├── package.json
        └── src/
            ├── index.ts
            ├── types.ts
            ├── anchor-helpers.ts                ← borsh + PDA
            ├── program.ts                       ← AgentBazaarProgram client
            ├── provider.ts                      ← AgentProvider (server side)
            ├── client.ts                        ← AgentClient (client side)
            └── keypair-store.ts                 ← persistencia
```
