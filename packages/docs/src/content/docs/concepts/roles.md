---
title: Roles
description: The parties in a Kiba call and what each one controls.
sidebar:
  order: 4
---

| Role | Who | Controls |
| --- | --- | --- |
| **User** | A person using an AI assistant | Their credits and wallet, and which services the assistant calls |
| **Assistant** | Claude, ChatGPT, Cursor, Claude Code, or any MCP client | Searches the catalog and calls services with the user's balance, inside the user's session |
| **Publisher** | A company, an organization, or a developer | The service: its code, price, endpoint, and the Stellar account that receives earnings |
| **Platform (Kiba gateway)** | The operator of the rail | Sign-in, credits, signing calls on the user's behalf, batched settlement, dispute resolution on escrows |
| **Trustless Work** | Escrow provider on Stellar | Holds funds in escrow and applies the 95/5 split at release |

A few consequences:

- The platform never holds a publisher's secret. Services verify the platform with a public key.
- A publisher can be paid without the platform: a direct SDK client can pay any service trustlessly.
- The registry is permissionless and first-come on names. Read [Naming and trust](/publish/naming-and-trust/) before you pick a service name.
