---
title: "Opere sua própria plataforma"
description: "Assine você mesmo as chamadas da plataforma se operar seu próprio gateway."
---

# Opere sua própria plataforma

Se você opera seu próprio gateway, assine os headers você mesmo:

```ts
import { LocalPlatformSigner } from 'kiba-sdk';

const platform = LocalPlatformSigner.fromSecret(process.env.KIBA_PLATFORM_SECRET!);
await client.callSigned(serviceEndpoint, payload, { signer: platform, service });
```

Publique a chave pública correspondente para os serviços que devem confiar em você; eles a configuram como `platform.publicKey`.

:::warning[Proteja a chave privada]
`KIBA_PLATFORM_SECRET` permite emitir chamadas pagas para qualquer serviço que confie na sua plataforma. Nunca a compartilhe com os serviços: eles só precisam da chave pública. Veja [Modelo de confiança](/conceptos/modelo-de-confianza).
:::

Para subir o stack completo localmente, veja [Self-hosting e desenvolvimento](/recursos/self-hosting).
