---
title: "Names and trust"
description: "Global first-come, first-served names, endpoint verification and what isn't protected."
---

# Names and trust

Service names are **global and first-come, first-served** in the on-chain registry. The contract guarantees that only the owner can create, modify or delete **their** registration, so nobody can hijack an existing one.

There are two extra protections when services consume other services.

## Endpoint verification {/* #verificación-de-endpoint */}

A squatter could register a name pointing at *someone else's* endpoint. With `verifyEndpoint: true` on `AgentClient`, discovery cross-checks the endpoint's live [`/manifest`](/publica-un-servicio/despliegue#rutas-que-expone-el-servidor-integrado): its `service` and `ownerWallet` must match the on-chain registration or the call throws `EndpointVerificationError`.

```ts
const client = new AgentClient({ /* … */ verifyEndpoint: true });
```

## Escrow receiver binding

A provider only serves an escrow that names **it** as receiver; a registration pointing at a victim's endpoint can't extract free work.

## What isn't protected

:::warning[Brand names]
Taking an **unused brand name** before its rightful owner is inherent to a permissionless registry. Pick a descriptive, specific name you're willing to keep.
:::

Production marketplaces are expected to curate discovery on top of the registry with reputation and verified badges. The planned hardening is namespacing by owner + service with a curated alias; it changes calling by plain name, so it's a deliberate non-goal of the current version.
