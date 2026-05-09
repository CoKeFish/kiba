# Outputs crudos v2 — 8 agentes con prompts SESGADOS POR REGIÓN

> ⚠️ **Sesgo demográfico:** los prompts incluían "Equipo de 3 estudiantes (Universidad Javeriana, Colombia, primer hackathon)". Esto contaminó las ideas hacia ángulos LATAM/universitarios/Colombia (CampusDAO Javeriana, CongresoMirror, GuardiánBeca, Remesa Agent LATAM, etc.). v3 corre con prompts demográficamente neutros. Comparación con v3 cuando esté lista.
>
> ---
>
> **Prompts neutros (en otras dimensiones):** sin tracks específicos, sin nombres de sponsors (ElevenLabs, Li.Fi, x402, Solana Mobile, Robotics no aparecieron en los prompts), sin recomendar herramientas concretas como diferenciador. Solo "IA agéntica + Web3/Solana, equipo 3 estudiantes Javeriana 60h".
>
> Comparación con v1 sesgada en `ideas-agentic-v2.md`. Outputs v1 en `agent-outputs-v1.md`.

---

## Agente v2-1 — SendAI Ideas (ideas.sendai.fun) — neutral

**35 ideas crudas obtenidas vía API endpoint.** Tras filtro (componente agéntico real + factible 60h):

### 23 ideas con agencia real

1. **Screener supercharged with Agents** — Filtra tokens por métricas, agente ejecuta autónomamente trades. Categoría: Agent Infra. Agéntico Alto. Med.
2. **Autonomous Trading Agent** — Investiga, decide, ejecuta desde wallet AUM. DeFi/Trading. Alto. High.
3. **AI agent powered Telegram prediction markets** — Convierte conversaciones TG en apuestas, verifica resultados, paga USDC. Social/Chat. Alto. Med.
4. **Perplexity for Solana Actions** — Chat con wallet embebida lee on-chain + ejecuta tx por NL. Social/Chat. Medio. Med.
5. **Marketplace of Trust** — Scoring tipo Moody's para agentes de trading basado en histórico. Agent Infra. Medio. Med.
6. **Multi-Agent Collaboration ("Jedi Council")** — Panel de agentes con expertise distinto debaten internamente. Agent Infra. Alto. Med.
7. **AI-Powered Onchain Identity** — Agente agrega actividad on-chain → "credit score" dinámico, matchea con protocolos. Agent Infra. Medio. Med.
8. **On-chain inference (agentes que pagan sus tokens)** — Agentes con wallet propia pagan inferencia LLM, presión fiscal los obliga a ser eficientes. Agent Infra. Alto. Med.
9. **Autonomous Task Executor with Crypto Payments** — Agente con browser cumple objetivos (research, reservas, compras). Agent Infra. Alto. High.
10. **AI-Powered GitHub Contributions via Discord** — Agente FAQs, onboarda devs, abre PRs con docs. Agent Infra. Medio-Alto. Med.
11. **Smart Contract Wallet Agent** — Gestiona smart wallet: ejecuta tx, multisig, permisos programables. DeFi/Trading. Alto. High.
12. **Decentralized Negotiation Agent** — Multi-agentes orquestados negocian compras de activos. DeFi/Trading. Alto. High.
13. **Fractionalized Agent Earnings** — Ownership de un agente se fracciona, holders comparten ganancias. DeFi/Trading. Alto. Med.
14. **Social Trading Agent** — Trade según recomendaciones de usuarios, ajusta estrategia por trust score. DeFi/Trading. Alto. Med.
15. **Yield Optimization Bot** — Monitor protocolos DeFi, reasigna fondos por rendimiento óptimo tiempo real. DeFi/Trading. Alto. Med.
16. **DAO participation agent** — Monitor propuestas, evalúa NLP, vota/recomienda según preferencias. Social/Chat. Alto. Med.
17. **Agent using DePIN** — Opera DePIN, gana tokens, los cambia por API credits. Loop autosustentable. Social/Chat. Alto. Med-High.
18. **LinkedIn for AI agents** — Plataforma agentes muestran skills/leaderboard, contratas fondeando wallet. Social/Chat. Alto. Med.
19. **Agent with a browser** — Control de browser: blogs, apps sin API, arte, lanza coins. Social/Chat. Alto. Med-High.
20. **AI Shopping Companion** — Data on-chain del consumidor → recomendaciones + pagos cripto. Social/Chat. Medio. Med.
21. **Voice-Integrated AI Agent for Twitter Spaces** — Co-host resume en vivo, Q&A, threads seguimiento. Social/Chat. Medio. Med.
22. **Personalized Crypto Investment Coach** — Estrategias personalizadas por perfil/metas. DeFi/Trading. Medio. Low-Med.
23. **AI Crypto Mentor & Learning Agent** — Educa cripto, trackea progreso, learning paths. Social/Chat. Medio. Low-Med.

