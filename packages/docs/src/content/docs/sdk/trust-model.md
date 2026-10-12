---
title: Trust model
description: How the platform proves a paid call to a service without sharing any secret.
sidebar:
  order: 4
---

The platform proves a paid call to a service with an **asymmetric signature**:

- The platform holds an ed25519 **private** key it never discloses.
- Each service is configured with the platform's **public** key (`platform.publicKey`, a Stellar `G…` address, safe to publish).
- For each call the platform mints a short certificate `{ service, payloadHash, ts, nonce }` and **signs** it. The service **verifies** the signature, that the payload hash matches the body it received, that the certificate is fresh, and that the nonce has not been replayed.

Because what a service holds (a public key) cannot mint calls, a leak of any single service's configuration can never impersonate the platform to other services.

## Operating your own platform

If you run your own gateway, mint the headers yourself:

```ts
import { LocalPlatformSigner } from 'kiba-sdk';

const platform = LocalPlatformSigner.fromSecret(process.env.KIBA_PLATFORM_SECRET!);
await client.callSigned(serviceEndpoint, payload, { signer: platform, service });
```

Publish the corresponding public key to the services that should trust you.

## Without a platform

Standalone callers that do not trust any platform use the **x402 escrow** path, the default `call()`. It is fully trustless: the service checks the escrow on-chain and releases it after serving. Slower, but no party has to be trusted.
