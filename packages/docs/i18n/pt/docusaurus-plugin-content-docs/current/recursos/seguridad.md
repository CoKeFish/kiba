---
title: "Segurança"
sidebar_label: "Segurança"
description: "Como a Kiba protege contas, pagamentos e serviços."
---

# Segurança

Como a Kiba protege contas, pagamentos e serviços. A Kiba roda hoje na testnet: os saldos não têm valor real.

## O que existe

| Área | Medida |
|---|---|
| Autenticação | OAuth 2.0 com PKCE (S256) e registro dinâmico de clientes; tokens vinculados ao recurso `/mcp` (RFC 8707), com validade de 30 dias e revogáveis. |
| API keys | Exibidas uma única vez; o gateway guarda só um hash SHA-256. Podem ser revogadas. |
| Sessões | Cookie JWT. Em produção o gateway rejeita um `JWT_SECRET` ausente, padrão ou com menos de 32 caracteres. |
| Chamadas da plataforma aos serviços | Certificado assinado com ed25519 (`service`, hash do payload, carimbo de tempo, nonce); verificação de validade (~2 min) e proteção contra repetição. O serviço guarda só a chave pública da plataforma. |
| Escrow direto | Cada escrow é atendido uma única vez e precisa nomear o serviço como recebedor. |
| Serviços | Limite de corpo (`256kb`) e de taxa na rota de cotação (60/min por padrão). |
| Nomes | `verifyEndpoint` confere o `/manifest` do endpoint com o registro on-chain. |
| Liquidação | As linhas são reivindicadas com `settlement_id` antes de pagar; um pagamento que falha as libera; a transferência é reentrante. Uma chamada que falha é reembolsada. |
| Repositório | Varredura de segredos (gitleaks) e testes como portões do deploy. Segredos de produção ficam fora do repositório. |

Encontrou um problema de segurança? Escreva para o [e-mail da equipe](/recursos/soporte#reportes-de-seguridad) em vez de abrir um issue público.