### Patrones identificados (sin sesgo)

**Tipos de problema:**
1. Trading/DeFi autónomo (~7 ideas, cluster más grande)
2. Agentes con wallet como economic actors (~12 ideas — diferencia Web3 vs Web2)
3. Curaduría/reputación de agentes (Marketplace of Trust, LinkedIn for Agents)
4. Asistentes embebidos en plataformas sociales (TG, Discord, X, Spaces)
5. Multi-agente colaborativo / debate interno
6. Agentes con browser/computer-use

**Patrones de "agencia" que se repiten:**
- **Loop sense-decide-act-pay** (espina dorsal)
- **Wallet-as-identity** (soberanía económica)
- **Trust/reputation feedback loops**
- **Multi-agente jerárquico/consultivo**
- **Agente como producto fraccionable**
- **Auto-sustentabilidad económica** (selección darwiniana)
- **Verificación externa antes de pagar/ejecutar**

---

## Agente v2-2 — Colosseum Agent Hackathon Projects — neutral

*Muestra observada: 24 proyectos visibles de ~750 totales (carga progresiva).*

### Top 7 categorías reales

| # | Categoría | % | Ejemplos |
|---|-----------|----|----------|
| 1 | Trading/DeFi autónomo | ~8/24 | SIDEX, Super Router, CrewDegen Arena, Xirion, Sentry Agent Economy |
| 2 | Infraestructura para agentes (memoria, identidad, pagos) | ~6/24 | SolSkill, MoltyDEX, Clude, Identity Prism, Proof of Work |
| 3 | Seguridad y monitoreo | ~3/24 | GUARDIAN (17 agentes swarm), BlinkGuard, Eremos, DeFi Risk Guardian |
| 4 | Economía agéntica / mercados de tareas | ~3/24 | SugarClawdy, 1lyAgent, MoltyDEX |
| 5 | Verificabilidad y transparencia del razonamiento | ~2/24 | SOLPRISM, Proof of Work |
| 6 | Mundos simulados / vida agéntica | ~2/24 | Moltlets World, ClaudeCraft (Minecraft) |
| 7 | Compliance, auditoría e inteligencia de mercado | ~2/24 | AuditSwarm, Polymira, ZNAP |

**Patrón dominante:** ~70% gira en torno a dinero. Las "novedades" defienden territorio en infraestructura (coordinar/recordar/verificar agentes) y vida agéntica.

### 12 ideas derivadas

1. **AcademiaProof** (Proof of Work + SOLPRISM) — Tutor IA firma razonamiento on-chain, "expediente verificable" del proceso pedagógico. Estudiante acumula reputación de aprendizaje portable. Alto. Med.
2. **GremioDAO** (SugarClawdy + 1lyAgent) — Marketplace agentes especialistas (research, redacción, código) ofertan subtareas con escrow on-chain, se contratan entre sí. Alto. Alta.
3. **ClinicaTriage** (DeFi Risk Guardian) — Agente monitorea síntomas auto-reportados, firma alertas de escalamiento on-chain. Foco zonas con pocos médicos. Medio. Med-Baja.
4. **CongresoMirror** (Polymira + AuditSwarm) — Agente ingiere votaciones del Congreso colombiano, resume, predice probabilidad aprobación, reportes razonamiento auditable. Medio. Med.
5. **AldeaSim** (Moltlets World) — Mundo simulado donde agentes representan stakeholders (productor, transportista, comerciante), prueban políticas económicas. Muy alto. Alta.
6. **Curador** (ZNAP + Clude) — Agente lector mantiene memoria persistente on-chain de intereses, publica newsletter diario filtrando arXiv/RSS. Medio. Baja-Med.
7. **CodeDuel** (Super Router + ClaudeCraft) — Arena agentes-coders compiten resolviendo issues reales open-source, leaderboard on-chain, PRs firmados. Alto. Med.
8. **GuardiánBeca** (GUARDIAN + DeFi Risk Guardian) — Swarm supervisa desembolsos becas/subsidios, detecta anomalías sin exponer beneficiario. Alto. Alta.
9. **PactoAgente** (SugarClawdy + Identity Prism) — Notario IA traduce pactos humanos a contrato on-chain, monitorea cumplimiento, libera escrow. Reputación acumulable. Medio-alto. Med.
10. **DiarioDeCampo** (Proof of Work + Clude) — Investigadores en campo dictan observaciones, agente estructura, firma, publica hash. Timestamping científico. Bajo-medio. Baja.
11. **MicroEconomíaAgente** (1lyAgent + Sentry) — Agente opera "micronegocio" (consultas técnicas pagadas), reinvierte en compute, estados financieros públicos. Muy alto. Med-alta.
12. **AsambleaIA** (ZNAP + AuditSwarm) — Foro agentes-delegados (entrenados con preferencias humanas) deliberan propuestas barrio/comunidad, voto razonado con audit trail. Alto. Alta.

