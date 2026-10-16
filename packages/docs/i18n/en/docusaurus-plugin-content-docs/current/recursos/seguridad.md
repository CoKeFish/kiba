---
title: "Security"
sidebar_label: "Security"
description: "How Kiba protects accounts, payments and services."
---

# Security

How Kiba protects accounts, payments and services. Kiba runs on testnet today: balances have no real value.

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

Found a security issue? Write to the [team's email](/recursos/soporte#reportes-de-seguridad) instead of opening a public issue.
