---
title: "Nomes e confiança"
description: "Nomes globais por ordem de chegada, verificação de endpoint e o que não está protegido."
---

# Nomes e confiança

Os nomes de serviço são **globais e por ordem de chegada** no registro on-chain. O contrato garante que só o dono pode criar, modificar ou apagar **o seu** registro, então ninguém pode sequestrar um que já existe.

Há duas proteções adicionais quando serviços consomem outros serviços.

## Verificação de endpoint {/* #verificación-de-endpoint */}

Um squatter poderia registrar um nome apontando para o endpoint de *outra pessoa*. Com `verifyEndpoint: true` no `AgentClient`, a descoberta confere o [`/manifest`](/publica-un-servicio/despliegue#rutas-que-expone-el-servidor-integrado) ao vivo do endpoint: seu `service` e seu `ownerWallet` precisam coincidir com o registro on-chain, ou a chamada lança `EndpointVerificationError`.

```ts
const client = new AgentClient({ /* … */ verifyEndpoint: true });
```

## Vinculação do recebedor do escrow

Um provider só atende um escrow que o nomeie **como** recebedor; um registro que aponte para o endpoint de uma vítima não consegue extrair trabalho de graça.

## O que não está protegido

:::warning[Nomes de marca]
Pegar um **nome de marca sem uso** antes do dono legítimo é inerente a um registro sem permissão. Escolha um nome descritivo e específico que você queira manter.
:::

Espera-se que marketplaces de produção façam curadoria da descoberta sobre o registro com reputação e selos verificados. O reforço planejado é o espaço de nomes por dono + serviço com alias curado; isso muda a chamada por nome simples, então é um não objetivo deliberado da versão atual.
