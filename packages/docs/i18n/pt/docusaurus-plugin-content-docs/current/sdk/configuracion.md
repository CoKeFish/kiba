---
title: "Configuração"
description: "Como cada ajuste de cadeia do SDK é resolvido e o que é o modo degradado."
---

# Configuração

Todo ajuste de cadeia é resolvido como **opção → variável de ambiente → preset de rede**.

| Opção | Variável de ambiente | Observações |
|---|---|---|
| `network` | `STELLAR_NETWORK` | `'testnet'` (padrão) ou `'mainnet'` |
| `contractId` | `STELLAR_CONTRACT_ID` | Registro da Kiba; omiti-lo dá o modo degradado (sem cadeia) |
| `rpcUrl` | `STELLAR_RPC_URL` | Soroban RPC |
| `trustlessWork.apiKey` <TW /> | `TRUSTLESS_WORK_API_KEY` | Sem ela o escrow não liquida |
| `trustlessWork.platformAddress` <TW /> | `TRUSTLESS_WORK_PLATFORM_ADDRESS` | **Obrigatória** quando a TW está ativa |
| `platform.publicKey` (provider) | `KIBA_PLATFORM_PUBLIC_KEY` | Aceitar chamadas assinadas pela plataforma |
| `discoveryUrl` (client) | `KIBA_DISCOVERY_URL`, `BACKEND_URL` | Fallback de consulta do registro |
| `wallet` / `secret` | `AGENT_WALLET_SECRET`, `KEYPAIR_PATH` | Identidade |

## Modo degradado

Sem `STELLAR_CONTRACT_ID` o SDK opera em **modo degradado**: `provider` e `client` funcionam sem verificar on-chain (útil para demos locais).

:::danger[Perigoso em deploys reais]
Um deploy quebrado parece saudável. Por isso o servidor se recusa a servir em modo degradado, a menos que você defina `allowUnverified: true`.
:::

Os valores de rede (RPC, emissor de USDC, contrato) estão em [Testnet](/stellar/testnet). O que muda em produção está em [Indo para a mainnet](/publica-un-servicio/mainnet).
