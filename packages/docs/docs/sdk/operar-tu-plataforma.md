---
title: "Operar tu propia plataforma"
description: "Firma tú mismo las llamadas de plataforma si corres tu propio gateway."
---

# Operar tu propia plataforma

Si corres tu propio gateway, firma los headers tú mismo:

```ts
import { LocalPlatformSigner } from 'kiba-sdk';

const platform = LocalPlatformSigner.fromSecret(process.env.KIBA_PLATFORM_SECRET!);
await client.callSigned(serviceEndpoint, payload, { signer: platform, service });
```

Publica la clave pública correspondiente a los servicios que deban confiar en ti; ellos la configuran como `platform.publicKey`.

:::warning[Guarda la clave privada]
`KIBA_PLATFORM_SECRET` permite emitir llamadas pagadas ante cualquier servicio que confíe en tu plataforma. Nunca la compartas con los servicios: ellos solo necesitan la clave pública. Ver [Modelo de confianza](/conceptos/modelo-de-confianza).
:::

Para levantar el stack completo en local, ver [Self-hosting y desarrollo](/recursos/self-hosting).
