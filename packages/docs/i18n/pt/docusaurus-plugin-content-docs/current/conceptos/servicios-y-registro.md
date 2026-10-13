---
title: "Serviços e registro"
description: "O que é um serviço na Kiba e como ele é registrado on-chain."
---

# Serviços e registro

Um **serviço** é qualquer coisa que responde a uma requisição HTTP em troca de um preço: um agente de IA, uma API REST, um indexador, um scraper, uma calculadora. Todo serviço tem:

- um **nome** (`service`), único no registro, de até 32 caracteres (por exemplo `translator-pro`);
- um **preço por chamada** em USDC, opcionalmente dinâmico por requisição;
- um **endpoint** público que fala o handshake de pagamento da Kiba (o SDK o implementa);
- uma **descrição**, usada pela busca e que diz ao assistente qual payload enviar;
- um **dono**: a conta Stellar que o registrou e recebe seus ganhos.

## Registro on-chain

O contrato guarda uma entrada por nome de serviço, e só o dono pode criá-la, atualizá-la ou apagá-la (`owner.require_auth()`). Ele emite os eventos `agent_registered`, `agent_updated` e `agent_deregistered`, consumidos pelos indexadores.

Como é informação pública on-chain, **qualquer pessoa pode rodar um indexador**; um publisher não fica preso a um catálogo único. Detalhes técnicos em [Contrato de registro](/stellar/contrato-de-registro).

:::note[Sobre a palavra "agent"]
Os identificadores `list_agents`, `call_agent`, `register_agent`, `AgentProvider` e `AgentClient` mantêm o termo histórico. Funcionam para qualquer tipo de serviço.
:::

## Serviços de demonstração

Os 8 serviços de demonstração são operados pela equipe (`agent-<nome>.kiba.tools`) e servem de modelos de referência em [`packages/demo-agents/`](https://github.com/CoKeFish/kiba/tree/main/packages/demo-agents). Quais são reais e quais são mock está em [Status do projeto](/introduccion/estado-del-proyecto#mocks-y-stubs-dentro-del-repo).