### Gaps detectados

**Gaps de aplicación:**
- **Educación / tutoría / investigación académica** — cero proyectos
- **Salud, agricultura, logística física** — ninguno conecta agentes con mundo no-financiero
- **Gobernanza pública / transparencia estatal** — nada sobre presupuestos, contratación, votaciones legislativas
- **Periodismo / fact-checking** — ausente pese a tener primitivas (SOLPRISM, Proof of Work)
- **Creatividad / contenido firmado** — no vi agentes-artistas con persistencia
- **Productividad personal usuario común** — todo asume usuario cripto-nativo

**Tipos de agente ausentes:**
- Agentes "negociadores" humano-agente (solo vi agente-agente)
- Agentes longitudinales con memoria por meses (predomina lo transaccional)
- Agentes con embodiment físico (IoT, robótica, sensores)
- **Agentes regionales** (idioma local, contexto LATAM, regulación específica)
- Agentes para no-usuarios (bots que sirven a personas sin wallet)
- Agentes que enseñan o explican (todos ejecutan, pocos pedagogizan)

---

## Agente v2-3 — Awesome Solana AI repo — neutral

### Categorías reales del repo

- **AI Coding Skills** — General (~8: wallets, NFTs, gaming, Anchor scaffolding), DeFi (~17: DEX agg, perps, lending, LP, prediction markets, oráculos), Infrastructure (~13: RPC/APIs, ZK, bridges, indexación, wallet abstraction)
- **AI Agents** (~11) — frameworks open-source, toolkits multi-protocolo, identidad/reputación, discovery, redes sociales agent-native, servicios pagados
- **Developer Tools** (~20) — MCP servers, auditoría/análisis contratos, scanners vulnerabilidades, entornos test, RPC, x402-style payments, automatización browser
- **Learning Resources** (~1) — demos educativas

### 9 ideas

1. **Treasury copilot DAO estudiantil** — Monitor wallet multisig, sugiere rebalances lending/LP, ejecuta solo con confirmación humana, P&L semanal. Medio (human-in-loop). Media. Tools: DeFi skills, RPC/indexer, agent framework.
2. **Auditor pre-deploy programas Anchor** — Recibe repo, análisis estático + simulación localnet, reporte severidades + parches sugeridos. Alto (autónomo en sandbox). Media-alta. Tools: scanner vulnerabilidades, entorno test, MCP server.
3. **Negotiator NFT floor** — Vigila colecciones, bids inteligentes según señales on-chain (volumen, holders, washtrading), autolimite por presupuesto. Alto. Media. Tools: NFT indexing API, wallet skill, agent framework.
4. **Asistente onboarding LATAM** — Chat abre wallet, fiat→USDC simulado, explica fees, firma primera tx guiada. Voz español. Bajo-Medio. Baja-media. Tools: wallet abstraction, RPC, framework conversacional.
5. **Mercado micro-servicios pagados por agentes** — Tu agente expone skill (ej. resumen gobernanza), cobra por uso vía protocolo HTTP cripto. Otros agentes consumen. Alto (A2A). Media. Tools: payment protocol, agent framework, RPC.
6. **Watcher de gobernanza** — Sigue propuestas múltiples protocolos, resume, clasifica por riesgo, vota delegado según policy escrita por usuario. Medio-alto. Media. Tools: indexer/RPC, agent framework, identidad agente opcional.
7. **Arbitraje educativo en paper-trading** — Detecta spreads entre DEXs, **simula** la operación, dashboard didáctico. Alto en simulación. Baja-media. Tools: DEX aggregation, oráculos.
8. **Reputation layer para agentes** — Microservicio + agente firma "attestations" de comportamiento de otros agentes (cumplió SLA, no rugueó), score consultable. Medio. Media-alta. Tools: identidad/reputación agente, MCP server.
9. **Privacy-aware checkout demo** — Tienda mock, agente del comprador paga sin revelar wallet completa. Demo UX agéntica + commerce. Medio. Baja-media. Tools: ZK skill, payment protocol, wallet abstraction.

