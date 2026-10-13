---
title: "Casos de uso"
description: "Qué se puede hacer con Kiba como usuario de un asistente y como publisher."
---

# Casos de uso

## Para usuarios de un asistente

- **Respuestas especializadas dentro de un chat normal.** Pide a Claude o ChatGPT una traducción, un precio de mercado, una revisión de código, una página extraída o una evaluación de riesgo y deja que pague al especialista que lo hace bien en vez de adivinar.
- **Un saldo para todas las herramientas.** Recargas una vez; todos los servicios se pagan con los mismos créditos, con el precio visible antes de cada llamada y un historial después.
- **Sin cuentas que administrar.** Sin claves de API que copiar ni suscripciones a una herramienta que necesitas una vez.

## Para publishers

- **Monetizar un modelo o una API por llamada.** Envuélvelo con el SDK, fija un precio y que lo descubran todos los asistentes conectados. Facturación, descubrimiento y autenticación son tarea del rail.
- **Vender datos.** Indexadores, feeds y datasets cobrados por consulta, con precio dinámico según el tamaño de la petición.
- **Agentes que pagan a agentes.** Un servicio puede consumir otros con el SDK, pagando desde su propia wallet, sin confianza.
- **Herramientas internas para los asistentes de un equipo.** Publica un servicio y apunta los asistentes del equipo a él; el uso y las ganancias se registran por llamada.

## Dónde encaja el pago por llamada

| Industria | Ejemplo de servicio |
|---|---|
| Idiomas | Traducción, revisión de localización, transcripción |
| Finanzas y cripto | Feeds de precios, búsqueda de rendimiento, auditoría de riesgo de contratos inteligentes |
| Software | Revisión de código, auditoría de dependencias, generación de pruebas |
| Datos | Web scraping, extracción de documentos, consulta de entidades |
| Operaciones | Geocodificación, conversión de zonas horarias, agendamiento |

Los servicios de demostración ([`packages/demo-agents/`](https://github.com/CoKeFish/kiba/tree/main/packages/demo-agents)) son plantillas funcionales para varios de estos casos: `translator-pro`, `yield-hunter`, `risk-auditor`, `price-oracle`, `code-reviewer`, `web-scraper`, `world-clock` y `randomizer`. Cuáles son reales y cuáles mock está en [Estado del proyecto](/introduccion/estado-del-proyecto#mocks-y-stubs-dentro-del-repo).

## Segmento identificado en entrevistas

Usuarios con suscripciones premium de herramientas (Cursor Ultra, acceso a Grok) que no tienen la experticia o la motivación de construir agentes, pero sí pagarían por servicios ya hechos: **comprar, no construir**.
