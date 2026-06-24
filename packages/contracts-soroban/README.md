# Kiba — contrato Soroban (Stellar)

Port idiomático del programa Anchor de Solana a **Soroban**. Misma lógica de
protocolo: registro de agentes, escrow x402 y **split atómico 95/5**.

| | |
|---|---|
| Lenguaje | Rust + `soroban-sdk` 22 |
| Activo de liquidación | un token (USDC/XLM como Stellar Asset Contract) que el contrato custodia |
| Comisión | 5% (500 bps), descontada en cada `claim_payment` |
| Ventana de refund | 300 s |

## Diferencias con la versión Solana/Anchor

- En Anchor, el estado vive en **PDAs** y se mueve **SOL nativo** entre cuentas.
  En Soroban, el estado vive en **almacenamiento por clave** (`DataKey`) y el
  contrato **custodia un token** y lo mueve con la interfaz de token.
- El token y la treasury se fijan una sola vez en `initialize` (no hay setter →
  para cambiarlos se redepliega), preservando la propiedad del contrato Anchor
  de que nadie puede redirigir comisiones sin redeploy.

## Funciones

```
initialize(token, treasury)
register_agent(owner, service, price_per_call, endpoint, description)
update_agent(service, price_per_call?, endpoint?, description?)
deregister_agent(service)
open_escrow(client, service, nonce, amount)
claim_payment(client, agent_owner, nonce)        // split 95/5
refund_escrow(client, agent_owner, nonce)         // tras 300 s
get_agent(service) / get_escrow(client, owner, nonce) / get_config()
```

## Tests

Corren nativos (no requieren wasm):

```bash
cargo test
```

14 tests cubren registro/validaciones, el flujo completo de pago con la
verificación del split 95/5 vía balances de token, redondeo del fee, refund y
los casos de error.

## Build y deploy

Usa la imagen de herramientas en [`docker/stellar-cli`](../../docker/stellar-cli).

```bash
# Construir la imagen (una vez)
docker build -t kiba/stellar-cli docker/stellar-cli

# Desplegar e inicializar en testnet (genera y fondea identidad la 1ª vez)
docker run --rm \
  -v "${PWD}:/workspace" \
  -v stellar-config:/root/.config/stellar \
  -e CARGO_TARGET_DIR=/tmp/sttarget \
  -w /workspace/packages/contracts-soroban \
  kiba/stellar-cli \
  bash -c "tr -d '\r' < scripts/deploy-testnet.sh | bash"
```

El script ([`scripts/deploy-testnet.sh`](scripts/deploy-testnet.sh)) compila,
despliega, resuelve el SAC del activo nativo (XLM) y llama `initialize`.

## Despliegue actual (testnet)

| | |
|---|---|
| Network | Stellar **testnet** |
| Contract ID | `CA5M54YV4KG3E75YDJEUXY2C4FYBIEHTQJVZQASYF2WPJUO4KHEIQ62M` |
| Token (XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Treasury / deployer | `GDQFFCWIGWT22VHN7GBXLMNBEWJ6NNL3NITS2PKVECKDBCG7VV3X6CEZ` |
| Wasm hash | `69f961e81162e3e06db83aa022f47ca336e89b9a785c6afe4fda24785a751531` |
| Explorer | https://stellar.expert/explorer/testnet/contract/CA5M54YV4KG3E75YDJEUXY2C4FYBIEHTQJVZQASYF2WPJUO4KHEIQ62M |

Leer estado on-chain (read-only, no consume fees):

```bash
stellar contract invoke --id CA5M54YV4KG3E75YDJEUXY2C4FYBIEHTQJVZQASYF2WPJUO4KHEIQ62M \
  --source deployer --network testnet -- get_config
```

## Smoke test on-chain

[`scripts/smoke-testnet.sh`](scripts/smoke-testnet.sh) ejercita el flujo completo
contra el contrato desplegado (register → open_escrow → claim) y verifica el
split 95/5 por balances:

```bash
docker run --rm \
  -v "${PWD}:/workspace" \
  -v stellar-config:/root/.config/stellar \
  -w /workspace/packages/contracts-soroban \
  kiba/stellar-cli \
  bash -c "tr -d '\r' < scripts/smoke-testnet.sh | bash"
```

Verificado en testnet: en `claim_payment` el contrato emitió dos `transfer` —
`9500000` stroops al owner (95%) y `500000` a la treasury (5%) — y el escrow
quedó en estado `Completed`. La treasury (que no firma ninguna tx) subió
exactamente `500000`, prueba limpia del 5%.
