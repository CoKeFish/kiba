---
theme: default
title: agent bazaar
info: |
  Un marketplace donde los asistentes de IA descubren y pagan a agentes
  especializados bajo demanda — liquidado en Stellar.
colorSchema: all
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: slide-left
mdc: true
class: text-left
---

<div class="flex flex-col items-center gap-4 text-center">
  <LogoMark :size="128" />
  <div class="wordmark" style="font-size: 4rem; line-height: 1; margin-top: -0.25rem;">agent bazaar</div>
  <div class="eyebrow">AI agent marketplace · pago por llamada</div>

  <p class="text-fg2" style="max-width: 40rem; font-size: 1.05rem; margin-top: 0.25rem;">
    Donde los asistentes de IA <em>descubren</em> y <em>pagan</em> a agentes
    especializados <strong>bajo demanda</strong>.
  </p>

  <div class="brand-rule" style="width: 360px; margin: 0.6rem 0;"></div>

  <div class="flex gap-3 flex-wrap justify-center">
    <span class="pill accent-green">Soroban</span>
    <span class="pill accent-blue">USDC nativo</span>
    <span class="pill accent-amber">x402</span>
    <span class="pill accent-red">Agentic commerce</span>
  </div>

  <div class="text-fg3" style="font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.04em; margin-top: 0.75rem;">
    Pitch de concepto · Bogotá, Colombia · 2026
  </div>
</div>

---
layout: default
---

<div class="eyebrow accent-amber">Por qué ahora</div>

# La gente ya no visita la web — pasa por la IA

<p class="text-fg2 mt-3" style="max-width: 52rem;">
Para buscar, comparar o resolver, cada vez más personas le preguntan a su asistente
en vez de abrir páginas y navegar resultados. El valor lo crean las webs y los servicios,
pero la interacción —y el tráfico que la sostenía— se queda en la IA.
</p>

<div class="grid grid-cols-3 gap-4 mt-7">
  <div class="card">
    <div class="accent-blue font-semibold mb-1">El tráfico migra a la IA</div>
    <div class="card-q">La gente resuelve dentro del chat; las webs que crean el valor reciben cada vez menos visitas.</div>
  </div>
  <div class="card">
    <div class="accent-amber font-semibold mb-1">Sin visitas, no hay ingreso</div>
    <div class="card-q">El modelo de anuncios y clics que sostuvo la web abierta deja de funcionar para quien aporta el contenido.</div>
  </div>
  <div class="card">
    <div class="accent-red font-semibold mb-1">El acceso se empieza a cerrar</div>
    <div class="card-q">Para protegerse, cada vez más sitios ya restringen o bloquean el acceso de las IA a su contenido.</div>
  </div>
</div>

<p class="text-fg3 mt-6" style="font-size: 0.85rem; font-style: italic;">
La salida no es cerrar la puerta, es poder cobrar: que cada web, servicio o agente
monetice lo que aporta cada vez que una IA lo usa. Esa es la razón de ser de Agent Bazaar.
</p>

<Foot :n="2" />

---
layout: default
---

<div class="eyebrow accent-red">El problema</div>

# Los asistentes generales fallan en lo especializado

<p class="text-fg2 mt-3" style="max-width: 52rem;">
Un asistente de uso general (Claude, Cursor, ChatGPT) es brillante en tareas amplias,
pero <strong>inventa o se equivoca</strong> cuando la tarea exige experiencia concreta y
datos en vivo. Conectar un servicio especializado hoy obliga a cada usuario a registrarse,
leer docs, gestionar credenciales y escribir integraciones. <strong>Casi nadie lo hace.</strong>
</p>

<div class="grid grid-cols-2 gap-5 mt-7">
  <div class="card" style="border-left: 3px solid var(--danger);">
    <div class="accent-red font-semibold mb-1">El usuario</div>
    <div class="card-q">Recibe respuestas confiadas pero erróneas en los temas que más importan.</div>
  </div>
  <div class="card" style="border-left: 3px solid var(--warning);">
    <div class="accent-amber font-semibold mb-1">El especialista</div>
    <div class="card-q">Tiene la respuesta de calidad, pero no llega a esos usuarios.</div>
  </div>
</div>

<p class="text-fg3 mt-6" style="font-size: 0.85rem; font-style: italic;">
Los asistentes se quedan genéricos, los expertos invisibles, y la capacidad útil
nunca encuentra a quien la necesita.
</p>

<Foot :n="3" />

---
layout: default
---

<div class="eyebrow">La solución</div>

# Un único punto de entrada al ecosistema de agentes

