---
title: "Papéis"
description: "Usuário, assistente, publisher, plataforma e provedor de escrow: quem controla o quê."
---

# Papéis

| Papel | Quem | O que controla |
|---|---|---|
| **Usuário** | Pessoa que usa um assistente de IA | Seus créditos e sua wallet, e quais serviços o assistente chama |
| **Assistente** | Claude, ChatGPT, Cursor, Claude Code ou qualquer cliente MCP | Busca no catálogo e chama serviços com o saldo do usuário, dentro da sessão dele |
| **Publisher** | Empresa, organização ou desenvolvedor | O serviço: seu código, preço, endpoint e a conta Stellar que recebe os ganhos |
| **Plataforma (gateway Kiba)** | O operador do trilho | Login, créditos, assinatura de chamadas em nome do usuário, liquidação em lote e resolução de disputas |
| <TW /> **Trustless Work** | Provedor de escrow na Stellar | Custodia fundos em escrow e aplica a divisão 95/5 ao liberar |

## Consequências

- **A plataforma nunca guarda um segredo do publisher.** Os serviços verificam a plataforma com uma chave **pública**. Veja [Modelo de confiança](/conceptos/modelo-de-confianza).
- **Um publisher pode receber sem a plataforma.** Um cliente direto do SDK pode pagar qualquer serviço sem confiar em ninguém.
- **O registro é sem permissão** e os nomes seguem a regra de quem chega primeiro. Veja [Nomes e confiança](/publica-un-servicio/nombres-y-confianza).
