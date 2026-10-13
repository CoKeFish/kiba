---
title: "Security and known limits"
sidebar_label: "Security and limits"
description: "What Kiba protects today and what it doesn't."
---

# Security and known limits

Kiba is a technical demo on testnet. This page says what it protects today and what it doesn't.

## What's in place

| Area | Measure |
|---|---|
| Authentication | OAuth 2.0 with PKCE (S256) and dynamic client registration; tokens bound to the `/mcp` resource (RFC 8707), valid for 30 days and revocable. |
| API keys | Shown only once; the gateway stores only a SHA-256 hash. They can be revoked. |
| Sessions | JWT cookie. In production the gateway rejects a missing, default or shorter-than-32-characters `JWT_SECRET`. |
| Platform calls to services | Certificate signed with ed25519 (`service`, payload hash, timestamp, nonce); freshness check (~2 min) and replay protection. The service only stores the platform public key. |
| Direct escrow | Each escrow is served only once and must name the service as receiver. |
| Services | Body limit (`256kb`) and rate limit on the quote path (60/min by default). |
| Names | `verifyEndpoint` cross-checks the endpoint's `/manifest` against the on-chain registration. |
| Settlement | Rows are claimed with `settlement_id` before paying; a failed payout frees them; the sweep is reentrant. A failed call is refunded. |
| Repository | Secret scanning (gitleaks) and tests as deployment gates. Production secrets live outside the repo. |

## Known limits

:::warning[Before using Kiba with anything that matters]
- **Testnet only.** Balances have no real value.
- **No formal audit** of the Soroban contract (planned before mainnet).
- **No regulatory work** (KYC/AML) for custodial operation. Credits are a gateway balance, meaning the platform holds that balance.
:::

- **Names without brand protection:** taking a free name before its owner is possible. See [Names and trust](/publica-un-servicio/nombres-y-confianza).
- **Informational contract counters:** the source of truth for earnings is the gateway ledger.
- **Treasury with a single hot key** in the gateway; automatic refunding and a channel-account pool for high concurrency are pending.
- No SLA or availability guarantees.

Found a security issue? Write to the [team's email](/recursos/soporte#reportes-de-seguridad) instead of opening a public issue.
