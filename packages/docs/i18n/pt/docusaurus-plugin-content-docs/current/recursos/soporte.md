---
title: "Comunidade e suporte"
sidebar_label: "Comunidade e suporte"
description: "Como falar com a equipe da Kiba: Discord, e-mail e GitHub."
---

# Comunidade e suporte

| Canal | Para quê | Contato |
|---|---|---|
| **Discord** | Perguntas rápidas, ajuda para integrar ou publicar um serviço | Envie mensagem para **`andre.yf`** |
| **E-mail** | Dúvidas mais longas, parcerias e relatos de segurança | [rrtc26@gmail.com](mailto:rrtc26@gmail.com) |
| **GitHub Issues** | Erros reproduzíveis e propostas de melhoria | [github.com/CoKeFish/kiba/issues](https://github.com/CoKeFish/kiba/issues) |

:::tip[Discord]
`andre.yf` é um usuário do Discord, não um servidor: procure-o como usuário e envie uma mensagem direta ou um pedido de amizade.
:::

## Antes de escrever

Veja se o seu caso já está resolvido em:

- [FAQ e solução de problemas](/recursos/faq), para conexão e chamadas.
- [Problemas frequentes ao publicar](/publica-un-servicio/problemas-frecuentes), se você publica um serviço.
- [Erros da API](/api/errores) e [Erros do SDK](/sdk/errores).

Se não, inclua na mensagem:

- o que você tentava fazer e o que aconteceu;
- a mensagem de erro completa (o `error` da API ou a classe do SDK);
- o serviço envolvido e, se houve, o link do explorador da transação;
- se você usa o conector remoto, o `kiba-mcp`, a API REST ou o SDK.

:::warning[Nunca compartilhe segredos]
Não envie API keys (`sk_live_…`), segredos de wallet (`S…`) nem tokens OAuth, nem pelo Discord nem por e-mail. Ninguém da equipe vai pedi-los.
:::

## Relatos de segurança {/* #reportes-de-seguridad */}

Se você encontrar uma vulnerabilidade, escreva para o [e-mail](mailto:rrtc26@gmail.com) em vez de abrir um issue público, para que ela possa ser corrigida antes de ser divulgada. Veja também [Segurança e limites conhecidos](/recursos/seguridad).

## Valores da plataforma para publishers {/* #valores-de-plataforma-para-publishers */}

A chave pública e o endereço da plataforma na testnet (`KIBA_PLATFORM_PUBLIC_KEY`, `KIBA_PLATFORM_ADDRESS`) podem ser pedidos por qualquer um destes canais. Veja [Testnet](/stellar/testnet#valores-de-plataforma).
