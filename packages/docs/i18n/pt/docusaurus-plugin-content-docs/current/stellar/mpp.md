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

A Kiba paga um desafio de MPP quando ele oferece uma **cobrança por chamada** (`stellar` / `charge`) em **USDC** e na mesma rede em que a Kiba opera. Se a API só oferecer outra moeda, outra rede ou uma cobrança por sessão, a chamada é rejeitada sem cobrar.

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

O publicador não precisa fazer nada: o serviço dele é vendido por MPP pelo mesmo preço e recebe pelo mesmo caminho.