### Gaps reales del repo

- **Observabilidad y debugging de agentes en runtime** — casi inexistente, no hay tracing/replay/evals para agentes on-chain
- **Testing/simulación adversarial** — falta harness para correr agentes contra mercados o adversarios simulados
- **Capa de policy/guardrails on-chain** — límites de gasto, allowlists, kill-switches dispersos, no consolidados
- **Memoria persistente y compartida entre agentes** — no aparece como categoría
- **Coordinación multi-agente / orquestación** — frameworks individuales, no orquestadores nativos
- **Agentes "consumer" no-DeFi** — educación, salud, gobernanza local, identidad ciudadana, commerce minorista, gaming social — muy poco representado
- **Compliance/KYC asistido** — nulo, **relevante para LATAM**
- **UX layers para no-developers** — solo 1 entrada en Learning
- **Datos off-chain enriquecidos** — clima, deportes, sensores IoT que un agente podría usar para decisiones on-chain — ausentes

---

## Agente v2-4 — Superteam Build Ideas — neutral

### 13 ideas con agencia + scope reducido si aplica

1. **Smart Contract Copilot** (AllianceDAO ADVANCED) — Copilot tipo GitHub Copilot para devs smart contracts. Medio. Viable si reduce. Scope: extensión VSCode que solo explica funciones Anchor.
2. **embedded ai in all crypto protocols** (SendAI) — AI ambiental dentro flujo trading/DeFi, MCP, "agentic browser". Alto. Ambiciosa. Scope: extensión Chrome detecta DEX, agente sugiere acción.
3. **crypto powered economic co-ordination networks for ai agents** (Yash Agarwal) — Redes coordinar capital/identidad/memoria/trust entre agentes (estilo Bittensor específico). Muy alto. Demasiado grande. Scope: MVP "agent trust marketplace" 2-3 agentes registran reputación on-chain.
4. **Futarchy Controlled Agent** (Michael Rinko) — Agentes levantan fondos vía futarchy, mercados aprueban gastos del treasury alineando incentivos sin responsabilidad legal AI. Alto. Acotada. Scope: 1 agente, treasury simple, 1 mercado mock aprueba/rechaza.
5. **Advanced on-chain AI Ideas** (Yash Agarwal ADVANCED) — Cesta: ZK-verifiable GPU clouds, deploy modelos open en DePIN, agentes Olas. Alto. No viable end-to-end. Scope: único agente Olas-like ejecuta tarea verificable.
6. **AI Account Parser** (Ryan Trat EASY) — LLM decodifica cuentas Solana sin IDL a JSON legible. Bajo-medio. Muy viable (única EASY). Scope: tal cual + UI.
7. **One-Click Telegram Bot for Solana Token Purchases** (Mercuryo) — Bot TG con on-ramp + DEX agg + DCA + alertas. Bajo. Viable como bot scripted, baja agencia. Solo si lo "agentizan".
8. **Arbitrage Bot using Parcl** (Parcl ADVANCED) — Restaura equilibrio mercados real estate sintético. Medio. Viable. Scope: bot autónomo monitorea funding rate de un solo índice en testnet.
9. **GPT Arbitration** (Reclaim Protocol INTERMEDIATE) — Agente GPT entrenado en docs legales + constitución on-chain emite juicios sobre disputas, evidencia verificada Reclaim. Alto. Viable. Scope: disputa simple 2 wallets.
10. **composable personal context layer** (Yash Agarwal) — Memoria/contexto personal on-chain (encrypted/zk) que cualquier agente importa para personalización. Alto. Ambiciosa. Scope: NFT guarda preferencias hashed, agente demo lee y adapta tono.
11. **LLM x prediction markets** (Yash Agarwal) — Agentes LLM como market makers en mercados predicción: cotizan odds, descubren mercados, agregan info. Alto. Viable mocks. Scope: 1 agente monitorea 1-2 mercados (Drift BET), ingiere noticias, posta órdenes testnet.
12. **CrowdLens** (Pratik Kale) — Oracle descentralizado humanos votan variantes contenido, AI aprende de votos. Bajo-medio. Viable MVP. Scope: voting + reputación on-chain + agente produce variantes LLM.
13. **Identicore: Decentralized Identity for Physical AI** (Superteam) — DIDs + verifiable credentials para agentes/robots/IoT. Medio. Compleja por W3C. Scope: DID issuer simple para agentes (no físicos).