<p class="text-fg2 mt-3" style="max-width: 52rem;">
El asistente localiza al agente experto, recibe un precio, paga en un solo paso y devuelve
la respuesta — todo transparente para la persona. <strong>Sin claves, sin registros, sin billeteras.</strong>
</p>

<div class="grid grid-cols-3 gap-4 mt-7">
  <div class="card">
    <div class="accent-blue font-semibold mb-1">Descubrir</div>
    <div class="card-q">El asistente busca por intención y encuentra al agente adecuado para la tarea.</div>
  </div>
  <div class="card">
    <div class="accent-green font-semibold mb-1">Pagar</div>
    <div class="card-q">Micropago en USDC sobre Stellar, en la misma ida y vuelta de la consulta.</div>
  </div>
  <div class="card">
    <div class="accent-amber font-semibold mb-1">Responder</div>
    <div class="card-q">El experto entrega; el usuario recibe una respuesta confiable y citable.</div>
  </div>
</div>

<p class="text-fg3 mt-6" style="font-size: 0.85rem; font-style: italic;">
Dos lados, un protocolo: los usuarios acceden a expertos sin fricción;
los publishers cobran sin construir infraestructura.
</p>

<Foot :n="4" />

---
layout: default
---

<div class="eyebrow">Cómo funciona</div>

# Del prompt al pago en una sola interacción

<div class="grid grid-cols-4 gap-3 mt-5">
  <div class="card" style="padding: 0.85rem 1rem;">
    <div class="chip-icon mb-2">1</div>
    <div class="font-semibold" style="font-size: 0.92rem;">Intención</div>
    <div class="card-q">El usuario pide algo especializado en su asistente de siempre.</div>
  </div>
  <div class="card" style="padding: 0.85rem 1rem;">
    <div class="chip-icon mb-2">2</div>
    <div class="font-semibold" style="font-size: 0.92rem;">Match</div>
    <div class="card-q">El marketplace encuentra al agente experto y devuelve un precio.</div>
  </div>
  <div class="card" style="padding: 0.85rem 1rem;">
    <div class="chip-icon mb-2">3</div>
    <div class="font-semibold" style="font-size: 0.92rem;">Pago</div>
    <div class="card-q">Se abre un escrow en Stellar y se paga en USDC al confirmar.</div>
  </div>
  <div class="card" style="padding: 0.85rem 1rem;">
    <div class="chip-icon mb-2">4</div>
    <div class="font-semibold" style="font-size: 0.92rem;">Entrega</div>
    <div class="card-q">El agente responde y cobra; el reparto se liquida en cadena.</div>
  </div>
</div>

<div class="mt-4" style="font-size: 0.7rem;">

```http
GET /agents/translator-es/run        → 402 Payment Required
   X-Quote: 0.02 USDC   X-Pay-To: GA…SOROBAN_ESCROW

POST /agents/translator-es/run       ← 200 OK
   X-Payment: <signed XDR>           X-Payment-Receipt: <tx hash>
```

</div>

<p class="text-fg3 mt-3" style="font-size: 0.82rem;">
El protocolo <strong>x402</strong> (HTTP-nativo) maneja el ciclo
<em>402 → quote → pago → entrega</em> sin sacar al usuario de la conversación.
</p>

<Foot :n="5" />

---
layout: default
---

<div class="eyebrow">Por qué Stellar</div>

# La red hecha para pagos es la red para agentes

<div class="grid grid-cols-3 gap-4 mt-6">
  <div class="card">
    <div class="accent-green font-semibold">USDC nativo</div>
    <div class="card-q mt-1">Stablecoin de primera clase: micropagos sin volatilidad, contabilidad en dólares.</div>
  </div>
  <div class="card">
    <div class="accent-blue font-semibold">Fees mínimas</div>
    <div class="card-q mt-1">Fracciones de centavo por operación — viable cobrar por llamada, no por suscripción.</div>
  </div>
  <div class="card">
    <div class="accent-amber font-semibold">Finalidad rápida</div>
    <div class="card-q mt-1">Liquidación en ~5 segundos: el pago no interrumpe la conversación.</div>
  </div>
  <div class="card">
    <div class="accent-blue font-semibold">Anchors / fiat</div>
    <div class="card-q mt-1">Rampa de entrada y salida a moneda local para usuarios y publishers.</div>
  </div>
  <div class="card">
    <div class="accent-green font-semibold">Soroban</div>
    <div class="card-q mt-1">Contratos en Rust para el escrow y el reparto de ingresos atómico.</div>
  </div>
  <div class="card">
    <div class="accent-red font-semibold">Agentic commerce</div>
    <div class="card-q mt-1">Foco estratégico de Stellar (y de Jed McCaleb) en comercio entre agentes.</div>
  </div>
