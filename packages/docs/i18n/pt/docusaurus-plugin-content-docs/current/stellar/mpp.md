---
title: "MPP"
description: "A Kiba paga APIs que cobram com MPP e vende seus serviços por MPP a agentes externos."
---

# MPP

**MPP** (Machine Payments Protocol) é um protocolo de pagamento por HTTP 402, irmão do [x402](/stellar/x402). A API responde `402` com um desafio no cabeçalho `WWW-Authenticate: Payment`, quem chama paga e repete a chamada com a prova em `Authorization: Payment`, e recebe o resultado com um recibo em `Payment-Receipt`. Na Stellar o pagamento é uma transferência direta de USDC, sem intermediário.

A Kiba o usa nos dois sentidos.

## A Kiba compra

`call_url` reconhece o desafio de MPP da mesma forma que o de x402. Lê o preço, cobra do usuário dos créditos ou do depósito, e a tesouraria assina o pagamento. O resultado traz `protocol: "mpp"` e o link para a transação.

Os [serviços externos](/publica-un-servicio/servicios-externos) que cobram com MPP são listados com o preço e chamados com `call_agent`.

Como compradora, a Kiba paga um desafio de MPP quando ele oferece uma **cobrança por chamada** (`stellar` / `charge`) em **USDC** e na mesma rede em que a Kiba opera. Se a API só oferecer outra moeda, outra rede ou uma cobrança por sessão, a chamada é rejeitada sem cobrar.

## A Kiba vende

Cada serviço do catálogo tem uma rota pública. Não pede conta nem chave da Kiba.

```text
POST https://api.kiba.tools/mpp/<serviço>
```

1. O agente externo chama a rota com o pedido no corpo JSON.
2. A Kiba pede ao serviço o preço desse pedido e responde `402` com o desafio.
3. O agente paga em USDC à Kiba e repete a chamada com a prova de pagamento.
4. A Kiba confere o pagamento na rede, chama o serviço e devolve o resultado com o recibo.

```js
import { Mppx } from 'mppx/client'
import { stellar } from '@stellar/mpp/charge/client'

const mppx = Mppx.create({ methods: [stellar.charge({ keypair })] })
const res = await mppx.fetch('https://api.kiba.tools/mpp/translator', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello', to: 'es' }),
})
```

`GET https://api.kiba.tools/mpp` devolve a lista de serviços com a URL e o preço base.

| O que acontece | Detalhe |
|---|---|
| Para onde vai o pagamento | Para a tesouraria da Kiba. O ganho do publicador é registrado e segue a [retenção](/conceptos/pagos-y-liquidacion), como uma chamada paga com créditos. |
| Um pagamento usado duas vezes | É rejeitado. As provas de pagamento já usadas ficam no banco de dados da Kiba. |
| O serviço falha depois do pagamento | A Kiba devolve o USDC a quem pagou, em uma transação à parte. |
| Limite | 60 requisições por minuto por endereço IP. |

## Pagamento por sessão

Um agente que faz muitas chamadas não precisa pagar na rede por cada uma. Ele abre um **canal de pagamento** para a Kiba, deposita USDC ali uma vez, e em cada chamada envia apenas uma assinatura dizendo quanto deve no total. Uma chamada leva menos de meio segundo. A Kiba cobra do canal em lotes, em uma única transação.

1. Peça os dados para abrir o canal: `GET /mpp/sessions/info`.
2. Peça a transação de abertura: `POST /mpp/sessions/prepare` com `owner` (a sua conta), `commitmentKey` (a chave pública com que você vai assinar) e `amount` (o depósito, em unidades base). Assine com a sua conta e envie à rede.
3. Registre o canal: `POST /mpp/sessions` com `openTx` (o hash dessa transação) ou `channel` (o endereço do canal).
4. Chame `/mpp/<serviço>` com o cabeçalho `X-Mpp-Channel: <canal>`.

```js
import { Mppx } from 'mppx/client'
import { stellar } from '@stellar/mpp/channel/client'

const mppx = Mppx.create({
  methods: [stellar.channel({ commitmentKey, allowedChannels: [channel] })],
})
const res = await mppx.fetch('https://api.kiba.tools/mpp/translator', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-mpp-channel': channel },
  body: JSON.stringify({ text: 'hello', to: 'es' }),
})
```

| O que acontece | Detalhe |
|---|---|
| Que canal é aceito | Só o contrato de canal da Stellar criado pela fábrica da Kiba, com a Kiba como destinatária e com USDC. A Kiba confere na rede ao registrá-lo. |
| Quando a Kiba cobra | Quando o pendente passa de 0,10 USDC, quando a última assinatura tem mais de 10 minutos, ou imediatamente se você pedir para fechar o canal. |
| Se a chamada não couber | Uma chamada que custa mais do que resta no canal é rejeitada sem ser atendida. |
| Se o serviço falhar | A Kiba cobra essa assinatura e devolve o USDC a você em uma transação à parte. |
| Recuperar o que sobra | O canal é seu: você pede o fechamento no contrato (`close_start`) e, passado o prazo de espera, retira o resto (`refund`). A Kiba cobra o pendente antes. |

A Kiba ainda não **paga** por sessão quando é ela quem compra: só cobranças por chamada.

O publicador não precisa fazer nada: o serviço dele é vendido por MPP pelo mesmo preço e recebe pelo mesmo caminho.