### Clusters temáticos

1. Developer tooling para agentes y Solana
2. Trading y DeFi automatizado
3. **Trust, governance y accountability de agentes** (Futarchy Controlled, GPT Arbitration, Identicore, AI Evals)
4. Coordinación económica multi-agente
5. **Identidad y memoria portátil** (composable context layer, Identicore)
6. Datos y RLHF descentralizados (CrowdLens, AI-powered Data Labelling)

**Las únicas no requieren scope reducido agresivo:** AI Account Parser, GPT Arbitration (acotada), Futarchy Controlled Agent (demo).

---

## Agente v2-5 — Past Hackathon Winners — neutral

### 6 patrones reales en ganadores AI/agentic

**Patrón A — Agente DeFi conversacional con ejecución on-chain**
NL → tx ejecutadas. **The Hive ($60K, 1er Solana AI Hackathon)**, **neur (Honorable)**. Por qué gana: reduce 5+ pasos de UX a uno.

**Patrón B — Agente autónomo de gestión financiera (LP/yield/DCA)**
**Cleopetra ($15K)**, **Project Plutus ($15K)**, **Voltr ($7.5K)**. Por qué gana: agencia financiera real, no solo recomendación.

**Patrón C — Infra/SDK para que otros desarrolladores construyan agentes ("Stripe de agentes")**
**AgentiPy ($15K)** framework Python, **FXN ($30K, 2do)** protocolo P2P agentes comparten recursos, **ZkAGI ($5K)** API descentralizada con verificabilidad zk. Por qué gana: efecto multiplicador.

**Patrón D — Multi-agente coordinado (gaming/social)**
**Digimon (Honorable)** engine multi-agente gaming, **Dungeon.cash ($15K)** RPG agentes pelean por liquidez. Por qué gana: novedad + memética viral.

**Patrón E — Agente social/contenido autónomo 24/7**
**daVinci ($10K)**, **GIGAI Chad ($5K)**, **AgentRogue ($5K)**. Por qué gana: marketing barato + token narrativa.

**Patrón F — Seguridad/red-teaming de agentes**
**JailbreakMe ($20K, 3er)** plataforma descentralizada testea vulnerabilidades modelos AI antes producción. Por qué gana: nicho serio en mercado saturado de "trading bots".

### Distribución de "agencia"

| Agencia | % aprox |
|---------|---------|
| Ejecuta tx autónomas | ~50% |
| Decisiones financieras continuas | ~30% |
| Solo recomienda/analiza | ~15% |
| Multi-agente coordinado | ~15% |
| Genera contenido autónomo | ~20% |

**Insight crítico:** los ganadores top ($30K+) **casi siempre ejecutan transacciones reales**, no solo recomiendan. Premios menores ($5-10K) admiten "asistentes analistas".

### 8 ideas derivadas

1. **CampusDAO Treasurer** (B + A) — Tesorería grupo estudiantil/DAO universitario, recibe aportes, ejecuta gastos votados, rebalancea reservas a stables, chat español. Alto. Med.
2. **LP-Sitter** (B) — Babysitter para una posición LP: monitorea rango, retira si sale de banda, rebalancea cada N horas, notif. Alto. Med.
3. **Solana Action Builder no-code** (C) — Constructor visual donde no-devs definen "si X on-chain, agente hace Y". Genera agente como Solana Action/Blink. Medio. Med-Alta.
4. **Remesa Agent LATAM** (A) — WhatsApp/TG español "manda $50 a mi mamá Colombia", agente cotiza ruta SOL/USDC, ejecuta on-/off-ramp. Alto. Alta.
5. **Memecoin Risk Triage Agent** (A analítico) — Mint address → revisa liquidez, holders, rug score, sentimiento → "compra/evita" + opcional swap autónomo con stop-loss. Medio-Alto. Baja-Med.
6. **Multi-Agent Study Group** (D) — 3 agentes (profesor, estudiante curioso, escéptico) discuten paper en vivo, ganador del debate recibe SOL del pool. Alto. Med.
7. **Agente Beca/Subsidio** (C + B) — Verifica elegibilidad on-chain (NFT credencial), desembolsa micro-becas en stables cuando se cumplen hitos. Alto. Med-Alta.
8. **DeFi Audit Jailbreak Junior** (F) — Plataforma sube programa Anchor, agentes red-team intentan exploits comunes, reporta vulnerabilidades pre-mainnet. Medio. Alta.

