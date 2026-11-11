---
title: "MPP"
description: "Kiba pays APIs that charge with MPP and sells its services over MPP to external agents."
---

# MPP

**MPP** (Machine Payments Protocol) is an HTTP 402 payment protocol, a sibling of [x402](/stellar/x402). The API replies `402` with a challenge in the `WWW-Authenticate: Payment` header, the caller pays and repeats the call with the proof in `Authorization: Payment`, and gets the result with a receipt in `Payment-Receipt`. On Stellar the payment is a direct USDC transfer, with no intermediary.

Kiba uses it in both directions.

## Kiba buys

`call_url` recognises the MPP challenge the same way it recognises x402. It reads the price, charges the user from their credits or their deposit, and the treasury signs the payment. The result carries `protocol: "mpp"` and the link to the transaction.

[External services](/publica-un-servicio/servicios-externos) that charge with MPP are listed with their price and called with `call_agent`.

Kiba pays an MPP challenge when it offers a **per-call charge** (`stellar` / `charge`) in **USDC** on the same network Kiba runs on. If the API only offers another currency, another network or a session charge, the call is rejected without charging.

## Kiba sells

Every service in the catalog has a public route. It needs no Kiba account or key.

```text
POST https://api.kiba.tools/mpp/<service>
```

1. The external agent calls the route with the request in the JSON body.
2. Kiba asks the service for the price of that request and replies `402` with the challenge.
3. The agent pays Kiba in USDC and repeats the call with the proof of payment.
4. Kiba verifies the payment on the network, calls the service and returns the result with its receipt.

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

`GET https://api.kiba.tools/mpp` returns the list of services with their URL and base price.

| What happens | Detail |
|---|---|
| Where the payment goes | To Kiba's treasury. The publisher's earning is recorded and follows the [holding period](/conceptos/pagos-y-liquidacion), like a call paid with credits. |
| A payment used twice | Rejected. Used proofs of payment are stored in Kiba's database. |
| The service fails after payment | Kiba returns the USDC to the payer, in a separate transaction. |
| Limit | 60 requests per minute per IP address. |

The publisher does not have to do anything: their service is sold over MPP at the same price and gets paid the same way.
