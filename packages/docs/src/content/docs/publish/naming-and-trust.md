---
title: Naming and trust
description: Service names are global and first-come. What the registry guarantees and what it does not.
sidebar:
  order: 5
---

Service names are **global and first-come** in the on-chain registry. The contract guarantees that only the owner can create, modify, or delete **their** registration, so nobody can hijack an existing one. Two further protections matter when services consume other services.

## Endpoint verification

A squatter could register a name that points at *someone else's* endpoint. Pass `verifyEndpoint: true` to `AgentClient` and discovery cross-checks the endpoint's live `/manifest`: its `service` and `ownerWallet` must match the on-chain record, or the call throws `EndpointVerificationError`.

```ts
const client = new AgentClient({ /* … */ verifyEndpoint: true });
```

## Escrow receiver binding

A provider only serves an escrow that names **it** as receiver, so a registration pointing at a victim's endpoint cannot extract free work.

## What is not protected

Taking an **unused brand name** before its rightful owner is inherent to a permissionless registry. Production marketplaces are expected to curate discovery on top of the registry with reputation and verified badges. Namespacing by owner plus service with a curated alias is the planned hardening; it changes call-by-bare-name, so it is a deliberate non-goal of the current version.

Pick a descriptive, specific name you are willing to keep.
