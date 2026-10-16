---
title: "Indo para a mainnet"
description: "O que muda entre testnet e mainnet para um serviço publicado com o SDK."
---

# Indo para a mainnet

:::warning[A Kiba roda hoje na testnet]
Esta seção descreve o que o SDK suporta para que você possa se preparar. O gateway e o catálogo públicos são **só testnet** até o lançamento na mainnet.
:::

| Item | Testnet | Mainnet |
|---|---|---|
| `network` | `testnet` (padrão) | `mainnet` |
| Financiamento da conta do serviço | Automático com friendbot | Você financia com XLM (reserva + taxas) |
| Trustline de USDC | Configurada pelo `bootstrap()` | Antes do `bootstrap()`, com o [emissor de USDC da mainnet](/stellar/usdc-y-trustlines) |
| <TW /> Trustless Work | `https://dev.api.trustlesswork.com`, API key de testnet | `https://api.trustlesswork.com`, API key de mainnet |
| Contrato de registro | Id da testnet | Id da mainnet, publicado no lançamento |
| RPC | `https://soroban-testnet.stellar.org` | Um provedor de Soroban RPC; os endpoints públicos têm limite de taxa |

Duas instâncias com redes diferentes podem conviver em um processo (um cliente testnet e um mainnet, cada um com sua configuração). Veja [Configuração do SDK](/sdk/configuracion).
