#!/usr/bin/env bash
#
# Publica el canal de pago de Stellar (one-way-channel) y su fábrica.
#
# El código NO es de Kiba: es el contrato de stellar-experimental/one-way-channel (Apache 2.0),
# fijado al commit de abajo. Este script lo descarga, lo compila, sube el código del canal
# (el molde) y despliega la fábrica que crea un canal por usuario.
#
# Pensado para correr DENTRO de la imagen kiba/stellar-cli:
#
#   docker run --rm -v "$PWD/packages/contracts-channel:/pkg:ro" \
#     -v kiba-stellar-config:/root/.config/stellar -v kiba-channel-build:/work \
#     kiba/stellar-cli bash /pkg/scripts/deploy.sh
#
# Variables opcionales:
#   NETWORK   (default: testnet)
#   IDENTITY  (default: kiba-payments-deployer) — identidad del CLI; queda como admin de la fábrica
#   WORK      (default: /work)                  — carpeta de trabajo (clon y artefactos)
set -euo pipefail

UPSTREAM="https://github.com/stellar-experimental/one-way-channel"
COMMIT_PREFIX="25dea1b"
NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-kiba-payments-deployer}"
WORK="${WORK:-/work}"

ADMIN="$(stellar keys address "$IDENTITY")"
echo "→ red: $NETWORK · admin de la fábrica: $ADMIN"

SRC="$WORK/one-way-channel"
if [ ! -d "$SRC/.git" ]; then
  git clone "$UPSTREAM" "$SRC"
fi
git -C "$SRC" fetch --quiet origin
git -C "$SRC" checkout --quiet "$COMMIT_PREFIX"
HEAD="$(git -C "$SRC" rev-parse HEAD)"
case "$HEAD" in "$COMMIT_PREFIX"*) ;; *) echo "commit inesperado: $HEAD" >&2; exit 1 ;; esac
echo "→ fuente: $UPSTREAM @ $HEAD"

export CARGO_TARGET_DIR="$WORK/target"
(cd "$SRC" && stellar contract build >/dev/null)
W="$CARGO_TARGET_DIR/wasm32v1-none/release"
echo "→ sha256 canal:   $(sha256sum "$W/channel.wasm" | cut -d' ' -f1)"
echo "→ sha256 fábrica: $(sha256sum "$W/channel_factory.wasm" | cut -d' ' -f1)"

CHANNEL_HASH="$(stellar contract upload --wasm "$W/channel.wasm" --source "$IDENTITY" --network "$NETWORK")"
FACTORY_HASH="$(stellar contract upload --wasm "$W/channel_factory.wasm" --source "$IDENTITY" --network "$NETWORK")"
FACTORY_ID="$(stellar contract deploy --wasm-hash "$FACTORY_HASH" --source "$IDENTITY" --network "$NETWORK" \
  -- --admin "$IDENTITY" --wasm_hash "$CHANNEL_HASH")"

echo
echo "código del canal (wasm hash): $CHANNEL_HASH"
echo "fábrica:                      $FACTORY_ID"
echo
echo "Configura el gateway con:  KIBA_CHANNEL_FACTORY_ID=$FACTORY_ID"
