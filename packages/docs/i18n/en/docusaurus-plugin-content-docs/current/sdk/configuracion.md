---
title: "Configuration"
description: "How each SDK chain setting is resolved and what degraded mode is."
---

# Configuration

Every chain setting resolves as **option → environment variable → network preset**.

| Option | Environment variable | Notes |
|---|---|---|
| `network` | `STELLAR_NETWORK` | `'testnet'` (default) or `'mainnet'` |
| `contractId` | `STELLAR_CONTRACT_ID` | Kiba registry; omitting it gives degraded (no-chain) mode |
| `rpcUrl` | `STELLAR_RPC_URL` | Soroban RPC |
| `trustlessWork.apiKey` <TW /> | `TRUSTLESS_WORK_API_KEY` | Without it the escrow doesn't settle |
| `trustlessWork.platformAddress` <TW /> | `TRUSTLESS_WORK_PLATFORM_ADDRESS` | **Required** when TW is active |
| `platform.publicKey` (provider) | `KIBA_PLATFORM_PUBLIC_KEY` | Accept platform-signed calls |
| `discoveryUrl` (client) | `KIBA_DISCOVERY_URL`, `BACKEND_URL` | Registry lookup fallback |
| `wallet` / `secret` | `AGENT_WALLET_SECRET`, `KEYPAIR_PATH` | Identity |

## Degraded mode

Without `STELLAR_CONTRACT_ID` the SDK runs in **degraded mode**: `provider` and `client` work without verifying on-chain (handy for local demos).

:::danger[Dangerous in real deployments]
A broken deployment looks healthy. That's why the server refuses to serve in degraded mode unless you set `allowUnverified: true`.
:::

Network values (RPC, USDC issuer, contract) are in [Testnet](/stellar/testnet). What changes in production is in [Going to mainnet](/publica-un-servicio/mainnet).
