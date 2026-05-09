# [v1 — SESGADA] Ideas IA Agéntica — Síntesis para Dev3pack Hackathon

> ⚠️ **Esta versión está contaminada por sesgo de prompt.** En los prompts a los 8 agentes incluí explícitamente "Tracks: AI+**ElevenLabs**+Solana **x402**, DeFi+**Li.Fi** advanced" y "Bounty **Li.Fi** $1K". Los agentes vieron esos nombres y orbitaron alrededor — la "convergencia 8/8 sobre Voice+Li.Fi+x402" no es señal de mercado, es eco de mi prompt.
>
> Se preserva para comparación con v2 (prompts neutros). Outputs crudos de los agentes en `agent-outputs-v1.md`.
>
> ---
>
> Resultado de 8 agentes de investigación paralelos sobre 7 fuentes (SendAI Ideas, Colosseum Agent Hackathon Projects, Awesome Solana AI, Superteam Build Ideas, Past Hackathon Winners, NoahAI/solana.new, Solana Skills directories) + 1 web search general.
> ~73 ideas crudas → consolidadas en convergencias y filtradas por **fit equipo**: 3 estudiantes Javeriana, primer hackathon, ~60h disponibles.

---

## Convergencias clave (señal de mercado)

### 🎯 GAP MÁSIVO: Voice (ElevenLabs) + x402 micropagos
**8/8 agentes** lo flagean como diferenciador. Razones convergentes:
- ElevenLabs no aparece en NINGUNA skill del Awesome Solana AI repo (Awesome #gap)
- Demanda x402 real es baja (~$28K/día según CoinDesk) → showcase tiene espacio
- Pay.sh + Solana lanzaron 2026-05-06 (apenas 2 días antes del hackathon) — herramienta fresca
- ElevenLabs es co-host del hackathon → bounty potencial implícito

### 🌉 Li.Fi para bounty $1K
**6/8 agentes** proponen alguna variante de "voice/agent + Li.Fi cross-chain". El bounty está claramente subatacado por los demás equipos según past winners.

### 📊 Patrón de ganadores pasados (5 patrones identificados)
1. **"Pico y pala"** (infra de monetización) gana sobre "el agente solo" — Latinum $25K, Sentinel
2. **AI agéntico vertical específico** > agente generalista — Plutus, Daiko, Lince
3. **AI como capa UX simplificadora** — Synto, Blormmy, Armor Wallet
4. **Workflow externos + Solana settlement rail** — theintern.fun, Marketputer
5. **Vertical de nicho + cripto invisible** — Nomadz, SP3ND, Galaksio

---

## Top 7 finalistas

### 🏆 #1 — Voice Cross-chain Concierge (Li.Fi)

**Convergencia: 8/8 agentes** | Tracks: **DeFi+Li.Fi advanced + AI+ElevenLabs+x402** | Bounty: **Li.Fi $1K** ✓ | Complejidad: Media

Agente conversacional por voz que recibe intent ("muévele 50 USDC de Arbitrum a Solana para staking en JupSOL"), usa Li.Fi SDK para planificar bridge + swap óptimo, lee la cotización en voz alta con ElevenLabs, ejecuta tras confirmación verbal. Cobra micropagos x402 por cada plan generado.

- **Stack mínimo viable:** Li.Fi SDK + ElevenLabs TTS/STT + Solana Agent Kit + paywall x402 (`pay.sh` o `x402-proxy`)
- **Unfair advantage:** ataca DOS tracks + bounty con un solo build. Demo de voz es visualmente memorable. Li.Fi UX cross-chain es fricción real → la voz la elimina.
- **Riesgo principal:** integrar Li.Fi + voice + x402 puede ser >60h. Mitigación: empezar con happy path 1 source chain → Solana → 1 destino, expandir si hay tiempo.
- **Nombres mencionados:** "Bridge Whisperer", "LiFi Whisperer", "VoiceBridge", "CrossChainConcierge", "LiquidityWhisperer"

---

### 🥇 #2 — CampusAgent / CampusDAO Javeriana

**Convergencia: 3 agentes** | Track: **Solana app + Solana mobile** | Complejidad: Baja-Media

Variantes propuestas:
- **CampusDAO**: tesorería de la Javeriana donde un agente AI propone (pero NO ejecuta) rebalanceos de fondos becas/proyectos; Squads multisig requiere firma de 2/3 humanos. Helius webhooks alertan eventos.
- **CampusAgent**: marketplace móvil donde estudiantes contratan microservicios (apuntes, tutorías) pagando con stablecoins; agente matchea oferta/demanda y libera fondos por hito vía x402.
- **ClassroomFi**: profesores cobran USDC vía x402 por acceso a quizzes/recursos; voz ElevenLabs lee preguntas y califica.

- **Unfair advantage:** Storytelling local imbatible. "Somos los autores y lo usamos hoy" = pitch ganador en demos. Pocos equipos atacan vertical educativo. Patrón P5 ganador (vertical de nicho).
- **Stack mínimo:** Squads SDK + Anchor escrow program + frontend Next.js + opcional ElevenLabs
- **Riesgo:** scope se puede inflar — mantener una sola feature core (ej. solo quizzes-pay)

---

### 🥇 #3 — MCP Server for Li.Fi (monetizado x402)

**Convergencia: 3 agentes** | Tracks: **AI+ElevenLabs+x402 + DeFi+Li.Fi** | Bounty: **Li.Fi $1K** ✓ | Complejidad: Baja-Media

Construir un MCP server público que expone Li.Fi como tools (`bridge_quote`, `execute_swap`, `route_optimize`) consumible desde Claude/Cursor/cualquier cliente MCP. Cada llamada cuesta $0.0001 USDC vía x402.

- **Stack:** TypeScript MCP SDK (~300 líneas) + Li.Fi SDK + x402-proxy
- **Unfair advantage:** "Pico y pala" puro (Patrón P1 ganador). Producto deployable post-hackathon con tracción inmediata. MCP-on-Solana público no existe aún. Ataca DOBLE bounty (Li.Fi + x402).
- **Riesgo:** menos "wow visual" que voz. Mitigar con demo en vivo: agente Claude ejecutando bridge cross-chain con MCP.

---

### 🥈 #4 — Voice Telegram Trading Agent

**Convergencia: 4 agentes** | Tracks: **AI+ElevenLabs+x402 + Solana mobile** (TG es mobile-first) | Complejidad: Baja

Bot de Telegram donde mandas audio ("comprame 10 USDC de BONK"), ElevenLabs STT transcribe, agente LLM ejecuta swap vía Jupiter, ElevenLabs TTS confirma con voz. Pago x402 por trade. Variante: prediction markets ("apuesto 5 USDC contra Pedro a que gana Real Madrid") con resolución vía Perplexity.

- **Stack:** Bot TG (Python/Node, 1 día) + Jupiter API + ElevenLabs + x402
- **Unfair advantage:** ataca tres tracks con stack supersencillo. Demo viral instantáneo (graban una apuesta real entre miembros).
- **Riesgo:** hay competencia (varios bots TG existen). Diferenciador: VOZ + x402 nativo.

---

### 🥈 #5 — BlinkShield / PhantomCallback (anti-scam mobile)

**Convergencia: 3 agentes** | Tracks: **Solana mobile + AI+ElevenLabs** | Complejidad: Media

App Solana Mobile que escanea QR/Blink links, simula la transacción off-chain (Helius RPC simulación), narra riesgos en voz ElevenLabs ("este contrato puede drenar tu wallet"), y solo permite firmar tras confirmación verbal del usuario.

- **Stack:** Solana Mobile Stack (Seed Vault + Mobile Wallet Adapter) + Helius simulation API + ElevenLabs + LLM para análisis
- **Unfair advantage:** Patrón P3 ganador (UX simplificadora + protección). Pocos equipos atacan track Mobile con IA. Posible bounty Seeker phone.
- **Riesgo:** Solana Mobile dev requires Android setup → tiempo de setup. Mitigar con emulador.

---

### 🥉 #6 — AgentEscrow voice arbitration

**Convergencia: 2 agentes** | Track: **AI+ElevenLabs+x402** | Complejidad: Media

Escrow simple en Solana donde dos partes graban audio explicando su lado de una disputa, ElevenLabs transcribe, LLM emite veredicto, contrato libera fondos. Pago x402 por arbitraje (~$1 USDC).

- **Unfair advantage:** Demo emocional + técnico + multi-bounty. Anchor escrow es template estándar. Narrativa fuerte: "primer juzgado AI con voz".

---

### 🥉 #7 — 402.fm / PodcastPay (voice content per-second)

**Convergencia: 2 agentes** | Track: **AI+ElevenLabs+x402** | Complejidad: Baja-Media

Plataforma donde creadores suben texto, ElevenLabs lo convierte en podcast, oyentes pagan x402 **por minuto/segundo escuchado** — si saltas, no pagas. Agente decide qué voz usar según engagement histórico.

- **Unfair advantage:** Implementa el caso de uso que CoinDesk explícitamente dice que falta para x402. Mercado masivo no-cripto. Demo "cuento un libro y te cobro $0.01 por minuto" es pegadiza.

---

## Tier C — descartadas para 60h / primer hackathon

| Idea | Por qué se descarta |
|------|---------------------|
| **Robotics + x402** (RoboPay, AgentGarage, Robo-Mecanico) | Hardware en 60h es trampa salvo que ya tengan Raspberry/ROS listos. Todos los agentes warned. |
| **Cross-chain Yield Hunter Agent autónomo** | Requiere monitoring 24/7 + integraciones múltiples DeFi. Scope >60h. |
| **ProofOfVoice (ZK biometric agent identity)** | ZK + Light Protocol para 3 estudiantes en 60h = no. |
| **Generative Crypto Agents simulation** | Visualmente cool pero el "wow" es la economía simulada — fácil que se vea fake en demo. |
| **Multi-agent Jedi Council** | Demo escénica brutal pero requiere 5 agentes con voces distintas + lógica de debate. Riesgo alto. |

---

## Recomendación final

**Pick recomendado: #1 Voice Cross-chain Concierge (Li.Fi)** + plan B = **#3 MCP for Li.Fi** si el alcance se infla.

Razones:
1. **Convergencia 8/8** — el mercado dice claramente que esta es la idea correcta
2. **Multi-bounty:** Li.Fi $1K + tracks AI/ElevenLabs/x402 + DeFi/Li.Fi advanced
3. **Stack accesible** para junior team: Li.Fi SDK + ElevenLabs son drop-in APIs
4. **Demo memorable:** voz humana ejecutando cross-chain en vivo
5. **Pivot fácil a #3** si la voz da problemas — el MCP server como fallback comparte 60% del stack

**No recomendado:** ideas con hardware (Robotics), simulaciones complejas, ZK avanzado, o que dependan de datasets propietarios.

**Antes de comprometerte a una idea:** validar contra Colosseum Copilot (https://colosseum.com/copilot) para ver si alguien ya construyó algo idéntico.

---

## Fuentes consultadas (con links de las más útiles)

- **SendAI Ideas API** — `https://ideas.sendai.fun/api/ideas` (36 ideas crudas)
- **Colosseum Agent Hackathon Projects** — patrones de 50+ proyectos
- **Awesome Solana AI** — github.com/solana-foundation/awesome-solana-ai
- **Solana Agent Kit MCP** — kit.sendai.fun (60+ acciones unificadas)
- **Past winners:**
  - [Solana Breakout Winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-breakout-hackathon/)
  - [Solana Mobile Hackathon Winners](https://blog.solanamobile.com/post/solana-mobile-hackathon-winners-announced)
  - [x402 Hackathon Winners](https://phemex.com/news/article/solana-x402-hackathon-announces-winners-in-micropayments-and-ai-41757)
- **Tendencias 2026:**
  - [a16z: AI agents trends 2026](https://a16zcrypto.com/posts/article/trends-ai-agents-automation-crypto/)
  - [Pay.sh launch (mayo 2026)](https://www.banklesstimes.com/articles/2026/05/06/solana-and-google-cloud-launch-pay-sh-for-ai-agent-micropayments/)
  - [SeekerClaw on-device agent](https://www.blockhead.co/2026/03/09/seekerclaw-brings-24-7-ai-agents-to-the-solana-seeker-phone/)
- **Li.Fi resources:**
  - [SphereOne integrates Li.Fi for AI agent cross-chain swaps](https://li.fi/knowledge-hub/sphereone-integrates-li-fi-to-enable-cross-chain-swaps-through-ai-agent/)
  - docs.li.fi/widget/overview · docs.li.fi/sdk/overview
