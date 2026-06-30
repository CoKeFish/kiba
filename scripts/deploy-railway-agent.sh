#!/usr/bin/env bash
#
# Despliega un demo-agent a Railway como servicio propio (1 servicio por agente).
#
# Hace todo el "paso de Railway" de punta a punta:
#   1. Genera un keypair Stellar nuevo para el agente (owner on-chain).
#   2. Lo fondea en testnet (friendbot) para que pueda pagar el register_service.
#   3. Crea el servicio `kiba-agent-<corto>` clonando las variables COMPARTIDAS
#      de un agente ya desplegado (REF_SERVICE) → garantiza paridad de envs y
#      evita el 402 por variables faltantes (KIBA_PLATFORM_PUBLIC_KEY,
#      TRUSTLESS_WORK_PLATFORM_ADDRESS, etc.).
#   4. Despliega con el Dockerfile.railway (lo selecciona RAILWAY_DOCKERFILE_PATH,
#      también clonado), genera el dominio público y fija PUBLIC_ENDPOINT.
#   5. El redeploy hace que bootstrap() detecte el drift de endpoint y registre
#      la URL pública correcta on-chain.
#
# Uso:
#   scripts/deploy-railway-agent.sh <AGENT_NAME>
#   # ej: scripts/deploy-railway-agent.sh world-clock
#   #     scripts/deploy-railway-agent.sh randomizer
#
# Requisitos: railway CLI (logueado + linkeado a kiba/production), docker
# (imagen kiba-demo-agents:latest para generar el keypair), curl.
#
# Variables opcionales:
#   REF_SERVICE     agente del que clonar las envs compartidas (def: kiba-agent-code)
#   FRIENDBOT_URL   endpoint de fondeo testnet (def: https://friendbot.stellar.org)
set -euo pipefail

AGENT_NAME="${1:-}"
if [[ -z "$AGENT_NAME" ]]; then
  echo "uso: $0 <AGENT_NAME>   (ej: world-clock | randomizer)" >&2
  exit 2
fi

REF_SERVICE="${REF_SERVICE:-kiba-agent-code}"
FRIENDBOT_URL="${FRIENDBOT_URL:-https://friendbot.stellar.org}"
IMAGE="${IMAGE:-kiba-demo-agents:latest}"

# Servicio = kiba-agent-<corto>, donde <corto> es el prefijo antes del primer '-'
# (mismo mapeo que el CMD del Dockerfile: ${AGENT_NAME%%-*}). world-clock → world.
SHORT="${AGENT_NAME%%-*}"
SVC="kiba-agent-${SHORT}"

# Envs de APP compartidas por todos los agentes (las RAILWAY_* las inyecta Railway,
# y AGENT_NAME / AGENT_WALLET_SECRET / PUBLIC_ENDPOINT son por-agente → no se clonan).
SHARED_KEYS="BACKEND_URL CHAIN KIBA_PLATFORM_PUBLIC_KEY PLATFORM_CALL_SECRET RAILWAY_DOCKERFILE_PATH STELLAR_CONTRACT_ID STELLAR_FRIENDBOT_URL STELLAR_HORIZON_URL STELLAR_NETWORK_PASSPHRASE STELLAR_RPC_URL TRUSTLESS_WORK_API_KEY TRUSTLESS_WORK_PLATFORM_ADDRESS"

cd "$(cd "$(dirname "$0")/.." && pwd)"  # raíz del repo (railway up sube el dir actual)

echo "▶ Agente: $AGENT_NAME  →  servicio: $SVC  (clonando envs de $REF_SERVICE)"

# Guard: no pisar un servicio existente (rotaría su keypair / endpoint).
if railway variables --service "$SVC" --kv >/dev/null 2>&1; then
  echo "✋ El servicio $SVC ya existe. Aborto para no pisar su keypair/endpoint." >&2
  echo "   Para re-desplegar código: railway up --service $SVC --detach" >&2
  exit 1
fi

# 1) Keypair nuevo (secreto S... + pubkey G...) generado con el SDK dentro de la imagen.
echo "▶ Generando keypair Stellar…"
read -r SECRET PUBKEY <<<"$(docker run --rm --entrypoint node "$IMAGE" -e \
  'const k=require("@stellar/stellar-sdk").Keypair.random(); console.log(k.secret(), k.publicKey())' \
  | tr -d '\r')"
if [[ -z "${SECRET:-}" || -z "${PUBKEY:-}" ]]; then
  echo "✋ No pude generar el keypair (¿existe la imagen $IMAGE?)." >&2
  exit 1
fi
echo "   pubkey: $PUBKEY"

# 2) Fondear en testnet para pagar la tx de registro on-chain.
echo "▶ Fondeando en testnet (friendbot)…"
curl -fsS "${FRIENDBOT_URL}/?addr=${PUBKEY}" -o /dev/null && echo "   ✓ fondeado" \
  || echo "   ⚠ friendbot no confirmó (sigue; tal vez ya estaba fondeado)"

# 3) Clonar las envs compartidas del agente de referencia.
echo "▶ Clonando variables compartidas de $REF_SERVICE…"
add_args=()
while IFS= read -r line; do
  key="${line%%=*}"
  case " $SHARED_KEYS " in
    *" $key "*) add_args+=( --variables "$line" ) ;;
  esac
done < <(railway variables --service "$REF_SERVICE" --kv)

if [[ ${#add_args[@]} -eq 0 ]]; then
  echo "✋ No pude leer variables de $REF_SERVICE." >&2
  exit 1
fi

# 4) Crear el servicio con las envs compartidas + las por-agente.
echo "▶ Creando servicio $SVC…"
railway add --service "$SVC" \
  "${add_args[@]}" \
  --variables "AGENT_NAME=${AGENT_NAME}" \
  --variables "AGENT_WALLET_SECRET=${SECRET}"

# 5) Primer deploy (sube el dir actual; Railway construye con Dockerfile.railway).
echo "▶ Desplegando (railway up)…"
railway up --service "$SVC" --detach

# 6) Generar dominio público y fijar PUBLIC_ENDPOINT (el redeploy corrige el
#    endpoint on-chain vía drift de bootstrap()).
echo "▶ Generando dominio público…"
DOMAIN="$(railway domain --service "$SVC" 2>&1 | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1 || true)"
if [[ -z "$DOMAIN" ]]; then
  echo "⚠ No pude leer el dominio generado. Genéralo a mano:" >&2
  echo "    railway domain --service $SVC" >&2
  echo "    railway variables --service $SVC --set \"PUBLIC_ENDPOINT=https://<dominio>\"" >&2
  exit 1
fi
echo "   dominio: https://$DOMAIN"

echo "▶ Fijando PUBLIC_ENDPOINT (dispara redeploy)…"
railway variables --service "$SVC" --set "PUBLIC_ENDPOINT=https://${DOMAIN}"

cat <<EOF

✅ Listo: $AGENT_NAME desplegado como $SVC
   URL:    https://$DOMAIN
   owner:  $PUBKEY  (keypair en AGENT_WALLET_SECRET; fondéalo en mainnet si migras)

Verifica (1-2 min tras el build):
   railway logs --service $SVC            # busca "registered on-chain"
   curl -s https://$DOMAIN/manifest | jq  # debe reportar service=$AGENT_NAME
   # y en el chat con Kiba: list_agents debería incluir "$AGENT_NAME"
EOF
