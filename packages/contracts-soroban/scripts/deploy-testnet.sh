#!/usr/bin/env bash
#
# Despliega el contrato Kiba (registro de agentes) en testnet de Stellar.
# Pensado para correr DENTRO de la imagen kiba/stellar-cli, con el repo
# montado en /workspace. Desde packages/contracts-soroban:
#
#   bash scripts/deploy-testnet.sh
#
# Variables opcionales:
#   NETWORK   (default: testnet)
#   IDENTITY  (default: deployer)   — nombre de la identidad del CLI
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-deployer}"

# 1. Identidad: crear + fondear con friendbot si no existe.
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "→ generando identidad '$IDENTITY' en $NETWORK (fondeo friendbot)"
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi
DEPLOYER_ADDR="$(stellar keys address "$IDENTITY")"
echo "→ deployer: $DEPLOYER_ADDR"

# 2. Compilar el contrato a wasm.
#    Respeta CARGO_TARGET_DIR (útil al correr en contenedor con el repo montado:
#    evita mezclar artefactos del host con los del contenedor).
echo "→ compilando contrato"
stellar contract build

# stellar-cli 26+ compila para wasm32v1-none.
TARGET_DIR="${CARGO_TARGET_DIR:-target}"
WASM="$TARGET_DIR/wasm32v1-none/release/kiba_soroban.wasm"

# 3. Desplegar.
echo "→ desplegando a $NETWORK"
CONTRACT_ID="$(stellar contract deploy --wasm "$WASM" --source "$IDENTITY" --network "$NETWORK")"
echo "→ contract id: $CONTRACT_ID"

echo
echo "✅ Desplegado en $NETWORK"
echo "   CONTRACT_ID=$CONTRACT_ID"
echo "   Explorer: https://stellar.expert/explorer/$NETWORK/contract/$CONTRACT_ID"