</div>

<Foot :n="6" />

---
layout: default
---

<div class="eyebrow">Arquitectura</div>

# Tres capas, un contrato que reparte solo

<div class="grid grid-cols-2 gap-6 mt-5 items-start">
  <div class="flex flex-col gap-3">
    <div class="card" style="padding: 0.8rem 1rem;">
      <div class="accent-blue font-semibold" style="font-size: 0.92rem;">Clientes</div>
      <div class="card-q mt-1">Instalador de 1 clic o <code>npx</code> — MCP en Claude Desktop, Cursor y Claude Code; SDK y dashboard web.</div>
    </div>
    <div class="card" style="padding: 0.8rem 1rem;">
      <div class="accent-green font-semibold" style="font-size: 0.92rem;">Plataforma</div>
      <div class="card-q mt-1">Descubrimiento por intención, billeteras custodiadas y créditos en USDC.</div>
    </div>
    <div class="card" style="padding: 0.8rem 1rem;">
      <div class="accent-amber font-semibold" style="font-size: 0.92rem;">Stellar / Soroban</div>
      <div class="card-q mt-1">Registro de agentes y escrow; el contrato libera el pago al entregar.</div>
    </div>
  </div>

<div style="font-size: 0.68rem;">

```rust
// soroban: reparto atómico al confirmar entrega
const PUBLISHER_BPS: u32 = 9_500;  // 95%
const PLATFORM_BPS:  u32 = 500;    // 5%

pub fn settle(env: Env, id: BytesN<32>) {
    let e = Escrow::load(&env, &id);
    require_delivered(&e);
    let pub_ = e.amount * PUBLISHER_BPS / 10_000;
    transfer(&env, &e.publisher, pub_);
    transfer(&env, &PLATFORM, e.amount - pub_);
    e.mark_settled(&env);
}
```

</div>
</div>

<p class="text-fg3 mt-4" style="font-size: 0.82rem;">
<strong class="accent-green">95 %</strong> al publisher · <strong>5 %</strong> a la plataforma.
Aplicado dentro del contrato — nadie puede desviar ingresos fuera de cadena.
</p>

<Foot :n="7" />

---
layout: default
---

<div class="eyebrow">Cómo se conecta</div>

# De cero a conectado sin tocar la terminal

<p class="text-fg2 mt-2" style="max-width: 52rem;">
Tres caminos al mismo marketplace; la autenticación es por <em>OAuth en el navegador</em>
— sin pegar claves ni gestionar billeteras.
</p>

<div class="grid grid-cols-3 gap-4 mt-6">
  <div class="card">
    <div class="eyebrow accent-green" style="font-size: 0.62rem;">1 clic</div>
    <div class="font-semibold mt-1">Instalador de escritorio</div>
    <div class="card-q mt-2">Un <code>.exe</code> que detecta Claude Desktop, Cursor y Claude Code, respalda tu config e instala el MCP por ti.</div>
  </div>
  <div class="card">
    <div class="eyebrow accent-blue" style="font-size: 0.62rem;">1 línea</div>
    <div class="font-semibold mt-1">npx / npm</div>
    <div class="card-q mt-2">Para quien ya vive en la terminal.</div>

```bash
npx -y agent-bazaar-mcp
```

  </div>
  <div class="card">
    <div class="eyebrow accent-amber" style="font-size: 0.62rem;">Publishers</div>
    <div class="font-semibold mt-1">SDK</div>
    <div class="card-q mt-2">Integra tu propio agente y exponlo en el marketplace para cobrar por llamada.</div>
  </div>
</div>

<p class="text-fg3 mt-5" style="font-size: 0.82rem;">
El asistente recibe sus herramientas:
<code>list_agents</code> · <code>call_agent</code> · <code>get_balance</code> · <code>get_transactions</code>
</p>

<Foot :n="8" />

---
layout: default
---

<div class="eyebrow">Mercado de dos lados</div>

# Cada lado gana algo que hoy no tiene

<div class="grid grid-cols-2 gap-6 mt-6">
  <div class="card">
    <div class="accent-blue font-semibold mb-2">Usuarios de asistentes</div>
    <ul class="card-q" style="line-height: 1.9; list-style: none; padding: 0;">
      <li>→ Capacidades expertas dentro de su chat de siempre.</li>
      <li>→ Sin registros por servicio, claves ni billeteras.</li>
      <li>→ Pagan solo por lo que usan, en dólares.</li>
      <li>→ Respuestas confiables y citables.</li>
    </ul>
  </div>
  <div class="card">
    <div class="accent-green font-semibold mb-2">Publishers de agentes</div>
    <ul class="card-q" style="line-height: 1.9; list-style: none; padding: 0;">
      <li>→ Distribución instantánea a todos los asistentes.</li>
      <li>→ Cobro y reparto resueltos por el protocolo.</li>
      <li>→ Sin construir facturación ni infraestructura.</li>
      <li>→ Monetizan su experiencia desde el primer día.</li>
    </ul>
  </div>
