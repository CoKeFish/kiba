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

## Arquitectura / Dinero

### [RESUELTO] Modelo de fondos: dos buckets (crédito plataforma + wallet usuario)

**Problema (resuelto).** En modo `virtual` se **debitaba el crédito Y además la custodial
del usuario pagaba el escrow on-chain** → doble cobro (medido en prod: crédito −5 000 y
wallet −291 257 stroops; el extra es el fee de `open_escrow`).

**Decisión implementada (commit `afc4a5a`).** Modelo de **dos buckets** con semántica clara:
- **Crédito** = dinero de la plataforma (off-chain, `balance_lamports`, solo gastable en
  Kiba). Al pagar con crédito, la **treasury** (master wallet) firma/paga el escrow on-chain
  → el wallet del usuario **NO se toca**. Un solo cargo (al crédito).
- **Wallet** = dinero del usuario (su custodial on-chain, movible). Si no hay crédito, la
  custodial paga directo (modo `wallet-direct`, sin débito de crédito). Un solo cargo.

`callOnBehalf` elige el cliente de liquidación por bucket (`getMasterWallet` vs custodial) y
expone `paidWith: 'credit' | 'wallet'`. `ensureTreasuryFunded()` fondea la treasury
(friendbot en testnet). Verificado en prod: call con crédito → crédito −costo, wallet
intacto (custodial vacío liquidó vía treasury).

**Pendiente (no bloqueante).** Reposición automática de la treasury en mainnet; pool de
cuentas-canal si hay concurrencia alta (la treasury firma todas las liquidaciones por
crédito → contención de sequence, mitigada por el retry de `invoke`); fondeo real del
wallet del usuario (topup mainnet = depósito/on-ramp). Ver también el ítem de pricing
(el gas ~0.0286 XLM supera el precio demo del agente).

**Origen.** QA E2E vía ChatGPT (2026-06-26): el wallet on-chain bajaba además del crédito.

---

## Otros (menores, ya anotados)

- `<title>` duplicado del gateway ("Kiba · Kiba").
- Contraste del wordmark en `app-icon.png` (navy sobre fondo casi negro).
- 4 lockfiles stale (contracts/installer/slidev) — se regeneran en build.
