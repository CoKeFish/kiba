# Outputs crudos v1 — 8 agentes de investigación de ideas

> ⚠️ **Esta es la ronda v1 con prompts SESGADOS.** Los prompts mencionaban explícitamente ElevenLabs, Li.Fi y x402 como tracks/sponsors → los agentes orbitaron alrededor de esos nombres. La síntesis v1 (preservada en `ideas-agentic-v1-biased.md`) refleja ese sesgo.
>
> v2 con prompts neutros corre en paralelo — outputs en `agent-outputs-v2.md` cuando esté lista.

---

## Agente 1 — SendAI Ideas (ideas.sendai.fun)

**Fuente:** API endpoint `https://ideas.sendai.fun/api/ideas` (36 ideas crudas, categorías originales: "Agent Infra", "DeFi/Token Tooling/Trading Agents", "Social and Chat Agents"). Filtró ideas que requieren zkML, DePIN propietario, on-chain inference o datasets entrenados.

**12 ideas curadas:**

1. **AI Agent Telegram Prediction Markets** — Bot Telegram convierte apuestas amistosas en wagers USDC, verifica con Perplexity, paga automáticamente. Track 3. Med. ElevenLabs como "bookie".
2. **Perplexity for Solana Actions (Chat Wallet Agent)** — Chat wallet embedded lee Birdeye/DexScreener, ejecuta swaps por NL ("compra $20 BONK"). Track 3 o 1. Med. Solana Agent Kit cubre 80%.
3. **AI Cross-Chain Concierge (Li.Fi bounty)** — Agente conversacional recibe intent, orquesta bridge+swap óptimo via Li.Fi SDK. Track 4 + bounty $1K. Med-High.
4. **Yield Optimization Bot** — Monitorea Kamino/MarginFi/Drift, reasigna al APY óptimo autónomamente. Track 4. Med. APIs públicas.
5. **AI Voice Co-Host Twitter Spaces / Podcasts** — ElevenLabs resume Spaces en tiempo real, responde FAQ, publica thread. Track 3. Med.
6. **Social Trading Agent con Trust Score** — Escucha calls TG/Twitter, rankea autores por track on-chain, ejecuta trades top voices. Track 1 o 4. Med-High.
7. **DAO Participation Agent** — Monitorea Realms/Squads, resume con NLP, recomienda voto, ejecuta. Track 1. Low-Med. Realms API públicas.
8. **Solana Mobile AI Wallet Companion** — App Solana Mobile con voz que confirma tx, explica riesgos pre-firma, previene scams. Track 2. High. Único proyecto mobile+IA.
9. **Memecoin Screener con Agente Ejecutor** — Filtro Birdeye + agente compra/vende según strategy ("buy si LP locked + holders >500 + age <24h"). Track 1 o 4. Med.
10. **AI Shopping Companion con x402** — Agente recibe "necesito X", busca on-chain merchants, paga USDC via x402. Track 3. Med-High.
11. **AI GitHub Helper en Discord** — Bot devs Solana: FAQ del repo, onboarding, resúmenes PRs. Track 1. Low. APIs gratis.
12. **Multi-Agent "Jedi Council" Strategy Feedback** — Panel 3-5 agentes (CFO, CTO, marketer, UX) debaten y devuelven recomendación colectiva. Tip-to-vote USDC. Track 1 o 3. Med.

**Top-3 del agente:** #1, #3 (Li.Fi bounty), #5.

---

## Agente 2 — Awesome Solana AI repo

**Fuente:** github.com/solana-foundation/awesome-solana-ai

**Categorías del repo:** AI Coding Skills (general/DeFi/infra), AI Agents (Solana Agent Kit 30+ protocolos, Eliza, GOAT, Breeze, SP3ND, OpenDexter, Solentic, MoonPay CLI, SAID/Sentients), Developer Tools/MCP (Solana Developer MCP, DFlow MCP, Deside MCP, QuickNode MCP, x402-proxy, SLO, LumoKit, Trident Arena, surfpool), Learning, Cross-chain/pagos.

**8 ideas:**

