# [v2 — SESGADA POR REGIÓN] Ideas IA Agéntica — Síntesis con sesgo demográfico

> ⚠️ **Esta versión sigue contaminada por sesgo de prompt en otra dimensión.** Aunque eliminé las menciones a tracks/sponsors (ElevenLabs/Li.Fi/x402), incluí en cada prompt: "Equipo de 3 estudiantes (**Universidad Javeriana, Colombia**, primer hackathon)". Eso sesgó hacia ideas LATAM-específicas, sector universitario, y temas educativos:
> - **CampusDAO Javeriana** (mi top #1) — directo eco de "Universidad Javeriana"
> - CongresoMirror Colombia, ClinicaTriage zonas con pocos médicos, GuardiánBeca, AsambleaIA, Curador
> - Remesa Agent LATAM, Multi-Agent Study Group, Agente Beca/Subsidio
> - Asistente onboarding LATAM, Yield Translator español
>
> Se preserva para comparación con v3 (prompts sin contexto demográfico). Outputs crudos en `agent-outputs-v2-region-biased.md`.
>
> ---
>
> Resultado de 8 agentes con prompts neutros. NO se mencionaron tracks, sponsors (ElevenLabs, Li.Fi, x402), ni se recomendaron herramientas concretas como diferenciador. Solo: "IA agéntica para Web3/Solana, equipo 3 estudiantes Javeriana 60h".
>
> ~80 ideas crudas → consolidadas en convergencias REALES.
> Outputs crudos en `agent-outputs-v2.md`. Comparación con v1 sesgada al final.

---

## Convergencias REALES (señal de mercado, no eco)

Patrones que aparecieron en MÚLTIPLES agentes independientes con prompts limpios:

### 🎯 #1 — Tesorería autónoma para DAO/comunidad/grupo (6/8 agentes)

Apareció en Awesome Solana AI (Treasury copilot DAO estudiantil), Skills directories (Tesorería autónoma DAOs), Vibe coding (Tesorero agéntico), Past winners (CampusDAO Treasurer), Web search (Conversational DAO Treasurer), Colosseum (MicroEconomíaAgente).

**Patrón compartido:** agente con permisos limitados de multisig, propone movimientos (a veces ejecuta dentro de policy), miembros aprueban con quorum para acciones grandes. Reportes en NL.

### 🎯 #2 — Reputation/trust/identity layer para agentes (6/8 agentes)

Apareció en Awesome Solana AI (Reputation layer attestations), SendAI (Marketplace of Trust + Onchain Identity + LinkedIn for AI agents), Colosseum (PactoAgente reputación), Skills directories (gap detectado), Past winners (KYA tendencia clave), Web search (Agent Reputation Passport + Proof-of-Agent-Work).

**Tendencia macro:** **a16z 2026 lo nombra "Know Your Agent" (KYA).** Identidades no humanas superan a humanas 96-a-1 en servicios financieros pero siguen siendo "fantasmas no bancarizados".

### 🎯 #3 — Multi-agent debate/coordination (5/8 agentes)

Apareció en SendAI (Jedi Council), Colosseum (GremioDAO + AldeaSim + AsambleaIA), Vibe coding (Negotiation Agents OTC), Past winners patrón D, Web search (Bull-vs-Bear Debate Vault).

**Validación científica:** investigación **BlackRock + Columbia (abril 2026)** demostró que un Three-Layer Multi-Agent Framework (Bull/Bear/Risk Supervisor debatiendo) supera consistentemente a LLMs individuales en análisis de mercado. La narrativa "no construyas agente monolítico, construye un equipo" se está consolidando.

### 🎯 #4 — Multi-agent task marketplaces / A2A commerce (5/8 agentes)

Apareció en Awesome Solana AI (Mercado micro-servicios A2A), Vibe coding (Onchain Task Marketplace), Colosseum (GremioDAO marketplace), SendAI (LinkedIn for AI agents), Web search (Cross-Agent Escrow + Agent Job Board).

**Validación:** **Anthropic ejecutó experimento abril 2026** donde agentes compradores/vendedores cerraron 186 deals reales por $4,000+. Google A2A protocol en producción en 150+ orgs.

### 🎯 #5 — Policy/guardrails layer / kill-switches (4/8 agentes — GAP DEFENDIBLE)

Apareció en Skills directories (gap explícito "gobernanza off-chain del propio agente"), Vibe coding (Compliance/Risk Co-pilot), Web search (Agent Kill-Switch Marketplace), Past winners patrón F (red-teaming JailbreakMe ganó $20K).

**Tendencia crítica:** HiddenLayer 2026 — agentes autónomos representan 1 de cada 8 brechas IA. **88% de orgs con agentes reportaron incidentes.** Solo 14.4% de despliegues tienen security approval. Hack Step Finance (enero 2026 en Solana) mostró catástrofe cuando trading agent tiene wallet keys sin segregación.

### 🎯 #6 — Verifiable reasoning / signed reasoning trails (4/8 agentes)

Apareció en Colosseum (AcademiaProof + Curador con citas firmadas + DiarioDeCampo timestamping), Awesome Solana AI gap "observabilidad y debugging de agentes en runtime", SendAI patrón "Verificación externa antes de pagar/ejecutar", Web search (Proof-of-Agent-Work).

**Patrón:** agentes registran sus pasos de razonamiento (prompt, modelo, output, tx) firmados on-chain. Audit log auditable post-hoc.

### 🎯 #7 — Sectores no-DeFi (educación, salud, gobernanza, periodismo) (4/8 agentes)

Apareció en Awesome Solana AI gaps, Colosseum gaps + ideas (AcademiaProof, ClinicaTriage, CongresoMirror, GuardiánBeca, AsambleaIA), Past winners ideas (Multi-Agent Study Group, Agente Beca/Subsidio), Web search (DAO Proposal Triage).

**Insight:** todos los agentes hackathon están saturados en trading/DeFi. Educación, salud, gobernanza pública, periodismo y agricultura son **zonas blancas reales**.

### 🎯 #8 — LATAM-specific / regional (4/8 agentes)

Apareció en Colosseum (CongresoMirror Colombia + ClinicaTriage zonas con pocos médicos + GuardiánBeca + AsambleaIA + Curador), Past winners (Remesa Agent LATAM), Awesome Solana AI gap "compliance/KYC LATAM relevante", Web search (Yield Translator español).

**Insight:** "Todos los agentes son globales/anglosajones por defecto" — Colosseum agent. El equipo Javeriana es LATAM = unfair advantage real (idioma, contexto, regulación local).

### 🎯 #9 — Risk management / liquidation guardian (4/8 agentes)

Apareció en Skills directories (Defensor de salud crediticia), Past winners (Memecoin Risk Triage), Web search (Liquidation Risk Coordinator + On-chain Anomaly Watchdog), Vibe coding (Compliance/Risk Co-pilot).

**Tendencia:** **falta una "capa de coordinación" en DeFi agéntico.** Análisis 2026: agentes operan en ejecución pero no ajustan dinámicamente liquidation thresholds, LTV, exposición sistémica.

### 🎯 #10 — Autonomous economic actors (4/8 agentes)

Apareció en SendAI (On-chain inference + Fractionalized Agent Earnings + DePIN agent autosustentable), Awesome Solana AI (Mercado micro-servicios), Colosseum (MicroEconomíaAgente), Past winners (patrón implícito).

**Patrón:** agente con wallet propia, paga su inferencia LLM, genera ingresos por servicio, reinvierte en compute. Selección darwiniana de agentes.

---

## Top 7 finalistas — rankeadas por equipo Javeriana

Criterios: convergencia entre agentes (señal real) + factibilidad para 3 estudiantes/60h primer hackathon + ataca patrón ganador histórico.

### 🏆 #1 — Conversational DAO Treasurer / CampusDAO Javeriana

**Convergencia 6/8** | Patrón ganador A+B (DeFi conversacional + gestión financiera) | Complejidad Media

Agente con permisos limitados sobre multisig de la Javeriana (o un grupo estudiantil), propone movimientos en español NL ("convertí 30% del fondo de eventos a USDC" o "envía 200 USDC a contributor X"), ejecuta dentro de policy declarada, requiere quorum humano para acciones grandes. Reportes semanales en lenguaje natural. Audit trail on-chain de cada decisión.

- **Stack mínimo:** Multisig SDK + agent framework + LLM + Anchor escrow simple + frontend Next.js
- **Unfair advantage:**
  - Storytelling local imbatible: "somos los autores y lo usamos hoy en la Javeriana"
  - Combina 2 patrones ganadores (Cleopetra $15K, Plutus $15K usaron variantes)
  - LATAM-specific en español
  - Tiene policy/guardrails layer naturalmente (gap defendible)
- **Riesgo:** scope se infla rápido. Mantener UNA feature core (ej. solo pago a contributors aprobado).

### 🥇 #2 — Bull-vs-Bear Debate Vault

**Convergencia 5/8** | Patrón ganador D (Multi-agente coordinado) | Complejidad Media-alta

Vault DeFi donde 3 agentes (alcista, bajista, supervisor de riesgo) debaten en lenguaje natural antes de cada rebalanceo del portafolio. El debate completo se guarda on-chain como auditoría inmutable. Usuarios pueden auditar EL RAZONAMIENTO, no solo el resultado.

- **Stack:** 3 LLMs con personas distintas + agent framework + un yield aggregator + on-chain log
- **Unfair advantage:**
  - **Validación científica peer-reviewed** (BlackRock/Columbia abril 2026 demostró que supera a LLMs individuales)
  - Demo escénico fuerte: ver agentes debatiendo en vivo
  - Verifiable reasoning natural (debate firmado on-chain)
  - Ataca tendencia macro 2026 ("multi-agent supera monolítico")
- **Riesgo:** la lógica de debate puede degenerar en bucles. Mitigar con time-box y supervisor con poder de veto.

### 🥇 #3 — Agent Reputation Passport (KYA)

**Convergencia 6/8** | Patrón ganador C (Infra/SDK) | Complejidad Media

Pasaporte on-chain con historial verificable de un agente AI: trades cerrados, deals honorados con otros agentes, errores documentados, attestations firmadas por contrapartes. Cualquier protocolo o agente puede consultar el "credit score agéntico" antes de delegarle fondos o aceptar interactuar.

- **Stack:** Schema on-chain (cNFTs comprimidos viables) + agent framework + verificadores + UI consulta
- **Unfair advantage:**
  - "Pico y pala" puro — patrón ganador C (FXN ganó $30K, AgentiPy $15K, ZkAGI $5K con esta estrategia)
  - **Tendencia a16z 2026 ("KYA")** — backing intelectual fuerte
  - Producto deployable post-hackathon con tracción inmediata
  - Cualquier proyecto agéntico futuro lo necesitará
- **Riesgo:** el "wow demo" es menor. Mitigar con dashboard visual de scores + simulación de delegación de fondos en vivo.

### 🥈 #4 — Agent Kill-Switch / Watchdog (gap defendible)

**Convergencia 4/8** | Patrón ganador F (red-teaming, JailbreakMe ganó $20K) | Complejidad Baja-Media

Servicio donde cualquier dApp registra a sus agentes AI, y un humano (o un agente watchdog) puede pausarlos vía smart contract si detecta comportamiento raro. Incluye policy declarativo: "máx N USDC por hora", "solo programas en allowlist", "kill-switch si pierde >5% en una hora".

- **Stack:** Smart contract policy registry + monitor con webhooks + UI para definir reglas
- **Unfair advantage:**
  - **Gap explícitamente identificado** por Skills agent (capability NO existe)
  - Tendencia 2026: 88% orgs con agentes reportaron incidentes, solo 14.4% tienen security approval
  - Hack Step Finance (Solana enero 2026) hace narrativa concreta
  - Bajo riesgo técnico, scope claro
- **Riesgo:** menos "viral" que un trading bot. Mitigar mostrando una situación de hack en vivo y kill-switch parándolo.

### 🥈 #5 — DAO Proposal Triage Agent

**Convergencia 3/8** | Patrón ganador "asistivo con humano-en-loop" | Complejidad Baja

Agente que lee todas las propuestas de un DAO (puede ser Realms, Squads, o cualquier governance), las clasifica (riesgo, presupuesto, conflicto con propuestas previas, alignment con misión declarada), y produce un brief estandarizado para voters. **NO vota, solo asiste.** Voter fatigue resuelto.

- **Stack:** RPC indexer + LLM + persistent storage + UI dashboard
- **Unfair advantage:**
  - Complejidad **baja** — el más realista para 3 estudiantes primer hackathon
  - Patrón "asistivo con humano-en-loop" es lo que la literatura 2026 dice que funciona
  - Demo es claro y no requiere ejecutar tx
- **Riesgo:** menor agencia → menor "wow factor" → menor premio top.

### 🥉 #6 — Cross-Agent Escrow (A2A commerce)

**Convergencia 5/8** | Patrón ganador C+D | Complejidad Media

Smart contract donde dos agentes pactan condiciones de un servicio ("agente A traduce documento por 5 USDC en 24h"), depositan en escrow, y un oráculo + agente árbitro libera fondos cuando se cumple. Pensado específicamente para A2A commerce real.

- **Stack:** Anchor escrow + agent framework × 3 (cliente, proveedor, árbitro) + simple oracle
- **Unfair advantage:**
  - Validación: Anthropic test marketplace 186 deals, $4K+ (abril 2026)
  - Demo entretenida: dos agentes negociando real money en vivo
  - Combina A2A commerce + verifiable reasoning + reputation
- **Riesgo:** la "negociación" puede ser frágil. Mitigar con scripts de demo + protocolo de resolución determinístico.

### 🥉 #7 — Verifiable Reasoning Layer (Proof-of-Agent-Work)

**Convergencia 4/8** | Infra play | Complejidad Media

SDK ligero que cualquier agente AI puede importar para registrar sus inferencias firmadas on-chain (qué prompt, qué modelo, qué output, qué tx ejecutó). Útil como audit log para reguladores, para entrenar modelos de confianza, y para que agentes consumidores validen agentes proveedores.

- **Stack:** SDK (~300 líneas TS) + commit-reveal scheme on-chain + viewer público
- **Unfair advantage:**
  - Drop-in para cualquier framework agéntico (Eliza, GOAT, SAK, custom)
  - Resuelve gap "observabilidad y debugging de agentes en runtime" (Awesome Solana AI gap)
  - Patrón ganador C ("pico y pala")
  - SOLPRISM ya lo intentó pero como protocolo standalone — esto es SDK plug-and-play

---

## Tier C — descartadas para 60h / primer hackathon

| Idea | Por qué se descarta |
|------|---------------------|
| **Trading agent 100% autónomo** | Literatura 2026: fallan masivamente, requieren security audit serio, riesgo de pérdidas reales en demo |
| **Coordinación multi-agente económica completa** (Bittensor-style) | Demasiado grande para 60h |
| **Agentes con ZK / privacy completa** | Light Protocol + ZK proofs requieren expertise que un primer hackathon no tiene |
| **DePIN autosustentable** | Loop económico complejo, requiere tener tokens + sensores + integraciones |
| **Memecoin AI agents** | Mercado $7.7B colapsó parcialmente, jueces escarmentados |

---

## Comparación v1 (sesgada) vs v2 (neutral)

| Tema | v1 convergencia | v2 convergencia | Veredicto |
|------|----------------|----------------|-----------|
| **Voice + Cross-chain Li.Fi** | 8/8 | 0/8 | ❌ **ECO del prompt** |
| **x402 micropagos como ángulo central** | 6/8 | mencionado solo como infra genérica | ❌ **ECO del prompt** |
| **ElevenLabs como diferenciador** | 7/8 | 0/8 | ❌ **ECO del prompt** |
| **Robotics + x402** | 4/8 | 0/8 | ❌ **ECO del prompt** |
| **Solana Mobile específico** | 3/8 | 0/8 | ❌ **ECO del prompt** |
| **CampusDAO Javeriana** | 3/8 | 6/8 | ✅ **SEÑAL** (más fuerte sin sesgo) |
| **Multi-agent debate** | 4/8 | 5/8 | ✅ **SEÑAL** |
| **Reputation/trust agentes / KYA** | 2/8 | 6/8 | ✅✅ **SEÑAL FUERTE** (oculta en v1) |
| **Policy/guardrails / kill-switches** | 0/8 | 4/8 | ✅✅ **SEÑAL NUEVA** (no aparecía en v1) |
| **Sectores no-DeFi** | 1/8 | 4/8 | ✅ **SEÑAL** (sesgo de tracks lo escondió) |
| **LATAM-specific** | 1/8 | 4/8 | ✅ **SEÑAL** |
| **Verifiable reasoning** | 0/8 | 4/8 | ✅ **SEÑAL NUEVA** |
| **A2A marketplaces** | 1/8 | 5/8 | ✅✅ **SEÑAL FUERTE** |
| **Risk/liquidation guardian** | 1/8 | 4/8 | ✅ **SEÑAL** |

### Lección metodológica

El sesgo de v1 fue listar tracks/sponsors específicos en el prompt. Los agentes orbitaron alrededor de las marcas mencionadas. La "convergencia 8/8 voice+Li.Fi" no era señal de mercado, era un eco multiplicado del input.

v2 con prompts neutros revela patrones REALMENTE convergentes: tesorería autónoma, KYA/reputation, multi-agent debate, A2A commerce, policy layer, verifiable reasoning. Y abre dimensiones enteras que v1 ocultó: LATAM, sectores no-DeFi, autonomous economic actors.

---

## Recomendación final actualizada (post-debiased)

**Pick: #1 Conversational DAO Treasurer / CampusDAO Javeriana** + plan B = **#5 DAO Proposal Triage Agent** si scope se infla.

Razones:
1. Convergencia genuina 6/8 sin sesgo
2. Combina 3 patrones ganadores (DeFi conversacional + gestión financiera + asistivo con humano-en-loop)
3. **Storytelling local imbatible**: 3 estudiantes Javeriana construyendo y usando treasury para su grupo HOY
4. LATAM-specific en español = unfair advantage real
5. Policy/guardrails layer es natural en este contexto (gap defendible)
6. Stack accesible para junior team
7. Plan B (#5 Triage) usa 70% del mismo stack y es estrictamente más fácil

**Alternativas de equilibrio diferente:**
- Si quieren maximizar **demo wow factor** → **#2 Bull-vs-Bear Debate Vault** (verás agentes debatiendo en vivo)
- Si quieren maximizar **post-hackathon traction** → **#3 Agent Reputation Passport** (pico y pala, todo el ecosistema lo necesita)
- Si quieren minimizar **riesgo técnico** → **#5 DAO Proposal Triage Agent** (el más fácil, asistivo)

**Antes de comprometerse:**
1. Validar idea contra Colosseum Copilot (https://colosseum.com/copilot)
2. Confirmar tracks/bounties oficiales del Dev3pack en `docs/member-resources.md` y mappear la idea elegida a tracks
3. Si la idea elegida no encaja con ningún track del hackathon Y el equipo realmente la cree mejor, considerar trade-off (probabilidad ganar vs orgullo de proyecto)

---

## Fuentes principales (web search v2)

- [a16z crypto: AI in 2026 — 3 trends](https://a16zcrypto.com/posts/article/trends-ai-agents-automation-crypto/)
- [BlackRock + Columbia — Multi-Agent Crypto Analysis 2026](https://www.kucoin.com/blog/ai-agents-vs-llms-crypto-analysis-market-2026)
- [Anthropic agent-on-agent commerce experiment (TechCrunch)](https://techcrunch.com/2026/04/25/anthropic-created-a-test-marketplace-for-agent-on-agent-commerce/)
- [HiddenLayer 2026 AI Agent Security Breaches](https://beam.ai/agentic-insights/ai-agent-security-breaches-2026-lessons)
- [Cryptopolitan: 2026 year of AI agent crisis](https://www.cryptopolitan.com/how-2026-is-the-year-of-ai-agent-crisis/)
- [arXiv: LLM-Powered Multi-Agent for Crypto Portfolio](https://arxiv.org/pdf/2501.00826)
- [McKinsey: Agentic commerce opportunity](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants)
- [Solana AI Hackathon Past Winners (SolanaFloor)](https://solanafloor.com/news/from-ideas-to-impact-meet-the-hackathon-winners-powering-solana-s-ai-revolution)
