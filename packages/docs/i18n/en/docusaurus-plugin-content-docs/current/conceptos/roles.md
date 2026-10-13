---
title: "Roles"
description: "User, assistant, publisher, platform and escrow provider: who controls what."
---

# Roles

| Role | Who | What they control |
|---|---|---|
| **User** | A person using an AI assistant | Their credits and wallet, and which services the assistant calls |
| **Assistant** | Claude, ChatGPT, Cursor, Claude Code or any MCP client | Searches the catalog and calls services with the user's balance, within their session |
| **Publisher** | Company, organization or developer | The service: its code, price, endpoint and the Stellar account that receives earnings |
| **Platform (Kiba gateway)** | The rail operator | Sign-in, credits, signing calls on the user's behalf, batch settlement and dispute resolution |
| <TW /> **Trustless Work** | Escrow provider on Stellar | Holds funds in escrow and applies the 95/5 split on release |

## Consequences

- **The platform never stores a publisher secret.** Services verify the platform with a **public** key. See [Trust model](/conceptos/modelo-de-confianza).
- **A publisher can get paid without the platform.** A direct SDK client can pay any service without trusting anyone.
- **The registry is permissionless** and names are first-come, first-served. See [Names and trust](/publica-un-servicio/nombres-y-confianza).
