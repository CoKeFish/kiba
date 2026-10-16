---
title: "FAQ y solución de problemas"
sidebar_label: "FAQ"
description: "Preguntas frecuentes y soluciones a problemas de conexión y de llamadas."
---

# FAQ y solución de problemas

## Preguntas frecuentes

### ¿Necesito cripto para usar Kiba?

No. Inicias sesión con un correo, empiezas con 5 USD de crédito (testnet) y recargas en USD. La liquidación on-chain ocurre detrás del gateway.

### ¿Necesito cripto para publicar un servicio?

Tu servicio necesita una cuenta Stellar (el SDK la crea en testnet) y una API key de Trustless Work <TW />. Las ganancias llegan como USDC en Stellar.

### ¿Está en mainnet?

Todavía no. Kiba corre en Stellar testnet: el flujo está completo de punta a punta, pero los saldos no tienen valor real.

### ¿Qué cobra Kiba?

5 % de cada llamada, aplicado en la liquidación; el publisher recibe 95 %. Sin suscripciones ni cuotas mensuales.

### ¿Qué asistentes funcionan?

Claude (web, escritorio, móvil) y ChatGPT con el [conector remoto](/conecta-tu-asistente). Claude Code, Cursor, Claude Desktop, Codex y cualquier cliente MCP con `kiba-mcp` o el instalador de Windows.

### ¿Mi servicio puede llamarse sin pasar por Kiba?

Sí. Cualquier `AgentClient` puede pagar directamente a cualquier servicio registrado mediante un escrow. El registro es público y cualquiera puede correr un indexador.

### ¿Dónde está el dinero cuando publico?

En la cuenta Stellar dueña del registro on-chain: el keypair con el que arrancó tu servicio, o tu wallet Kiba si registraste desde el dashboard. Ver [Panel de publisher](/publica-un-servicio/panel-de-publisher#dónde-cae-el-dinero).

### ¿Puedo auto-hospedar el gateway?

Sí, toda la plataforma es de código abierto. `docker compose up` levanta gateway, descubrimiento, dashboard y servicios de demostración contra testnet. Apunta `kiba-mcp` a él con `KIBA_URL`. Ver [Self-hosting y desarrollo](/recursos/self-hosting).

### ¿Dónde reporto un error o pido ayuda?

Errores reproducibles en [GitHub Issues](https://github.com/CoKeFish/kiba/issues). Para ayuda, escribe a `andre.yf` en Discord o a andrelanfor@gmail.com. Ver [Comunidad y soporte](/recursos/soporte).

## Conexión

| Problema | Solución |
|---|---|
| **Claude no puede agregar el conector** | Verifica que la URL sea exactamente `https://api.kiba.tools/mcp` y que tu plan admita conectores personalizados (Pro, Max, Team, Enterprise). Si no, usa [`kiba-mcp`](/conecta-tu-asistente/ides-y-clientes-locales). |
| **ChatGPT rechaza el conector** | Primero hay que activar Developer mode y la URL debe ser HTTPS. |
| **El navegador nunca se abre con `kiba-mcp`** | Reinicia el cliente tras editar la configuración MCP y dispara cualquier herramienta de Kiba. En una máquina sin interfaz, usa `KIBA_API_KEY`. |
| **"Unauthorized" después de funcionar** | Desconecta la app en el dashboard (**Credentials**) y conéctala de nuevo. Los tokens duran 30 días. |

## Llamadas

| Problema | Solución |
|---|---|
| **`insufficient balance`** | Recarga créditos en **Billing** del dashboard o fondea tu wallet con USDC. |
| **La llamada tarda mucho** | Las llamadas firmadas por la plataforma vuelven en menos de un segundo. Las llamadas con escrow directo (SDK) esperan a la red y pueden tardar de 15 a 150 s. |
| **El servicio devolvió un error** | El gateway reembolsa el débito a tus créditos. Revisa el payload contra la descripción del servicio: el asistente pudo adivinar los campos. |
| **Error de campo desconocido en `POST /v1/call`** | Pon la entrada del servicio dentro de `payload`; solo `service` y `payload` se permiten en el nivel superior. |

Para publishers, ver [Problemas frecuentes al publicar](/publica-un-servicio/problemas-frecuentes).
