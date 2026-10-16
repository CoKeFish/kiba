---
title: "Errores"
description: "Códigos HTTP y mensajes de error comunes de la API del gateway."
---

# Errores

Todo error es un objeto JSON con un solo string `error`:

```json
{ "error": "service required" }
```

| Estado | Significado |
|---|---|
| `400` | Entrada inválida: campo faltante o desconocido, monto inválido, nombre demasiado largo. El mensaje dice cuál. |
| `401` | Credencial ausente o inválida. En `/mcp` la respuesta trae `WWW-Authenticate` con la URL de metadatos del recurso. |
| `404` | Usuario, clave o conexión desconocidos. |
| `500` | Falló la llamada al servicio o un upstream (descubrimiento, Trustless Work <TW />, Stellar) devolvió error. El string `error` trae el mensaje del upstream. **Una llamada fallida se reembolsa a créditos.** |

## Mensajes comunes

| Mensaje | Causa |
|---|---|
| `service required` | Falta `service` en `POST /v1/call`. |
| Campo desconocido | Hay campos distintos de `service` y `payload`: pon la entrada del servicio dentro de `payload`. |
| `insufficient balance` | Créditos y wallet juntos no cubren el precio. |
| `invalid amount (must be 0 < n <= 1000)` | Monto de recarga fuera de rango. |
| `balance cap exceeded (max $10000)` | La recarga superaría el tope de créditos. |
| `name required` / `name too long (max 64)` | Nombre inválido al crear una API key. |

Más casos en [FAQ y solución de problemas](/recursos/faq#llamadas).
