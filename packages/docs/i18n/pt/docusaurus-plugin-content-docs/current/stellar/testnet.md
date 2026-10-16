---
title: "Testnet"
description: "Valores de rede da testnet da Stellar, fundos de teste, explorador e reinícios."
---

# Testnet

A Kiba roda hoje na **testnet da Stellar**: o gateway público, o catálogo e os serviços de demonstração apontam para ela. Os fundos da testnet não têm valor, o que a torna um lugar seguro para testar o fluxo completo.

| Ajuste | Valor |
|---|---|
| Passphrase da rede | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Contrato de registro | [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF) |
| Emissor de USDC (Circle, testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| <TW /> API da Trustless Work | `https://dev.api.trustlesswork.com` |

## Valores da plataforma {/* #valores-de-plataforma */}

Dois valores pertencem ao gateway público e só os publishers precisam deles:

| Variável | O que é |
|---|---|
| `KIBA_PLATFORM_PUBLIC_KEY` | Chave pública da plataforma, para aceitar chamadas assinadas |
| `KIBA_PLATFORM_ADDRESS` | Endereço da tesouraria que recebe a comissão nos escrows |

Ambas são chaves públicas e seguras de compartilhar. Peça-as à equipe pelo [Discord ou e-mail](/recursos/soporte#valores-de-plataforma-para-publishers).

## Obter fundos de testnet

- **XLM:** o friendbot financia qualquer conta nova (o SDK o chama no `bootstrap()`).
- **USDC:** o [faucet da Circle](https://faucet.circle.com) emite USDC de teste na Stellar para uma conta que já tem a [trustline](/stellar/usdc-y-trustlines).

## Explorador

O [stellar.expert](https://stellar.expert/explorer/testnet) mostra contas, contratos e transações; os links que a Kiba devolve em cada chamada apontam para lá.

## Reinícios

:::warning[A SDF reinicia a testnet periodicamente]
Depois de um reinício é preciso recriar contas e registro: a Kiba faz novo deploy do contrato e os serviços voltam a executar o `bootstrap()`.
:::
