#!/usr/bin/env bash
#
# Smoke test on-chain del flujo de pago completo contra el contrato ya desplegado
# en testnet: register_agent → open_escrow → claim_payment, verificando el split
# 95/5 por balances del token (XLM SAC).
#
# Correr DENTRO de la imagen kiba/stellar-cli con el volumen de config:
#   bash scripts/smoke-testnet.sh
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACT="${CONTRACT:-CDYLMRS2UTBHNTWS67NC2OPQIH2HXGS36WZYC4JUMLKZWT7XXVUUX7XF}"
TOKEN="${TOKEN:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}" # XLM SAC

TS="$(date +%s)"
SERVICE="smoke-$TS"
PRICE=1000000     # 0.1 XLM (7 decimales)
AMOUNT=10000000   # 1.0 XLM  → fee 5% = 500000, owner 95% = 9500000
NONCE="$TS"

invw() { stellar contract invoke --id "$CONTRACT" --source "$1" --network "$NETWORK" --send=yes -- "${@:2}"; }
invr() { stellar contract invoke --id "$CONTRACT" --source "$1" --network "$NETWORK" -- "${@:2}"; }
bal()  { stellar contract invoke --id "$TOKEN" --source deployer --network "$NETWORK" -- balance --id "$1" | tr -d '"'; }

# Identidades: agent (owner del servicio) y client (pagador). deployer = treasury.
for id in agent client; do
  if ! stellar keys address "$id" >/dev/null 2>&1; then
    echo "→ generando + fondeando '$id'"
    stellar keys generate "$id" --network "$NETWORK" --fund
  fi
done
AGENT_ADDR="$(stellar keys address agent)"
CLIENT_ADDR="$(stellar keys address client)"
TREASURY_ADDR="$(stellar keys address deployer)"
echo "agent    = $AGENT_ADDR"
echo "client   = $CLIENT_ADDR"
echo "treasury = $TREASURY_ADDR"
echo

# 1. Registrar el agente (firma agent → owner.require_auth)
echo "→ register_agent($SERVICE, price=$PRICE)"
invw agent register_agent --owner "$AGENT_ADDR" --service "$SERVICE" \
  --price_per_call "$PRICE" --endpoint "http://smoke:5001" --description "smoke"

OWNER_BEFORE="$(bal "$AGENT_ADDR")"
TREAS_BEFORE="$(bal "$TREASURY_ADDR")"
echo "   owner_before=$OWNER_BEFORE  treasury_before=$TREAS_BEFORE"
echo

# 2. Abrir escrow (firma client → client.require_auth + transfiere XLM al contrato)
echo "→ open_escrow(nonce=$NONCE, amount=$AMOUNT)"
invw client open_escrow --client "$CLIENT_ADDR" --service "$SERVICE" \
  --nonce "$NONCE" --amount "$AMOUNT"
echo "   estado del escrow:"
invr agent get_escrow --client "$CLIENT_ADDR" --agent_owner "$AGENT_ADDR" --nonce "$NONCE"
echo

# 3. Reclamar (firma agent → owner.require_auth → split 95/5)
echo "→ claim_payment"
invw agent claim_payment --client "$CLIENT_ADDR" --agent_owner "$AGENT_ADDR" --nonce "$NONCE"
echo "   estado del escrow tras claim:"
invr agent get_escrow --client "$CLIENT_ADDR" --agent_owner "$AGENT_ADDR" --nonce "$NONCE"
echo

OWNER_AFTER="$(bal "$AGENT_ADDR")"
TREAS_AFTER="$(bal "$TREASURY_ADDR")"
OWNER_DELTA=$((OWNER_AFTER - OWNER_BEFORE))
TREAS_DELTA=$((TREAS_AFTER - TREAS_BEFORE))

echo "════════════════════════════════════════════"
echo "owner    Δ = $OWNER_DELTA  (95% = 9500000, menos fees de tx que paga el owner)"
echo "treasury Δ = $TREAS_DELTA  (esperado exactamente 500000 = 5%)"
echo "════════════════════════════════════════════"

# La treasury no firma ninguna tx → su delta es exactamente el fee, sin ruido de fees.
if [ "$TREAS_DELTA" -eq 500000 ]; then
  echo "✅ SMOKE OK: split 5% verificado on-chain (treasury +500000 stroops)."
else
  echo "❌ SMOKE FAIL: treasury delta=$TREAS_DELTA, esperado 500000"
  exit 1
fi
