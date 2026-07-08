#!/bin/sh
# Entrypoint de los demo-agents en Coolify. Corre DENTRO de `doppler run`
# (los secretos de Doppler ya están en el entorno): mapea el secreto namespaced
# AGENT_WALLET_SECRET_<KEY> -> AGENT_WALLET_SECRET según AGENT_NAME, y hace
# unset del resto para que cada agente solo conserve SU keypair.
# Mapeo (mismo criterio %%-* que el CMD de Railway): translator-pro -> TRANSLATOR,
# yield-hunter -> YIELD, risk-auditor -> RISK, price-oracle -> PRICE,
# code-reviewer -> CODE, firecrawl -> FIRECRAWL, world-clock -> WORLD,
# randomizer -> RANDOMIZER.
set -eu

[ -n "${AGENT_NAME:-}" ] || { echo "FATAL: AGENT_NAME no definido" >&2; exit 1; }

short="${AGENT_NAME%%-*}"
key=$(printf '%s' "$short" | tr '[:lower:]' '[:upper:]')

eval "secret=\${AGENT_WALLET_SECRET_${key}:-}"
[ -n "$secret" ] || { echo "FATAL: AGENT_WALLET_SECRET_${key} no está en Doppler" >&2; exit 1; }
export AGENT_WALLET_SECRET="$secret"

unset secret
unset AGENT_WALLET_SECRET_TRANSLATOR AGENT_WALLET_SECRET_YIELD \
      AGENT_WALLET_SECRET_RISK AGENT_WALLET_SECRET_PRICE \
      AGENT_WALLET_SECRET_CODE AGENT_WALLET_SECRET_FIRECRAWL \
      AGENT_WALLET_SECRET_WORLD AGENT_WALLET_SECRET_RANDOMIZER 2>/dev/null || true

exec npm run "start:${short}"