1. **VoiceVault DeFi Concierge** — Solana Agent Kit + jupiter-skill + lulo-skill + ElevenLabs + x402-proxy. Concierge voz español, swaps Jupiter, deposits Lulo, x402 para premium. Track 3. Med.
2. **PocketAgent Mobile (Android)** — Phantom Connect + SAK + Deside MCP + ElevenLabs. App móvil firma vía embedded wallet, comunica wallet-to-wallet via Deside. Track Mobile + AI. Med-High.
3. **RoboPay: Robot que cobra por servicios físicos** — Quicknode x402 + agentic-gateway + SAK + ElevenLabs. Robot Pi/ROS ofrece tareas, exige micropago x402. Track Robotics + x402. High (hardware).
4. **CrossChain Yield Hunter Agent** — debridge-skill + breeze-agent-kit + Li.Fi + Pyth. Escanea APYs cross-chain, bridges, deposita. Track Li.Fi advanced. High.
5. **ProofOfVoice: Verified AI Agent Identity** — SLO + Light Protocol + ElevenLabs voice cloning. Huella vocal ZK on-chain via Light. Anti-deepfake comercio agéntico. Track 3. Med-High.
6. **AgentMart x402 Marketplace** — OpenDexter + x402-proxy + Solana Developer MCP + SP3ND. Marketplace donde agentes consumen APIs cobradas en USDC vía x402. Track 3. Med (gran demo).
7. **SafeSwap Mobile con Voice Confirmation** — Phantom Connect + jupiter + Switchboard VRF + ElevenLabs. App contra rug-pulls, lee resumen de riesgo en voz. Track Mobile + AI. Med.
8. **RoboArm Anchor Trainer** — solana-anchor-claude-skill + game-skill + brazo robótico + Pyth. Brazo gira si BTC sube, registra Anchor. Track Robotics + Solana app. High.

**Gaps detectados:**
- No hay skill nativo Li.Fi (solo deBridge)
- Cero recursos en español/LATAM
- Robotics: cero skills físicos
- ElevenLabs no aparece en NINGUNA skill del repo (gap blanco)
- Identidad biométrica de agente: SAID/Sentients tocan identidad pero no biometría/voz
- MCP educativo: no hay para enseñar Solana
- Mobile + agente nativo voz
- Robotics + x402: zona blanca total

---

## Agente 3 — NoahAI + solana.new (vibe coding tools)

**Fuentes:** trynoah.ai, www.solana.new

**Resumen:**
- **Noah AI V2:** No-code, prompt → dApp Solana desplegada (contratos + frontend). Incluye NoahAI Agent colaborativo, x402 nativos, blueprints (Raydium, Jupiter, CoinGecko, Metaplex)
- **Solana.new:** Toolkit codegen agéntico, instala via curl, carga 100+ skills/MCPs/CLIs en Claude/Codex. NO no-code: scaffolding+context para tu IDE-agente. Integra Jupiter, Helius, Meteora, Pump.Fun, Sanctum, Kamino, Orca, Birdeye, Phantom, Privy, Dflow
- **Diferencia:** Noah = output (app desplegada, fricción cero, menos custom); Solana.new = input (skills/MCPs cargados en tu agente)
- **SAK MCP** (Solana.new): expone 60+ ops onchain ejecutables por LLM
- **Solana.new** tiene 500+ ideas pre-cargadas YC/Alliance/Superteam + GTM

**8 ideas:**

1. **VozPay x402** — Noah V2 x402 nativo + ElevenLabs MCP. Asistente voz cobra micropagos x402 por respuesta. Track 3. Med.
2. **DeFi Copilot móvil** — SAK MCP (60+ ops) + Phantom skill. App Saga, voz ejecuta swaps Jupiter/stakes Kamino/bridges Li.Fi sin abrir UI. Track Mobile + DeFi Li.Fi. Alta.
3. **AuditBot agente** — Solana.new "AI audit + smart contract testing" skill. Agente recibe repo Anchor, itera fixes hasta pasar tests, publica reporte onchain. Track 1. Med.
4. **Pitch-to-Pump** — Solana.new ideation 500+ + Pump.Fun skill + GTM codegen. Usuario describe meme, agente lanza token + thread X + landing. Track 1. Baja.
5. **Robot-Wallet bridge** — SAK MCP + custom MCP handler. Robot ROS expone sensores como MCP tool, agente Claude paga onchain (x402) cuando completa tareas. Track Robotics + x402. Alta.
6. **NFT-from-prompt mobile** — Noah Metaplex blueprint + Solana mobile. Foto + voz → colección NFT minteable. Track Mobile. Baja.
7. **Li.Fi Strategy Agent** — Helius+Birdeye+Meteora skills + Li.Fi. Agente monitoriza yields cross-chain, propone rebalanceos, ejecuta vía SAK. Track Li.Fi advanced. Alta.
8. **VoiceTrade x402 marketplace** — Noah x402 + ElevenLabs + Jupiter blueprint. Marketplace señales de voz, x402 por escuchar, swap auto vía Jupiter. Track 3. Med.

