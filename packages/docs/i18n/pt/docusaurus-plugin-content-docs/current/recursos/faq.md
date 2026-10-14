---
title: "FAQ e solução de problemas"
sidebar_label: "FAQ"
description: "Perguntas frequentes e soluções para problemas de conexão e de chamadas."
---

# FAQ e solução de problemas

## Perguntas frequentes

### Preciso de cripto para usar a Kiba?

Não. Você faz login com um e-mail, começa com 5 USD de crédito (testnet) e recarrega em USD. A liquidação on-chain acontece por trás do gateway.

### Preciso de cripto para publicar um serviço?

Seu serviço precisa de uma conta Stellar (o SDK a cria na testnet) e de uma API key da Trustless Work <TW />. Os ganhos chegam como USDC na Stellar.

### Está na mainnet?

Ainda não. A Kiba roda na testnet da Stellar: o fluxo está completo de ponta a ponta, mas os saldos não têm valor real.

### Quanto a Kiba cobra?

5 % de cada chamada, aplicados na liquidação; o publisher recebe 95 %. Sem assinaturas nem mensalidades.

### Quais assistentes funcionam?

Claude (web, desktop, celular) e ChatGPT com o [conector remoto](/conecta-tu-asistente). Claude Code, Cursor, Claude Desktop, Codex e qualquer cliente MCP com o `kiba-mcp` ou o instalador do Windows.

### Meu serviço pode ser chamado sem passar pela Kiba?

Sim. Qualquer `AgentClient` pode pagar diretamente qualquer serviço registrado por meio de um escrow. O registro é público e qualquer pessoa pode rodar um indexador.

### Onde fica o dinheiro quando eu publico?

Na conta Stellar dona do registro on-chain: o keypair com que seu serviço foi iniciado, ou sua wallet Kiba se você registrou pelo dashboard. Veja [Painel do publisher](/publica-un-servicio/panel-de-publisher#dónde-cae-el-dinero).

### Posso auto-hospedar o gateway?

Sim, toda a plataforma é de código aberto. `docker compose up` sobe gateway, descoberta, dashboard e serviços de demonstração contra a testnet. Aponte o `kiba-mcp` para ele com `KIBA_URL`. Veja [Self-hosting e desenvolvimento](/recursos/self-hosting).

### Onde informo um erro ou peço ajuda?

Erros reproduzíveis vão para o [GitHub Issues](https://github.com/CoKeFish/kiba/issues). Para ajuda, envie mensagem para `andre.yf` no Discord ou escreva para andrelanfor@gmail.com. Veja [Comunidade e suporte](/recursos/soporte).

## Conexão {/* #conexión */}

| Problema | Solução |
|---|---|
| **O Claude não consegue adicionar o conector** | Verifique se a URL é exatamente `https://api.kiba.tools/mcp` e se o seu plano aceita conectores personalizados (Pro, Max, Team, Enterprise). Se não, use o [`kiba-mcp`](/conecta-tu-asistente/ides-y-clientes-locales). |
| **O ChatGPT rejeita o conector** | Primeiro é preciso ativar o Developer mode, e a URL precisa ser HTTPS. |
| **O navegador nunca abre com o `kiba-mcp`** | Reinicie o cliente depois de editar a configuração MCP e acione qualquer ferramenta da Kiba. Em uma máquina sem interface, use `KIBA_API_KEY`. |
| **"Unauthorized" depois de funcionar** | Desconecte o app no dashboard (**Credentials**) e conecte de novo. Os tokens duram 30 dias. |

## Chamadas {/* #llamadas */}

| Problema | Solução |
|---|---|
| **`insufficient balance`** | Recarregue créditos em **Billing** no dashboard ou deposite USDC na sua wallet. |
| **A chamada demora muito** | As chamadas assinadas pela plataforma voltam em menos de um segundo. As chamadas com escrow direto (SDK) esperam a rede e podem levar de 15 a 150 s. |
| **O serviço devolveu um erro** | O gateway reembolsa o débito nos seus créditos. Confira o payload com a descrição do serviço: o assistente pode ter adivinhado os campos. |
| **Erro de campo desconhecido em `POST /v1/call`** | Coloque a entrada do serviço dentro de `payload`; só `service` e `payload` são permitidos no nível superior. |

Para publishers, veja [Problemas frequentes ao publicar](/publica-un-servicio/problemas-frecuentes).
