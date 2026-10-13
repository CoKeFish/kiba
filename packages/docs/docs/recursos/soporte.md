---
title: "Comunidad y soporte"
sidebar_label: "Comunidad y soporte"
description: "Cómo contactar al equipo de Kiba: Discord, correo y GitHub."
---

# Comunidad y soporte

| Canal | Para qué | Contacto |
|---|---|---|
| **Discord** | Preguntas rápidas, ayuda para integrar o publicar un servicio | Escribe a **`andre.yf`** |
| **Correo** | Consultas más largas, alianzas y reportes de seguridad | [rrtc26@gmail.com](mailto:rrtc26@gmail.com) |
| **GitHub Issues** | Errores reproducibles y propuestas de mejora | [github.com/CoKeFish/kiba/issues](https://github.com/CoKeFish/kiba/issues) |

:::tip[Discord]
`andre.yf` es un usuario de Discord, no un servidor: búscalo como usuario y envíale un mensaje directo o una solicitud de amistad.
:::

## Antes de escribir

Revisa si tu caso ya está resuelto en:

- [FAQ y solución de problemas](/recursos/faq), para conexión y llamadas.
- [Problemas frecuentes al publicar](/publica-un-servicio/problemas-frecuentes), si publicas un servicio.
- [Errores de la API](/api/errores) y [Errores del SDK](/sdk/errores).

Si no, incluye en tu mensaje:

- qué intentabas hacer y qué pasó;
- el mensaje de error completo (`error` de la API o la clase del SDK);
- el servicio involucrado y, si hubo, el enlace del explorador de la transacción;
- si usas el conector remoto, `kiba-mcp`, la API REST o el SDK.

:::warning[Nunca compartas secretos]
No envíes API keys (`sk_live_…`), secretos de wallet (`S…`) ni tokens OAuth, ni por Discord ni por correo. Nadie del equipo te los va a pedir.
:::

## Reportes de seguridad

Si encuentras una vulnerabilidad, escribe al [correo](mailto:rrtc26@gmail.com) en lugar de abrir un issue público, para poder corregirla antes de que se conozca. Ver también [Seguridad y límites conocidos](/recursos/seguridad).

## Valores de plataforma para publishers

La clave pública y la dirección de la plataforma de testnet (`KIBA_PLATFORM_PUBLIC_KEY`, `KIBA_PLATFORM_ADDRESS`) se piden por cualquiera de estos canales. Ver [Testnet](/stellar/testnet#valores-de-plataforma).
