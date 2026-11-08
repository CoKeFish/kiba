# x402 seller: una API que cobra con x402 estándar en Stellar

Este ejemplo es el "tercero" de la demo: una API cualquiera que cobra por consulta con el
estándar [x402](https://www.x402.org) sobre Stellar, usando los paquetes oficiales
(`@x402/express`, `@x402/stellar`) y un facilitador público. No conoce a Kiba.

Kiba le paga desde Claude o ChatGPT con la tool `call_url`: lee el 402, firma la
autorización USDC con su treasury, descuenta el precio del saldo del usuario y devuelve la
respuesta más el enlace a la transacción en stellar.expert.

## Rutas

| Ruta | Precio |
|---|---|
| `GET /weather?city=Bogota` | 0,01 USDC |
| `POST /summarize` `{ "text": "..." }` | 0,02 USDC |
| `GET /free` | gratis (para ver que Kiba no cobra si no hay 402) |

## Correr en testnet

```bash
npm install
npm run setup     # crea la cuenta que cobra (friendbot + trustline USDC) y escribe .env
npm start         # http://localhost:3001
```

El facilitador por defecto es `https://x402.org/facilitator` (testnet, sin clave): verifica
la firma y envía la transacción pagando las comisiones. Para mainnet cambia `STELLAR_NETWORK`
a `stellar:pubnet` y usa un facilitador que la sirva (OpenZeppelin Channels, con clave en
`FACILITATOR_API_KEY`).

## Pagarle con Kiba

Con el conector de Kiba instalado, en el chat:

> Llama a https://TU-HOST/weather?city=Bogota y dime el clima.

El asistente usa `call_url`, Kiba paga los 0,01 USDC y la respuesta trae `txHash` y
`explorerUrl`. Si el precio supera 1 USD, el usuario tiene que autorizarlo con `maxUsd`.

Sin Kiba, cualquier cliente x402 también puede pagarle (por ejemplo `@x402/fetch` con
`ExactStellarScheme`): esa es la gracia del estándar.
