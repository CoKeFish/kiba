---
title: "Hoja de ruta"
description: "Qué ya está en main, qué sigue, qué está condicionado y qué se descartó."
---

# Hoja de ruta

Estado de cada línea. **Lo marcado "evaluado" no está implementado.**

## Ya en `main`

- Registro on-chain, descubrimiento híbrido, gateway con OAuth y créditos, conector MCP remoto, `kiba-mcp`, instalador Windows, dashboard con panel de publisher, SDK, liquidación por lotes.
- Wallets de usuario no custodiales vía Privy (cuando `PRIVY_APP_ID`/`PRIVY_APP_SECRET` están configurados).

## Siguiente

| Línea | Detalle |
|---|---|
| **Escrows propios de Kiba** | Reemplazan a <TW /> Trustless Work para el escrow x402 y el reparto 95/5. Decisión tomada en octubre de 2026; diseño e implementación en curso. Ver [Trustless Work](/stellar/trustless-work). |
| **Mainnet** | Despliegue en mainnet con **auditoría previa del contrato Soroban**. Reposición automática de la tesorería y pool de cuentas-canal (concurrencia) como pendientes técnicos. |
| **Rampa fiat Colombia** | Recarga COP → USDC por PSE y retiro USDC → COP a llave Bre-B. Candidato principal: **VANK** (anchor SEP-10/24/6/12/38; sandbox `dev-stable-anchor.thisisvank.com`; producción exige certificación con 3 casos, acuerdo de integración y `stellar.toml` con `SIGNING_KEY`). Respaldo: **Koywe** (PSE de entrada, Bre-B/ACH de salida). Se habían considerado también PayU, Cobre, Mono y la API de Nequi. Reto: riesgo cambiario custodial y exposición regulatoria. |
| **Desarrollo de ecosistema** | Onboarding de publishers, expansión de catálogo por verticales y primeros usuarios que paguen. |
| **OpenZeppelin Relayer + facilitator x402** (evaluado) | Envía las transacciones y patrocina las fees, así el agente no necesita XLM. Reemplaza a Launchtube (discontinuado por la SDF). Paquete `@x402/stellar` (x402 v2); facilitator de testnet `channels.openzeppelin.com/x402/testnet`. Si Kiba liquida por su propio mecanismo de escrow, quizá solo se necesite la parte del Relayer. |
| **Privy: validar firma Soroban** (evaluado) | Confirmar que firma *auth entries* de Soroban en Stellar (necesario para x402), que sus políticas aplican a Stellar y que la firma delegada por el servidor no reintroduce custodia. |
| **Stellar 8004** (evaluado) | Registros de identidad, reputación y validación en Soroban (estilo ERC-8004), en mainnet. Publicar atestaciones de los servicios y conservar las señales propias de Kiba (llamadas pagadas, reembolsos). SDK `@trionlabs/stellar8004`. |
| **OpenZeppelin Smart Account Kit** (evaluado, después de validar Privy) | Reglas on-chain para agentes (topes, llaves de sesión). El kit de integración no está auditado. |
| **Precio dinámico de mercado** (propuesta) | Precio según el uso del servicio (1 vez vs. 10) y la oferta y demanda del marketplace. No implementado. |
| **REAPP** (en evaluación, fase 2) | Patrón de mandatos para mejorar la orquestación multi-agente. Es complementario: opera en la capa de mandato/autorización; Kiba es la capa de marketplace encima. |

## Condicionado

| Proyecto | Condición |
|---|---|
| Bazaars x402 (Rail402, AgentSmith, Rumble Fish, Vellar) | Esperar mainnet. Catálogo automático de servicios pagables; se listan al liquidar por su facilitator. Vellar es testnet y sin auditar. |

## Descartado por ahora

| Proyecto | Motivo |
|---|---|
| **Reflector** (precios on-chain) | El precio dinámico depende de uso y demanda internos, no de precios externos. |
| **Pollar** | Duplica a Privy. |
| **DeFindex / rendimiento sobre saldos** | Riesgo regulatorio. |
| **Canales MPP** | Kiba no tiene el problema de costo que resuelven. |

## Fuera de alcance de esta versión

Publishers de terceros y usuarios externos a escala, mainnet, auditoría formal, KYC/AML y SLA. Ver [Estado del proyecto](/introduccion/estado-del-proyecto).
