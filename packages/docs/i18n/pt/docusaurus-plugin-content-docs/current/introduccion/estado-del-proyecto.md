---
title: "Status do projeto"
description: "O que funciona hoje na testnet, o que é demonstração ou mock e o que está fora do escopo."
---

# Status do projeto

A Kiba é uma **demonstração técnica na testnet da Stellar**, não um produto comercial lançado. Não tem usuários de terceiros e não movimenta fundos reais. Tudo o que está descrito nesta documentação funciona de ponta a ponta na testnet.

## Funciona hoje (testnet)

- Todos os serviços sobem com `docker compose up`.
- Registro on-chain de serviços (Soroban), descoberta híbrida (FTS5 + embeddings) e dashboard.
- Pagamento por chamada fora da cadeia (~170 ms, medido na testnet) + liquidação em lote em USDC com divisão 95/5, verificada on-chain na testnet.
- O adaptador MCP completa o fluxo OAuth 2.0 com PKCE contra o gateway; também há conector remoto (`/mcp`).
- Wallets de usuário não custodiais via Privy (quando configurado) e créditos, em cascata para USDC on-chain.
- Pacotes npm publicados (`kiba-sdk`, `kiba-mcp`) e instalador de desktop com um clique para Windows.

## Mocks e stubs no repositório {/* #mocks-y-stubs-dentro-del-repo */}

Dos 8 serviços de demonstração, **3 são reais** e 5 devolvem respostas simuladas. O contrato os trata como qualquer outro serviço registrado.

| Serviço | Status | Detalhe |
|---|---|---|
| `web-scraper` | **Real** | Firecrawl: conteúdo dinâmico renderizado com JS |
| `world-clock` | **Real** | Fusos horários reais com `Intl`, sem API externa |
| `randomizer` | **Real** | Aleatoriedade criptográfica com `node:crypto` |
| `yield-hunter` | Mock | Resposta simulada |
| `risk-auditor` | Mock | Resposta simulada |
| `translator-pro` | Mock | Resposta simulada |
| `price-oracle` | Mock | Resposta simulada |
| `code-reviewer` | Mock | Resposta simulada |

:::note[Recargas em sandbox]
As recargas fiat → créditos rodam em **modo sandbox/teste** (Stripe test, PayPal sandbox, Wompi sandbox, Bre-B sandbox). Não há cobranças reais.
:::

## Fora do escopo por enquanto

- Publishers de terceiros e usuários externos em escala.
- Mainnet.
- Auditoria formal do contrato.
- Trabalho regulatório para operação custodial (KYC/AML).
- Confiabilidade operacional de longo prazo (SLA).

O que vem a seguir está no [roadmap](/recursos/hoja-de-ruta).