**Recomendación agente:** #1 o #4 (codegen agéntico al máximo, demo-friendly).

---

## Agente 4 — Solana Skills directories

**Fuentes:** solanaskills.com, solana.com/skills, github.com/solana-foundation/solana-dev-skill

**Top 15 skills disponibles:**

| # | Skill | Acciones |
|---|-------|----------|
| 1 | Jupiter | Ultra swaps, limit orders, DCA, perps, lending |
| 2 | Sanctum | Liquid staking + LST swaps + Infinity pools |
| 3 | Metaplex | Mint NFTs (Core, Token Metadata, Candy Machine, Bubblegum cNFTs) |
| 4 | Kamino | Lending, borrowing, liquidity vaults |
| 5 | MarginFi/Lulo | Lending agregador |
| 6 | Meteora | DLMM + DAMM pools + bonding curves |
| 7 | Raydium/Orca | AMM, CLMM, token launches |
| 8 | PumpFun | Token launches con bonding curve |
| 9 | Ranger Finance | Perps agregador (Drift, Flash, Adrena, Jupiter) |
| 10 | Pyth/Switchboard | Price feeds + VRF |
| 11 | Helius | RPC, DAS API, webhooks, priority fees |
| 12 | Light Protocol | ZK Compression + compressed airdrops |
| 13 | MagicBlock | Ephemeral Rollups (latencia ms) |
| 14 | Squads | Multisig + account abstraction |
| 15 | deBridge/Li.Fi | Cross-chain swaps + message passing |
| + | SAK | 60+ acciones unificadas |
| + | Arcium | MPC privacy |

**7 ideas (combinando 2+ skills):**

1. **VozStake** — ElevenLabs + Sanctum + Jupiter + Helius. Voz español "stakea 2 SOL en mejor APY" → JupSOL/sSOL. Track 3. Med.
2. **YieldRouter** — Li.Fi + Lulo + Kamino + MarginFi + Pyth. Cumple ambos del track más difícil. Track Li.Fi advanced. Alta.
3. **MintTalk** — Metaplex (Core/Bubblegum) + Light Protocol + ElevenLabs. Voz → cNFT comprimido + Blink. Track 3. Baja-Med.
4. **MoboBot Mobile DeFi Copilot (Seeker)** — Jupiter + Sanctum + Squads + Mobile Wallet Adapter. Track Mobile. Med.
5. **RoboPay** — MagicBlock Ephemeral Rollups + x402 + Pyth + Solana Pay. Robot ESP32, microtransacciones liquidación ms. Track Robotics. Alta.
6. **VoiceTrader Perps** — Ranger Finance + ElevenLabs + Pyth + x402. "Abre long 5x SOL si Pyth marca soporte". Track 3. Med-Alta.
7. **CampusDAO** — Squads + Jupiter + Lulo + Helius webhooks. Multisig Javeriana, agente propone rebalanceos becas, 2/3 firma humana. Track 1. Med. Narrativa local.

---

## Agente 5 — Colosseum Agent Hackathon Projects

**Fuente:** colosseum.com/agent-hackathon/projects

**Top 5 categorías de proyectos:**

| # | Categoría | % | Ejemplos |
|---|-----------|----|----------|
| 1 | Autonomous Traders / DeFi Bots | ~30% | Super Molt, SIDEX, Trading Lobster, Cleopetra, Voltr, Plutus, Sentry Agent Economy |
| 2 | Monitoring & On-chain Intelligence Swarms | ~20% | Eremos, AgentDEX/Validator Intelligence, Kamino/Marginfi monitor, Pine Analytics |
| 3 | Agent Tooling/Infra (x402, APIs) | ~20% | AgentDEX, Clodds (Compute API x402), AuditSwarm, MCPay |
| 4 | Verifiability & Safety Firewalls | ~15% | SOLPRISM (commit-reveal), BlinkGuard (Action firewall), AuditSwarm compliance |
| 5 | Agent Gaming & Social Arenas | ~15% | SolArena, Signal Wars, Clankr, SEND Arcade Blinks |

