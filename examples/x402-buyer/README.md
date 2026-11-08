# x402 buyer: un agente cualquiera le paga a un servicio Kiba

Cliente mínimo del estándar [x402](https://www.x402.org) en Stellar, hecho solo con los
paquetes oficiales (`@x402/fetch`, `@x402/stellar`). No usa el SDK ni el conector de Kiba:
demuestra que un servicio publicado con el SDK de Kiba (con `x402` activado) cobra a cualquier
cliente x402 del ecosistema.

```bash
npm install
STELLAR_SECRET_KEY=S... node client.mjs http://localhost:5007/service '{"zone":"Tokyo"}'
```

La cuenta del comprador necesita USDC de testnet (faucet de Circle) y trustline USDC; no
necesita XLM cuando el facilitador del servicio patrocina la comisión.

Qué pasa por debajo:

1. `POST /service` sin pago → el servicio responde 402 con `PAYMENT-REQUIRED` (precio de esa
   petición, su cuenta, red y USDC).
2. `@x402/stellar` firma la autorización de la transferencia USDC (solo las auth entries).
3. Se repite la petición con `PAYMENT-SIGNATURE`. El servicio verifica, ejecuta y liquida
   on-chain; responde el resultado con `PAYMENT-RESPONSE` (hash de la transacción).
