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

As a buyer, Kiba pays an MPP challenge when it offers a **per-call charge** (`stellar` / `charge`) in **USDC** on the same network Kiba runs on. If the API only offers another currency, another network or a session charge, the call is rejected without charging.

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

## Paying by session

An agent that makes many calls does not have to pay on the network for each one. It opens a **payment channel** to Kiba, deposits USDC there once, and on each call sends only a signature stating how much it owes in total. A call takes less than half a second. Kiba collects from the channel in batches, in a single transaction.

1. Get the data needed to open the channel: `GET /mpp/sessions/info`.
2. Get the opening transaction: `POST /mpp/sessions/prepare` with `owner` (your account), `commitmentKey` (the public key you will sign with) and `amount` (the deposit, in base units). Sign it with your account and submit it to the network.
3. Register the channel: `POST /mpp/sessions` with `openTx` (the hash of that transaction) or `channel` (the channel address).
4. Call `/mpp/<service>` with the header `X-Mpp-Channel: <channel>`.

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

| What happens | Detail |
|---|---|
| Which channel is accepted | Only the Stellar channel contract created by Kiba's factory, with Kiba as the recipient and holding USDC. Kiba checks it on the network when you register it. |
| When Kiba collects | When the pending amount exceeds 0.10 USDC, when the last signature is more than 10 minutes old, or right away if you ask to close the channel. |
| If the call does not fit | A call that costs more than what is left in the channel is rejected without being served. |
| If the service fails | Kiba collects that signature and returns the USDC to you in a separate transaction. |
| Getting back what is left | The channel is yours: you ask the contract to close (`close_start`) and, after the waiting period, withdraw the rest (`refund`). Kiba collects what is pending first. |

Kiba does not yet **pay** by session when it is the buyer: per-call charges only.

The publisher does not have to do anything: their service is sold over MPP at the same price and gets paid the same way.
