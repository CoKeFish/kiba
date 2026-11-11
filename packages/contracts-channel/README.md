# Canal de pago (depósito retirable)

El depósito retirable de Kiba usa el **canal de pago unidireccional de Stellar**
([stellar-experimental/one-way-channel](https://github.com/stellar-experimental/one-way-channel),
Apache 2.0). El código no es de Kiba y no se copia a este repositorio: `scripts/deploy.sh` lo
descarga en un commit fijo, lo compila y lo publica.

## Qué se publica

- **El código del canal**: el molde con el que se crea cada canal.
- **La fábrica**: un contrato que crea un canal por usuario a partir de ese molde. El usuario
  firma una sola transacción y la fábrica le deja el canal abierto con su depósito adentro.

Se publica una vez por red. El administrador de la fábrica es la identidad que la despliega; lo
único que puede hacer es cambiar el molde para los canales que se creen después.

## Publicar

Desde la raíz del repositorio, con la imagen `kiba/stellar-cli` (ver `docker/stellar-cli`):

```bash
docker run --rm -v "$PWD/packages/contracts-channel:/pkg:ro" \
  -v kiba-stellar-config:/root/.config/stellar -v kiba-channel-build:/work \
  kiba/stellar-cli bash /pkg/scripts/deploy.sh
```

Variables opcionales: `NETWORK` (por defecto `testnet`) e `IDENTITY` (por defecto
`kiba-payments-deployer`). Al terminar imprime la dirección de la fábrica, que el gateway lee de
`KIBA_CHANNEL_FACTORY_ID`.

## Publicado

| Red | Fábrica | Código del canal (wasm hash) |
|---|---|---|
| testnet | `CBV34HJF4VU4YBGMNHC2L3TKLDSTOXYN5ADZRBWCILJLHOTAAKWX75SV` | `bc8454008c4d3f691ae958b257926d192c1d3ef21d9795700831f1a3ca223fa0` |

Fuente: commit `25dea1b` del repositorio de Stellar. El gateway usa la fábrica de testnet por
defecto cuando corre en testnet; `KIBA_CHANNEL_FACTORY_ID=0` apaga los depósitos.

## Cómo lo usa Kiba

Ver `packages/gateway/src/channel.ts`. En resumen: el usuario deposita, cada llamada sube el
total consumido sin tocar la cadena, y Kiba cobra ese total presentando un compromiso firmado
con la clave de gasto del canal. Para salir, el usuario liquida (Kiba cobra y el resto vuelve a
su wallet en una transacción) o pide el retiro al contrato y retira tras la espera.

Variables del gateway:

| Variable | Por defecto | Qué controla |
|---|---|---|
| `KIBA_CHANNEL_FACTORY_ID` | la fábrica de testnet | Fábrica de canales; `0` apaga los depósitos |
| `CHANNEL_MIN_DEPOSIT` | `10000000` (1 USDC) | Depósito mínimo para abrir un canal |
| `CHANNEL_REFUND_WAIT_LEDGERS` | `720` (~1 h) | Espera del retiro pedido directamente al contrato |
| `CHANNEL_SETTLE_THRESHOLD` | `1000000` (0,10 USDC) | Consumo sin cobrar a partir del cual Kiba cobra |
| `CHANNEL_SETTLE_MAX_AGE_S` | `600` | Tiempo máximo que un consumo queda sin cobrar |
| `CHANNEL_JOB_INTERVAL_MS` | `60000` | Cada cuánto corre el trabajo que cobra, detecta retiros y renueva canales |
| `CHANNEL_TTL_MIN_LEDGERS` | `51840` (~3 días) | Vida restante por debajo de la cual Kiba renueva un canal |
| `CHANNEL_TTL_EXTEND_LEDGERS` | `518400` (~30 días) | Hasta cuánta vida se renueva |
| `CHANNEL_IDLE_DAYS` | `90` | Días sin uso tras los que el depósito se devuelve a la wallet; `0` = nunca |
| `CHANNEL_IDLE_NOTICE_DAYS` | `7` | Antelación con que el dashboard avisa de esa devolución |

El intervalo del trabajo y el tiempo máximo sin cobrar deben ser mucho menores que la espera del
retiro: es el margen que tiene Kiba para cobrar antes de que el usuario pueda llevarse el resto.

## Vida de los canales

Stellar archiva los datos de un contrato cuando vence el plazo que tienen pagado. Un canal nace
con unos 7 días en testnet. Archivado no se pierde nada, pero no se puede cobrar ni retirar hasta
restaurarlo. El trabajo del gateway lo evita:

- Renueva cada canal vivo cuando le quedan menos de `CHANNEL_TTL_MIN_LEDGERS`. Solo renueva lo
  propio del canal, su instancia y su saldo. Medido en testnet: 0,014 XLM por unos 23 días.
- Renueva aparte lo compartido: la fábrica y el molde de los canales. El molde es lo que pesa:
  unos 2,2 XLM por 23 días, una sola vez para todos los canales.
- Si algo llegó a archivarse, lo restaura antes de renovar. Los cobros y las transacciones del
  usuario también restauran lo que necesiten antes de ejecutarse.

Las pruebas están en `packages/gateway/test/channel.test.ts` (red en memoria),
`packages/gateway/test/e2e-channel.mts` (ciclo del canal en testnet) y
`packages/gateway/test/e2e-channel-calls.mts` (llamadas reales pagadas del depósito).
