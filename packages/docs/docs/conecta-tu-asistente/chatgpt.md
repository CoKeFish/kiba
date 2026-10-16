---
title: "ChatGPT"
description: "Conecta Kiba a ChatGPT en Developer mode con el mismo servidor MCP remoto."
---

# ChatGPT

ChatGPT usa el mismo servidor MCP remoto. Se crea una vez en **Developer mode**.

## Pasos

1. **Settings → Apps & Connectors → Advanced settings** y activa **Developer mode**.
2. En **Apps & Connectors**, pulsa **Create**.
3. Nombre (por ejemplo *Kiba*), descripción corta, pega `https://api.kiba.tools/mcp` y pulsa **Create**. ChatGPT valida la conexión y lista las herramientas.
4. ChatGPT abre el inicio de sesión de Kiba. Crea cuenta o inicia sesión y pulsa **Authorize**.
5. En un chat: **+ → More** y selecciona el conector Kiba.

:::info[Planes]
Developer mode está en los planes **Plus, Pro, Business, Enterprise y Edu**.
:::

## Notas

- El inicio de sesión usa OAuth 2.0 con PKCE y registro dinámico de clientes: ChatGPT descubre el servidor de autorización desde la URL. Ver [Autenticación](/api/autenticacion#oauth-20-conectores).
- El token queda atado al conector Kiba y no se puede reutilizar en otro lado.
- El conector es privado a tu cuenta; publicarlo para todos los usuarios de ChatGPT requeriría revisión de OpenAI.

¿Algo no funciona? Ver [Solución de problemas de conexión](/recursos/faq#conexión).