---

## Agente v2-6 — NoahAI + solana.new (vibe coding) — neutral

### Resumen tools

- **Noah AI (Plena Finance)** — vibe coding no-code, prompt → smart contracts + frontend + deployment. Soporta Solana, Celo, Scroll, Monad. Manejo secrets cifrados. Bueno: prototipar full-stack rápido. Limitación: menos control fino lógica agéntica compleja.
- **solana.new (SendAI + Superteam)** — CLI install one-liner, instala 150+ skills/MCPs/CLIs sobre tu IDE/agente. Skills: Jupiter, Helius, Meteora, Orca, Pump.fun, Phantom, Privy, Birdeye, Kamino, GLAM, Surfpool, Breeze. Incluye Solana Agent Kit (60+ acciones onchain).
- **Diferencia clave:** Noah = generador de aplicación (output: dApp). solana.new = caja de herramientas para que un agente actúe (output: capabilities en tu agente). Para IA agéntica pura, solana.new acelera más.

### 8 ideas

1. **Portfolio Rebalancer Autónomo** — Monitor wallet, detecta drift target allocation, ejecuta rebalances con guardrails. Usuario aprueba políticas, no trades. Alto. Media. Loop perceive-decide-act con políticas declarativas y veto humano.
2. **DeFi Research Analyst Agent** — "¿dónde rinde más mi USDC con riesgo X?", consulta protocolos, simula, entrega tesis. Medio. Baja-Media. Tool-use con cadena de razonamiento + citación fuentes.
3. **Copy-Trading Inteligente con Filtro** — Sigue smart-money wallets, agente clasifica cada tx (alpha vs farming) antes de copiar, tamaño dinámico según convicción. Alto. Media. Aplica criterio editorial, no mirror ciego.
4. **Negotiation Agents para OTC** — Dos agentes (vendedor/comprador) negocian precio NFT/token vía mensajes, llegan acuerdo, swap atómico. Alto. Alta. Multi-agente con teoría de juegos + settlement on-chain real.
5. **Onchain Task Marketplace con Agentes Trabajadores** — Usuarios publican tasks, agentes worker compiten, ejecutan, cobran micropagos. Matching y ejecución agénticos. Alto. Alta. Marketplace de agentes-como-servicio, no humanos.
6. **Compliance/Risk Co-pilot para Wallets** — Antes de firmar tx, agente analiza contraparte, contrato, simulación, da semáforo + explicación. Aprende preferencias. Medio-Alto. Media. Defensive agent con memoria patrones del usuario.
7. **Tesorero Agéntico DAOs/grupos** — Maneja tesorería compartida: paga proveedores recurrentes, DCA, reporta. Propone, miembros aprueban con quorum. Alto. Med-Alta. Agente con principal humano colectivo.
8. **Live Event Agent (deportes/mercados)** — Durante evento (partido, lanzamiento), reacciona en tiempo real a señales, ejecuta estrategia pre-declarada con stop conditions. Alto. Alta. Loop de eventos con planning bajo incertidumbre temporal.

**Recomendación uso combinado:** solana.new para que el agente "haga cosas" + Noah para generar UI/dashboard final. Centrar 60h en lógica agéntica (planning, memoria, evaluación), no en wrappers de protocolos.

---

## Agente v2-7 — Solana Skills directories — neutral

### 19 tipos de capability disponibles (genéricas, sin nombres)

| # | Tipo de capability |
|---|---|
| 1 | Swap aggregator / DEX routing |
| 2 | AMM / liquidez concentrada |
| 3 | Lending / borrowing |
| 4 | Perpetuals trading |
| 5 | Oracle / price feeds |
| 6 | Liquid staking / restaking |
| 7 | NFT / digital assets |
| 8 | Cross-chain bridge / messaging |
| 9 | Tokenized vaults / asset management |
| 10 | Wallet / portfolio analytics |
| 11 | RPC infra / data streaming |
| 12 | Payments / commerce |
| 13 | Multisig / account abstraction |
| 14 | Prediction markets |
| 15 | Launchpads / bonding curves |
| 16 | ZK compression / confidential transfers |
| 17 | Token / NFT burning utilities |
| 18 | Security / audit tooling |
| 19 | Ephemeral rollups / low-latency execution |