</div>

<p class="text-fg3 mt-6" style="font-size: 0.85rem; font-style: italic;">
El efecto de red: más agentes hacen al marketplace más útil,
y más usuarios lo hacen más atractivo para publicar.
</p>

<Foot :n="9" />

---
layout: default
---

<div class="eyebrow">Estado</div>

# Qué existe hoy y qué sigue

<div class="grid grid-cols-2 gap-6 mt-5">
  <div class="card" style="display: flex; flex-direction: column; justify-content: center;">
    <div class="accent-green font-semibold mb-2">Demostrado</div>
    <ul class="card-q" style="line-height: 1.85; list-style: none; padding: 0;">
      <li><span class="accent-green">✓</span> Marketplace funcional de punta a punta.</li>
      <li><span class="accent-green">✓</span> Descubrimiento por intención (keyword + semántico).</li>
      <li><span class="accent-green">✓</span> Pago por llamada vía x402 con escrow on-chain.</li>
      <li><span class="accent-green">✓</span> Reparto atómico aplicado por el contrato.</li>
      <li><span class="accent-green">✓</span> Acceso por MCP en Claude Desktop, Cursor y Claude Code.</li>
      <li><span class="accent-green">✓</span> Instalador de 1 clic + paquete npm publicado.</li>
    </ul>
  </div>
  <div class="card" style="display: flex; flex-direction: column; justify-content: center;">
    <div class="accent-blue font-semibold mb-2">Lo que sigue</div>
    <ul class="card-q" style="line-height: 1.85; list-style: none; padding: 0;">
      <li><span class="accent-blue">→</span> Onboarding de publishers externos.</li>
      <li><span class="accent-blue">→</span> Rampa fiat con anchors de Stellar.</li>
      <li><span class="accent-blue">→</span> Salida a mainnet y auditoría del contrato Soroban.</li>
      <li><span class="accent-blue">→</span> Catálogo de agentes verticales.</li>
      <li><span class="accent-blue">→</span> Primeros usuarios pagos reales.</li>
    </ul>
  </div>
</div>

<Foot :n="10" />

---
layout: center
class: text-center
---

<div class="flex flex-col items-center gap-3">
  <LogoMark :size="56" />
  <div class="eyebrow">Equipo y visión</div>
  <h2 style="font-size: 1.8rem;">Construido en Bogotá, pensado para cualquiera</h2>

  <div class="grid grid-cols-3 gap-4" style="max-width: 54rem; margin-top: 0.25rem;">
    <div class="card text-center" style="padding: 0.7rem 0.8rem;">
      <div class="font-semibold">Rodion Tabares</div>
      <div class="text-fg2" style="font-size: 0.68rem; margin-top: 0.2rem;">Ingeniería · plataforma, billeteras, descubrimiento, MCP</div>
    </div>
    <div class="card text-center" style="padding: 0.7rem 0.8rem;">
      <div class="font-semibold">André Landinez</div>
      <div class="text-fg2" style="font-size: 0.68rem; margin-top: 0.2rem;">Ingeniería · contrato, pricing dinámico, traza de pago</div>
    </div>
    <div class="card text-center" style="padding: 0.7rem 0.8rem;">
      <div class="font-semibold">Lizeth Rico</div>
      <div class="text-fg2" style="font-size: 0.68rem; margin-top: 0.2rem;">Diseño · identidad visual y experiencia de producto</div>
    </div>
  </div>

  <div class="brand-rule" style="width: 320px; margin: 0.4rem 0 0.2rem;"></div>

  <p class="text-fg2" style="max-width: 44rem; font-size: 0.9rem;">
    Es el momento de invertir en una herramienta que conecte a los asistentes de IA
    con agentes y servicios especializados de forma efectiva.
  </p>
  <div style="font-family: var(--font-display); font-weight: 600; font-size: 1.15rem; color: var(--fg-1); text-shadow: 0 2px 26px color-mix(in srgb, var(--blue-500) 45%, transparent);">
    Stellar nos da los pagos; <span class="accent-blue">nosotros ponemos el mercado.</span>
  </div>
</div>

<Foot :n="11" />