**10 ideas derivadas:**

1. **BlinkShield Mobile** — Inspirada *BlinkGuard*. App Solana Mobile escanea Blink, simula tx, narra riesgos voz. Track 2 + 3. Med. BlinkGuard es web/desktop CT-power-users; este voice-first mobile no-tech.
2. **LiFi Whisperer** — Inspirada *Neur* + *AgentDEX*. Voz español/inglés rutea cross-chain con Li.Fi, trade-offs en audio, x402 por ruta óptima. Track 4 + 3 + bounty $1K. Med-Alta.
3. **PoolSentinel** — Inspirada *Cleopetra* + Kamino/Marginfi monitor. Monitor LP en Raydium/Orca, alertas WhatsApp/TG con audio cuando salud cae. Track 3 o 4. Med.
4. **ReasonReceipt** — Inspirada *SOLPRISM*. SDK ligero hashea razonamiento agente pre-acción, "recibo verificable". Track 1 + componente x402 premium. Med.
5. **ArenaVoice** — Inspirada *SolArena* + *Signal Wars*. Mini-juego mobile, agente personal pelea por voz contra otros (RPS/trivia), micro-apuestas SOL, narración ElevenLabs. Track 2 + 3. Med.
6. **AuditBee Lite** — Inspirada *AuditSwarm*. Escanea 100 tx wallet, genera PDF tax-friendly Colombia/LATAM, 0.5 USDC via x402. Track 3. Baja-Med. Nicho geográfico.
7. **SwapNarrator (Li.Fi)** — Inspirada *Neur* + *AgentDEX*. Cada swap cross-chain Li.Fi narrado en audio: ruta, slippage real, score educativo. Track 4 (bounty $1K) + 3. Baja-Med.
8. **EarlyBird Whale Radar** — Inspirada *Eremos*. Mobile vigila smart-money wallets, push + audio cuando whale entra a token <5min. Track 2 + 3. Med.
9. **AgentGarage (Robotics)** — Inspirada *Clodds*. Brazo robótico controlado por LLM, x402 por acción ("muévete a posición X por 0.1 USDC"), webcam streaming. Track 5 + 3. Alta.
10. **ClassroomFi** — Inspirada *Mercantill* + *Pencil Finance* + *Neur*. Profesores cobran USDC vía x402 por acceso quizzes/recursos. Voz ElevenLabs lee preguntas y califica. Track 3. Med.

---

## Agente 6 — Superteam Build Ideas

**Fuente:** superteam.fun/build/ideas

**10 ideas (filtradas/adaptadas a 60h):**

1. **Cursor/Perplexity for Solana** — Chat agéntico cripto-nativo con tool-calling. Adaptado: 4-5 tools (balance, swap Jupiter, send, lookup). Track 3. Med-Alta. Vercel AI SDK + web3.js + ElevenLabs drop-in.
2. **Generative Crypto Agents** (Orca) — 3 agentes (degen, conservador, arbitrajista) en devnet, dashboard PnL. Track 1 + AI x402. Med. Demo visual.
3. **Multi-DEX Arb Agent con Li.Fi** (adaptado) — Original era Parcl real-estate. Adaptado: spreads Jupiter/Raydium/Orca, ejecuta cross-chain Li.Fi. Track 4 + bounty. Med.
4. **Voice Telegram Trading Agent** (adaptado) — Original: TG bot one-click. Adaptado: audio "comprame 10 USDC BONK", STT/TTS ElevenLabs, x402. Track 3 + Mobile. Baja-Med. Stack super conocido.
5. **AI Account Parser** — EASY oficial Ryan Trat. Decodificar programas Solana sin IDL. Track 1. Baja. NO ganador (ambición baja).
6. **DAO-gated AI Trader** (adaptado de Futarchy) — Vault Solana, holders gobiernan parámetros, agente tradea cross-chain Li.Fi dentro de límites. Track 4 + AI. Alta-scopeable. 2 bounties.
7. **Query Transactions Natural Language** — Helius enriched txns + LLM resume + voz. "¿Qué hizo esta wallet ayer?" → respuesta hablada. Track 1 + AI. Baja-Med.
8. **MCP Server para Li.Fi** (adaptado) — MCP server expone Li.Fi tools para Claude/Cursor + x402. ~300 líneas TS. Track 4 + AI x402 (DOBLE bounty). Med.
9. **Wallet-as-AI-Memory** (adaptado) — Wallet firma "preferencias" como cNFTs, agentes leen para personalizar. Track 1 + AI. Med. cNFTs via Helius DAS sencillos.
10. **Voice Dispute Bot** (adaptado de GPT Arbitration) — Escrow Solana, partes graban audio, ElevenLabs transcribe, LLM emite veredicto, libera fondos, x402. Track 3. Med. 3 bounties.

