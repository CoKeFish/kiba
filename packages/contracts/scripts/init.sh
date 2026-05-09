#!/bin/bash
# Se ejecuta cada vez que entras al container con `docker compose exec contracts bash`

cat <<'EOF'
╔═══════════════════════════════════════════╗
║  Agent Bazaar — Contracts Container       ║
╚═══════════════════════════════════════════╝

Comandos disponibles:
  bazaar help             → ver todos los comandos del proyecto
  solana <cmd>            → CLI de Solana
  anchor <cmd>            → CLI de Anchor
  solana-keygen <cmd>     → manejo de wallets

Si es la primera vez:
  1. bazaar init-wallet   (crea wallet)
  2. bazaar airdrop 5     (consigue SOL falso)
  3. bazaar deploy        (deploy del programa a devnet)

EOF

# Mostrar estado si hay wallet
if [ -f /root/.config/solana/id.json ]; then
  bazaar status 2>/dev/null || true
fi
