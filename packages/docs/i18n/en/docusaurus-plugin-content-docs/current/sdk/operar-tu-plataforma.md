---
title: "Run your own platform"
description: "Sign platform calls yourself if you run your own gateway."
---

# Run your own platform

If you run your own gateway, sign the headers yourself:

```ts
import { LocalPlatformSigner } from 'kiba-sdk';

const platform = LocalPlatformSigner.fromSecret(process.env.KIBA_PLATFORM_SECRET!);
await client.callSigned(serviceEndpoint, payload, { signer: platform, service });
```

Publish the matching public key to the services that should trust you; they configure it as `platform.publicKey`.

:::warning[Guard the private key]
`KIBA_PLATFORM_SECRET` lets you mint paid calls to any service that trusts your platform. Never share it with the services: they only need the public key. See [Trust model](/conceptos/modelo-de-confianza).
:::

To run the full stack locally, see [Self-hosting and development](/recursos/self-hosting).
