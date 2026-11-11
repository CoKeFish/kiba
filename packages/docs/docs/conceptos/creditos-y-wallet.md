---
title: "Créditos y wallet"
description: "Los dos saldos de una cuenta Kiba: créditos fuera de cadena y wallet on-chain."
---

# Créditos y wallet

Cada cuenta del gateway tiene **dos saldos separados**, fáciles de confundir.

:::warning[No se mezclan]
Fondear la wallet **no** suma créditos, y recargar créditos no mueve USDC a tu wallet. Son independientes.
:::

## Créditos (fuera de cadena)

Saldo en USD en el libro del gateway. Es lo que gasta un asistente al llamar a un servicio.

- Las cuentas nuevas empiezan con **5 USD** de crédito (testnet).
- Se recarga desde la página **Billing** del dashboard o con [`POST /v1/topup`](/api/endpoints#cuenta).
- El gasto es inmediato y fuera de cadena: se debita en milisegundos.
- `GET /v1/balance` los reporta como `balance_usd`.
- La API devuelve USD y unidades base. En el dashboard, montos como recargas, historial y uso aparecen en **Kibix** (10.000 Kibix = 1 USD).

## Wallet (on-chain)

Cada cuenta recibe una wallet Stellar. Cuando Privy está configurado, se aprovisiona como wallet de servidor **no custodial**: la clave vive en el enclave seguro (TEE) de Privy y el gateway solo solicita firmas (`raw_sign`). Su dirección pública aparece en el dashboard y en `GET /v1/me` (campo `custodial_wallet`).

- Guarda **USDC** en Stellar; el gateway configura la [trustline](/stellar/usdc-y-trustlines).
- Para fondearla, envía USDC a su dirección: es una cuenta Stellar normal, sin memo.

## Depósito retirable

Quien prefiere pagar con su propia wallet deja un **depósito** en un canal de pago de Stellar. El depósito sigue siendo del usuario: Kiba solo cobra lo consumido y el resto se retira cuando el usuario quiera.

- **Depositar.** Desde **Billing**, el usuario elige un monto y firma una transacción con su wallet: la de Kiba con Privy, o una externa como Freighter, xBull o Lobstr. Esa transacción crea su canal y mueve el USDC de la wallet al canal. El mínimo es 1 USDC.
- **Recargar.** Otra transacción firmada por el usuario suma al depósito.
- **Pagar.** Cada llamada se descuenta del depósito al instante, sin firma y sin transacción en cadena. Kiba cobra lo consumido al contrato por tandas: cuando lo pendiente llega a 0,10 USDC o lleva diez minutos sin cobrarse. Una transacción cubre todas las llamadas de la tanda, y el contrato nunca paga más de lo depositado.
- **Retirar.** Kiba cobra lo consumido pendiente y el resto vuelve a la wallet del usuario en la misma transacción. El canal se cierra; para seguir pagando con la wallet se abre otro.
- **Retirar sin pasar por Kiba.** El usuario pide el retiro directamente al contrato. Kiba lo detecta, deja de aceptar gasto contra ese depósito y cobra lo pendiente. Tras la espera del canal, de alrededor de una hora, el usuario retira todo lo que queda.
- **Sin uso.** Un depósito que pasa 90 días sin depósitos, recargas ni llamadas se devuelve solo: Kiba cobra lo consumido pendiente y el resto vuelve a la wallet. El dashboard lo avisa 7 días antes, y cualquier llamada o recarga reinicia la cuenta.

Kiba paga las comisiones de red de todas estas transacciones: el usuario no necesita XLM. También mantiene vivo el canal en la red: Stellar archiva los contratos cuyo plazo de permanencia vence, y Kiba renueva ese plazo antes de que ocurra, de modo que el depósito está siempre disponible para pagar o retirar.

El contrato es el [canal de pago unidireccional de Stellar](https://github.com/stellar-experimental/one-way-channel), el mismo que usa MPP Session. Hay un canal por usuario, creado por una fábrica. La dirección del canal y cada movimiento aparecen en el dashboard con su enlace al explorador.

| Endpoint | Qué hace |
|---|---|
| `GET /v1/channel` | Estado del depósito: depositado, consumido, disponible y movimientos |
| `POST /v1/channel/open` | Prepara la apertura del canal con el depósito inicial |
| `POST /v1/channel/topup` | Prepara una recarga |
| `POST /v1/channel/liquidate` | Retira: Kiba cobra lo consumido y el resto vuelve a la wallet |
| `POST /v1/channel/close-start` | Prepara la solicitud de retiro sin pasar por Kiba |
| `POST /v1/channel/refund` | Prepara el retiro, pasada la espera |

Las transacciones preparadas las firma el usuario y se envían con `POST /v1/spend/submit`.

## Tu saldo

El dashboard (barra superior y página **Billing**) y la herramienta [`get_balance`](/conecta-tu-asistente/herramientas-mcp#get_balance) muestran **un solo saldo en USD**: tus créditos más lo que queda por gastar de tu depósito. Es lo que tiene tu asistente para pagar servicios.

- El dashboard lo trunca en vez de redondearlo: nunca muestra más de lo que tienes.
- En la API es `total_usd` de [`GET /v1/balance`](/api/endpoints#cuenta).

## Cuál paga una llamada

| Situación | Quién paga | `paidWith` |
|---|---|---|
| Hay crédito suficiente | La tesorería firma y paga on-chain; la wallet del usuario no se toca (un solo cargo) | `credit` |
| No hay crédito y hay un depósito abierto | El precio se descuenta del depósito al instante; Kiba lo cobra al canal por tandas | `wallet` |
| No hay crédito ni depósito | La llamada no se hace: recarga créditos o abre un depósito | — |

Los publishers cobran **on-chain**, no en créditos.

## Métodos de recarga

Todos en sandbox/test. Se seleccionan con `PAYMENT_PROVIDER`; el valor por defecto es `bre-b-sandbox`.

| Método | Detalle |
|---|---|
| Stripe | Tarjeta |
| PayPal | Cuenta PayPal |
| Wompi | PSP colombiano |
| Bre-B | QR o llave, confirmación manual |
| Depósito USDC en Stellar | Detección por memo vía Horizon |

## Los créditos son un prepago

Los créditos sirven para pagar llamadas a servicios y nada más. No son un saldo de dinero.

| Regla | Detalle |
|---|---|
| Tope por cuenta | Una cuenta puede tener hasta 200 USD en créditos. Una recarga que lo supera se rechaza antes de cobrarla. |
| Caducidad | Los créditos vencen a los 365 días de entrar a la cuenta. Primero se gastan los que vencen antes. El panel muestra cuánto vence y cuándo. |
| Sin retiro | Los créditos no se convierten en USDC ni se envían a una wallet. |
| Sin transferencia | No se pasan de una cuenta a otra. |
| Reembolsos | Si una llamada falla o se acepta un reclamo, lo devuelto entra como créditos nuevos, con su propio vencimiento. |

Si quieres poder recuperar lo que no gastes, usa el depósito de tu wallet: ese sí es tuyo y vuelve a tu wallet.
