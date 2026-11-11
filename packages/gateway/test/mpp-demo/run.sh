#!/usr/bin/env bash
# E2E de MPP contra el demo oficial de Stellar, en testnet y con USDC real.
# Corre desde la raíz del repositorio. Necesita Docker y la clave de una cuenta de testnet con
# USDC de Circle, que hace de tesorería:
#
#   E2E_TREASURY_SECRET=S... packages/gateway/test/mpp-demo/run.sh
#
# Qué hace:
#   1. Construye la imagen del demo oficial y la del gateway.
#   2. Crea dos cuentas de un solo uso: a la que cobra el servidor del demo y con la que paga su cliente.
#   3. A: Kiba le paga al servidor del demo.   B: el cliente del demo le paga a la ruta pública de Kiba.
set -euo pipefail
: "${E2E_TREASURY_SECRET:?falta E2E_TREASURY_SECRET}"
NET=kiba-mpp-e2e-net
OUT=$(mktemp -d)
cleanup() {
  docker rm -f kiba-mpp-e2e-pg kiba-mpp-demo-server kiba-mpp-e2e >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -q -t kiba-mpp-demo packages/gateway/test/mpp-demo >/dev/null
docker build -q -f packages/gateway/Dockerfile -t kiba-gw-mpp-e2e . >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name kiba-mpp-e2e-pg --network "$NET" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kiba_test postgres:16-alpine >/dev/null
sleep 6

docker run --rm -v "$OUT:/out" kiba-gw-mpp-e2e node --import tsx test/e2e-mpp-demo.mts prepare
# shellcheck disable=SC1091
source "$OUT/demo.env"

docker run -d --name kiba-mpp-demo-server --network "$NET" -e STELLAR_RECIPIENT="$MPP_DEMO_RECIPIENT" -e PORT=3000 kiba-mpp-demo >/dev/null
docker run -d --name kiba-mpp-e2e --network "$NET" \
  -e DATABASE_URL=postgres://postgres:postgres@kiba-mpp-e2e-pg:5432/kiba_test \
  -e E2E_TREASURY_SECRET -e MPP_DEMO_SERVER_URL=http://kiba-mpp-demo-server:3000 \
  -e MPP_DEMO_RECIPIENT="$MPP_DEMO_RECIPIENT" -e MPP_DEMO_PAYER="$MPP_DEMO_PAYER" \
  kiba-gw-mpp-e2e node --import tsx test/e2e-mpp-demo.mts >/dev/null

# Parte A corre sola. Cuando Kiba queda esperando, entra el cliente del demo (parte B).
for _ in $(seq 1 60); do
  docker logs kiba-mpp-e2e 2>&1 | grep -q 'LISTO\|comprobaciones' && break
  sleep 3
done
docker run --rm --network "$NET" -e STELLAR_SECRET="$MPP_DEMO_PAYER_SECRET" \
  -e SERVER_URL=http://kiba-mpp-e2e:8055/mpp/traductor kiba-mpp-demo pnpm demo:charge-client

for _ in $(seq 1 60); do
  docker logs kiba-mpp-e2e 2>&1 | grep -q 'comprobaciones' && break
  sleep 3
done
docker logs kiba-mpp-e2e 2>&1 | grep -E '^PASA|^FALLA|comprobaciones'
docker logs kiba-mpp-e2e 2>&1 | grep -q '^FALLA' && exit 1 || exit 0