**Recomendación:** #4, #8, #1.

---

## Agente 7 — Past Hackathon Winners

**Fuentes:** Solana Breakout + Solana Mobile + x402 Hackathon winners + Project Plutus docs

**5 patrones identificados:**

- **P1. "Pago para agentes" (agent-native payments)** — Latinum (1° AI Track Breakout, $25K) middleware MCP-pay. Sentinel Agent (x402 winner) monitoring + fee payments. agentx402, ParallaxPay, x402Resolve. **Patrón: el pico y pala gana sobre el agente solo.**
- **P2. AI agéntico aplicado a DeFi vertical específico** — Plutus (1° Trading Agents $15K), Agent Arc (3° trading no-custodial), Daiko (4° "vibe trading" señales personalizadas), Lince (Solana Mobile robo-advisor). **Patrón: vertical acotado > generalista.**
- **P3. AI como capa simplificadora UX** — Synto (5° AI University), Forge AI, Armor Wallet, Blormmy (Mobile Grand Prize: 1B+ items con stablecoins). **Patrón: agente reemplaza UIs complejas con NL/voz/intent.**
- **P4. Workflows externos + cripto rails** — theintern.fun (5° AI X automation), Marketputer (meme marketing), Polycaster (prediction analytics). **Patrón: agente vive fuera de Solana, usa Solana como settlement.**
- **P5. Vertical de nicho + cripto invisible (no DeFi)** — Nomadz (1° Mobile travel 320 partners), SP3ND (Amazon stablecoins), Galaksio (USDC → compute/storage). **Patrón: cripto invisible, problema real físico.**

**8 ideas derivadas:**

1. **VozAgent Pay** (P1+P3+ElevenLabs) — Cada llamada tool-LLM cuesta x402. Track 3. Med.
2. **Bridge Whisperer** (P3+P2+Li.Fi bounty) — Voz, intent, Li.Fi, narra. Track 4 + AI/voz. Med-Alta.
3. **Robo-Mecánico On-Chain** (P5+Robotics) — ESP32/Pi, escanea QR servicio, cobra x402 autónomo. Track Robotics. Alta (hardware).
4. **CampusAgent Javeriana** (P5+P3) — dApp móvil microservicios estudiantes (apuntes, tareas, tutorías), pagos USDC, agente match + escrow por hito. Track Mobile. Med. Pitch ganador.
5. **AgentSitter** (P1+P4) — Dashboard mobile monitorea OTROS agentes del usuario (Plutus, Agent Arc), alerta voz, pausa firma móvil, suscripción x402. Track Mobile + 3. Med.
6. **VibeBridge** (P2+P4+Li.Fi) — Bot TG/X "rebalancear $500 a Sonic", agente cotiza Li.Fi, ejecuta, postea pruebas, fee % auto. Track 4 + AI. Baja-Med.
7. **PodcastPay** (P1+ElevenLabs+x402) — Texto → podcast voces clonadas, x402 por minuto escuchado. Track 3. Med. Mercado masivo no-cripto.
8. **MicroOracle Robotics** (P5+Robotics+x402) — Sensores IoT venden lecturas a contracts via x402, agente negocia precio. Caso: agro colombiano. Track Robotics + 3. Alta.

---

## Agente 8 — Web search trending agentic AI 2026

**Tendencias detectadas:**

