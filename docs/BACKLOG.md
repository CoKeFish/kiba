# Kiba — Backlog

Tareas conocidas pendientes, no bloqueantes, en orden de prioridad.

## Pricing / UX

### [P1] Sistema de créditos amigable (¿asset propio?)

**Problema.** Los precios on-chain son en XLM y, a la tasa actual (~$0.12/XLM), una
llamada cuesta fracciones de céntimo ($0.0006–$0.0012). En el dashboard:
- El balance en USD no cambia de forma visible tras una llamada (redondea a 2 decimales: $4.9988 → "$5.00").
- Los precios mostrados ("$0.0006/call") parecen "gratis" o un bug.
- Un usuario no técnico no percibe que está pagando → se ve barato/poco serio.

**Idea.** Introducir una capa de **créditos** desacoplada del precio spot del XLM,
posiblemente un **asset propio de Kiba** (token Stellar emitido + SAC) o "Kiba Credits",
con una unidad amigable y estable (p.ej. 1 crédito = $0.01, o paquetes de $5/$10), para que:
- Los precios se muestren en una unidad legible y estable, no en céntimos de XLM.
- El balance se mueva de forma perceptible en cada llamada.
- La UX quede desacoplada de la escala/volatilidad del XLM.

**Opciones a evaluar.**
- **Off-chain (rápido):** re-escalar solo la unidad de *display* (créditos) en el gateway/dashboard, manteniendo XLM on-chain. Cambio menor, sin tocar contrato.
- **On-chain (asset propio):** emitir un token KIBA en Stellar y usarlo como activo de liquidación del escrow. Cambia contrato Soroban + SDK + fondeo. Más trabajo, más "producto".
- Añadir un **markup de plataforma** para que el precio por llamada tenga sentido comercial (no solo el costo del agente).

**Origen.** Detectado en el E2E de interfaz (viaje de usuario no técnico, 2026-06-25).

---

## Otros (menores, ya anotados)

- `<title>` duplicado del gateway ("Kiba · Kiba").
- Contraste del wordmark en `app-icon.png` (navy sobre fondo casi negro).
- 4 lockfiles stale (contracts/installer/slidev) — se regeneran en build.