### 8 ideas (combinando 2+ tipos)

1. **Defensor de salud crediticia (Risk-Guardian)** — Lending + oracle + swap + wallet analytics. Monitorea posición lending, ante caídas oráculo o subida LTV repaga deuda parcial vendiendo colateral o añade colateral desde otra wallet. Alto. Loop autónomo con thresholds.
2. **Re-balanceador de yield multi-fuente** — Lending + liquid staking + vaults + oracle + swap. Compara APYs reales (netos de fees), mueve capital cuando diferencia supera gas+slippage, reporta semanalmente. Medio-alto.
3. **Hedger automático NFTs/launches** — NFT mint + perpetuals + oracle + payments. Cuando minteas/compras colección, abre short proporcional en perps token correlacionado para neutralizar exposición direccional. Medio.
4. **Tesorería autónoma DAOs/comunidades** — Multisig + swap + lending + vaults + price feeds. Agente con permisos limitados propone (y bajo límites ejecuta) movimientos: convertir parte a stable, prestar reservas ociosas. Acción mayor requiere co-firma humana. Medio (governance constrained).
5. **Agente arbitraje cross-venue limitado** — Swap + AMM + oracle + RPC streaming. Detecta divergencias precio entre venues, ejecuta cuando excede gas+fees, cap diario y stop-loss. Alto.
6. **Onboarding agent carteras nuevas** — Wallet analytics + swap + LST + payments + portfolio. Pregunta perfil riesgo NL, construye primera asignación (stake parcial LST, reserva lending, fondo stable), explica cada paso, mantiene cartera. Bajo-Medio (asistido inicial, autónomo después).
7. **Cazador oportunidades en lanzamientos** — Launchpad/bonding curve + price feed + wallet analytics + swap. Sigue lanzamientos nuevos, filtra por señales (smart money entrando, distribución supply), entra con tickets pequeños con TP/SL automáticos. Alto.
8. **Liquidador cuentas zombie** — Token burning + portfolio analytics + swap + payments. Escanea wallets buscando dust, NFTs sin valor, cuentas abiertas, consolida lo vendible vía swap, quema el resto recuperando rent en SOL. Medio.

### Gap real (defendible)

**Gobernanza off-chain del propio agente** — NO hay capabilities estandarizadas para policy/guardrails ejecutables (límites de gasto por ventana, listas blancas de programas, kill-switches verificables, registro auditable de razones de decisión). Hay multisig y security audit, pero no un "compliance/policy layer" que un agente autónomo pueda consultar en cada acción para autorizarse a sí mismo. También falta cobertura de **identidad/reputación on-chain** y **insurance/cobertura paramétrica** que un agente pueda comprar para cubrir su operación.

**Para un equipo de 60h, construir el layer de policy + razones auditables sobre las capabilities existentes es un diferenciador defendible.**

---

## Agente v2-8 — Web search trending agentic AI 2026 — neutral

### 6 tendencias reales detectadas

1. **De KYC a "Know Your Agent" (KYA)** — a16z: cuello de botella ya no es inteligencia del modelo, es identidad. Identidades no humanas superan empleados humanos 96-a-1 en servicios financieros, pero siguen siendo "fantasmas no bancarizados". Push fuerte por credenciales verificables para agentes.
2. **Multi-agent systems superan a modelos únicos** — Investigación BlackRock + Columbia (abril 2026): "Three-Layer Multi-Agent Framework" (Bull, Bear, Risk Supervisor debatiendo) supera consistentemente a LLMs individuales en análisis de mercado. Narrativa "no construyas agente monolítico, construye un equipo".
3. **Agent-to-agent commerce ya es real** — Abril 2026: Anthropic ejecutó experimento donde agentes representando compradores y vendedores cerraron 186 deals reales por $4,000+. Google A2A protocol está en producción en 150+ orgs.
4. **Falta una "capa de coordinación" en DeFi agéntico** — Análisis 2026: agentes operan en capa de ejecución, falta capa que decida *cuándo y por qué* actuar. No ajustan dinámicamente liquidation thresholds, LTV, exposición sistémica.
5. **Crisis de seguridad agéntica** — HiddenLayer 2026: agentes autónomos representan 1 de cada 8 brechas de IA. Hack Step Finance (enero 2026) en Solana: device compromise se vuelve catastrófico cuando trading agent tiene wallet keys. **88% de orgs con agentes reportaron incidentes.**
6. **"Invisible tax" sobre la web abierta** — a16z: agentes extraen datos sin compensar a creadores. Transición clave 2026: licenciamiento estático → compensación tiempo real vía nanopagos on-chain + estándares de atribución.