1. **Autonomous Economic Actors (AEAs)** — Mercado pasó de chatbots a agentes con wallet propio + EIN + cuenta bancaria, operando 24/7. Caso "Manfred" (mayo 2026) formó corporación legal autónoma. ([CoinDesk](https://www.coindesk.com/tech/2026/05/01/ai-agent-forms-its-own-company-gets-ready-to-trade-crypto))
2. **x402 + machine-to-machine micropayments** — Coinbase/AWS Bedrock AgentCore Payments (mayo 2026) lanzaron x402 nativo. Volumen real ~$28K/día — espacio para casos de uso "wow". ([CoinDesk](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet))
3. **Pay.sh (Solana + Google Cloud, mayo 6 2026)** — Stablecoin micropayments para AI agents accediendo APIs on-demand. Pocos hackers la han tocado. ([BanklessTimes](https://www.banklesstimes.com/articles/2026/05/06/solana-and-google-cloud-launch-pay-sh-for-ai-agent-micropayments/))
4. **Multi-agent "digital assembly lines"** — Google Cloud + Microsoft 2026: valor real está en MCP-orquestados pipelines de agentes especializados, no monolíticos. ([Google Cloud](https://cloud.google.com/resources/content/ai-agent-trends-2026))
5. **On-device agents en Seeker** — SeekerClaw (feb 2026) Claude on-device + Seed Vault para trading. Hardware-backed signing poco explorado. ([Blockhead](https://www.blockhead.co/2026/03/09/seekerclaw-brings-24-7-ai-agents-to-the-solana-seeker-phone/))
6. **DeFAI / Agentic GDP** — Virtuals $477M aGDP, Jupiter Lend $1.65B TVL — pero UX para no-cripto sigue siendo terrible. ([Ledger](https://www.ledger.com/academy/topics/defi/defai-explained-how-ai-agents-are-transforming-decentralized-finance))

**10 ideas frescas:**

a. **VoiceBridge** — Llamada voz ElevenLabs "muévele 50 USDC Arbitrum→Solana→BONK", Li.Fi cotiza, lee quote, ejecuta tras "sí" verbal. Track 3 + bounty Li.Fi. Med.
b. **402.fm** — Radio/podcast premium $0.001 USDC/min vía x402, agente escucha por ti, resume, paga solo minutos relevantes. Track 3. Baja-Med.
c. **AgentEscrow vía voz** — Dos agentes negocian servicio en chat voz ("diseñame logo $5"), escrow Solana, entregan, liberan autónomo M2M. Track 3. Med-Alta.
d. **SeekerSidekick offline-first** — Agente on-device Seeker firma swaps sin internet (cola offline), envía al despertar wifi. Track Mobile. Med.
e. **CrossChainConcierge for Newcomers** — Agente voz pregunta "¿qué quieres hoy?", orquesta bridge Li.Fi + swap + stake en una oración. Track Li.Fi + AI/voz. Med.
f. **AgentDAO Treasury Voice Briefing** — Cada mañana llama al teléfono del tesorero DAO, reporta posiciones DeFi (Kamino/Jupiter Lend), propone rebalanceos vía voz. Track 3 + Solana app. Med.
g. **Pay-per-prompt MCP Server on Solana** — MCP server cobra $0.0001 USDC por tool invocada, inventario público mcp.directory. Track 3. Baja.
h. **PhantomCallback** — Agente ElevenLabs llama si detecta riesgo ("estás aprobando mint infinito ¿confirmas?"). Track Mobile/AI. Med.
i. **AgentAuctionHouse** — Dos+ agentes pujan en vivo por NFTs/tokens, usuario los entrena por voz ("sé agresivo en floor sweep"), x402. Track 3 + Solana app. Alta.
j. **LiquidityWhisperer** — Monitorea Jupiter/Kamino, llama (ElevenLabs) cuando aparece arb cross-chain rentable, "sí" verbal y Li.Fi ejecuta. Track Li.Fi + AI/voz. Med-Alta.

**Recomendación agente:** (a) o (e) — voz + Li.Fi $1K bounty + multi-track.

---

## Resumen de sesgo en v1

Frases problemáticas que aparecieron en TODOS los prompts:

- "Tracks: (1) Solana app libre, (2) Solana mobile, (3) **AI+ElevenLabs+Solana x402**, (4) **DeFi+Li.Fi advanced**, (5) Robotics advanced"
- "Bounty **Li.Fi** $1K para mejor cross-chain Solana UX"

**Efecto:** Los agentes vieron "ElevenLabs", "Li.Fi" y "x402" en cada prompt → orbitaron alrededor de esas tecnologías. La "convergencia 8/8" no fue señal de mercado, fue eco del prompt.

**Comparación pendiente:** v2 con prompts neutros — solo "IA agéntica + Web3/Solana" — para ver qué emerge sin contaminación.
