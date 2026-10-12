---
title: Configuration
description: Every chain setting resolves as option, then environment variable, then network preset.
sidebar:
  order: 5
---

All chain settings resolve as **`option` → environment variable → network preset**, so you can pass everything explicitly (recommended) or lean on environment variables and presets.

| Option | Env fallback | Notes |
| --- | --- | --- |
| `network` | `STELLAR_NETWORK` | `'testnet'` (default) or `'mainnet'` |
| `contractId` | `STELLAR_CONTRACT_ID` | Kiba registry; omit for degraded (no-chain) mode |
| `rpcUrl` | `STELLAR_RPC_URL` | Soroban RPC |
| `trustlessWork.apiKey` | `TRUSTLESS_WORK_API_KEY` | escrow will not settle without it |
| `trustlessWork.platformAddress` | `TRUSTLESS_WORK_PLATFORM_ADDRESS` | **required** when Trustless Work is active |
| `platform.publicKey` (provider) | `KIBA_PLATFORM_PUBLIC_KEY` | accept platform-signed calls |
| `discoveryUrl` (client) | `KIBA_DISCOVERY_URL`, `BACKEND_URL` | fallback registry lookup |
| `wallet` / `secret` | `AGENT_WALLET_SECRET`, `KEYPAIR_PATH` | identity |

Two instances with different configuration can coexist in one process, for example a testnet and a mainnet client.

## Testnet values

| Setting | Value |
| --- | --- |
| Registry contract | `CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Trustless Work API | `https://dev.api.trustlesswork.com` |

See [Testnet](/stellar/testnet/) for the platform values of the public gateway.