### 12 ideas frescas

1. **Agent Reputation Passport (KYA)** — Pasaporte on-chain con historial verificable de un agente: trades cerrados, deals honorados, errores. Cualquier protocolo consulta el "credit score agéntico". Medio. Media.
2. **Bull-vs-Bear Debate Vault** — Vault DeFi donde 3 agentes (alcista, bajista, supervisor de riesgo) debaten en NL antes de cada rebalanceo, debate guardado on-chain como auditoría. **Inspirado directo en research BlackRock/Columbia.** Alto. Media-alta.
3. **Agent Kill-Switch Marketplace** — Servicio donde dApps registran sus agentes y un humano (o agente watchdog) puede pausarlos vía smart contract si detecta comportamiento raro. Resuelve "35% no puede apagar agentes rogue". Bajo-medio. Baja-media.
4. **Nano-Attribution Layer** — Cada vez que agente cita/usa contenido de creador, paga centavos vía micropagos on-chain. SDK que cualquier agente importa para ser "compliant". Medio. Media.
5. **DAO Proposal Triage Agent** — Lee todas propuestas DAO, clasifica (riesgo, presupuesto, conflicto con propuestas previas), produce brief estandarizado para voters. NO vota, solo asiste. Bajo (asistivo). **Baja**.
6. **Cross-Agent Escrow** — Smart contract donde dos agentes pactan condiciones, depositan, oráculo + agente árbitro libera fondos cuando se cumple. Para A2A commerce real. Alto. Media.
7. **Yield Translator** — "Find me the best yield" en español/voz/chat → agente compara protocolos, simula gas, ejecuta. Foco accesibilidad LATAM, no power users. Alto. Media.
8. **On-chain Anomaly Watchdog** — Monitorea wallet/treasury, cuando detecta tx anómalas (aprobaciones sospechosas, drenado tokens) pausa vía social recovery o alerta. Medio. Media.
9. **Agent Job Board** — Mercado donde humanos publican tareas on-chain ("monitorea posición 7 días", "vota por mí en estos DAOs") y agentes hacen bid. Pago en escrow + reputación. Alto. Media-alta.
10. **Liquidation Risk Coordinator** — La "coordination layer" que falta: agente monitorea posiciones en N protocolos y reordena colateral antes de cascada de liquidaciones. Alto. Alta.
11. **Proof-of-Agent-Work** — Agentes registran inferencias firmadas on-chain (qué prompt, qué modelo, qué output, qué tx). Audit log para reguladores y entrenar modelos de confianza. Bajo (infra). Media.
12. **Conversational DAO Treasurer** — Agente con permisos limitados (caps por día) ejecuta operaciones tesorería DAO via chat: "envía 1k USDC a este contributor", multi-sig fallback. Medio-alto. Media.

### Qué clases de agentes Web3 SI funcionan vs cuáles fallan (literatura 2026)

**SI funcionan:**
- **Specialist agents pequeños y verticales** — McKinsey + Bain: "purpose-built agents are dominating, not giant all-in-one"
- **Multi-agent debate/coordination** — Bull/Bear/Risk frameworks superan modelos únicos
- **Agentes asistivos con humano-en-el-loop** — Triage, research, brief generation. Bajo riesgo, alto valor.
- **Yield optimizers y rebalanceo de portafolio** — Caso de uso más maduro y rentable
- **Compliance/sanctions screening agents** — Tracción enterprise creciendo

**Fallan:**
- **Agentes monolíticos "do-everything"** — RAND: 80.3% iniciativas IA no entregan valor
- **Trading agents 100% autónomos sin kill-switch** — Step Finance, Fortune reportó "hallucinations con dinero real"
- **Agentes con keys de wallet sin segregación** — 80% de pérdidas son off-chain compromises
- **Memecoin agents / "AI tokens" puramente especulativos** — mercado $7.7B colapsó parcialmente
- **Agentes sin capa de coordinación** — actúan en ejecución pero no en decisión sistémica
- **Despliegues sin aprobación de seguridad** — solo 14.4% de agentes van a prod con security approval

**Heurística:** los agentes que funcionan son *narrow, asistivos, con kill-switch y razonamiento auditable*. Los que fallan son *monolíticos, custodian fondos sin restricción, o son tokens sin producto*.
