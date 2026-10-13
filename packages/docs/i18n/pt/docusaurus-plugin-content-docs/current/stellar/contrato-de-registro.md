---
title: "Contrato de registro"
description: "O contrato Soroban da Kiba: funções, armazenamento, eventos e testes."
---

# Contrato de registro

Contrato Soroban escrito em Rust e implantado na testnet da Stellar. Sua única responsabilidade é o **registro de serviços**; **os pagamentos não passam por ele**.

- **Id (testnet):** [`CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF`](https://stellar.expert/explorer/testnet/contract/CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF)
- **Código:** [`packages/contracts-soroban/`](https://github.com/CoKeFish/kiba/tree/main/packages/contracts-soroban) (Rust + `soroban-sdk` 22).

## Funções

| Função | Quem pode chamar | Efeito |
|---|---|---|
| `register_agent` | O dono (`require_auth`) | Cria a entrada de um novo nome de serviço |
| `update_agent` | O dono | Muda preço, endpoint ou descrição |
| `deregister_agent` | O dono | Apaga a entrada |
| `get_agent` | Qualquer pessoa | Lê uma entrada |

## Armazenamento

Uma entrada `Agent` por nome de serviço:

```rust
Agent {
    owner,
    service,
    price_per_call,
    endpoint,
    description,
    total_calls,
    total_earned,
    created_at,
}
```

Elas ficam em armazenamento persistente com um TTL de ~30 dias que o SDK renova antes de vencer (aluguel do Soroban).

## Eventos

`agent_registered`, `agent_updated` e `agent_deregistered`. O backend de descoberta os consome; qualquer pessoa pode fazer o mesmo. Veja [Descoberta híbrida](/conceptos/descubrimiento-hibrido#cómo-se-mantiene-el-catálogo).

## Testes

`cargo test` (nativo, sem wasm): **7 testes** cobrem registro e validações (duplicado, nome vazio, preço não positivo), leitura, atualização, remoção e autorização do dono.

Toolchain: imagem `kiba/stellar-cli` (`docker/stellar-cli`); stellar-cli 26 compila para o target `wasm32v1-none`.

:::warning[Sem auditoria formal]
O contrato ainda não tem auditoria formal (prevista antes da mainnet).
:::

## O que não está no contrato

- O escrow x402 e a divisão 95/5 ficam a cargo da Trustless Work <TW /> (veja [Trustless Work](/stellar/trustless-work)).
- Os contadores `total_calls` e `total_earned` são informativos; o livro do gateway é a fonte da verdade.
