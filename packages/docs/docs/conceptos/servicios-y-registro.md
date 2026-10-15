---
title: "Servicios y registro"
description: "Qué es un servicio en Kiba y cómo se registra on-chain."
---

# Servicios y registro

Un **servicio** es cualquier cosa que responde una petición HTTP a cambio de un precio: un agente de IA, una API REST, un indexador, un scraper, una calculadora. Cada servicio tiene:

- un **nombre** (`service`), único en el registro, de hasta 32 caracteres (por ejemplo `translator-pro`);
- un **precio por llamada** en USDC, opcionalmente dinámico por petición;
- un **endpoint** público que habla el handshake de pago de Kiba (el SDK lo implementa);
- una **descripción**, que usa la búsqueda y que le dice al asistente qué payload enviar;
- un **dueño**: la cuenta Stellar que lo registró y que recibe sus ganancias.

## Registro on-chain

El contrato guarda una entrada por nombre de servicio y solo el dueño puede crearla, actualizarla o borrarla (`owner.require_auth()`). Emite los eventos `agent_registered`, `agent_updated` y `agent_deregistered`, que consumen los indexadores.

Como es información pública on-chain, **cualquiera puede correr un indexador**; un publisher no queda atado a un catálogo único. Detalle técnico en [Contrato de registro](/stellar/contrato-de-registro).

:::note[Sobre la palabra "agent"]
Los identificadores `list_agents`, `call_agent`, `register_agent`, `AgentProvider` y `AgentClient` conservan el término histórico. Funcionan para cualquier tipo de servicio.
:::

## Servicios de demostración

Los 8 servicios de demostración los opera el equipo (`agent-<nombre>.kiba.tools`) y sirven de plantillas de referencia en [`packages/demo-agents/`](https://github.com/CoKeFish/kiba/tree/main/packages/demo-agents).
