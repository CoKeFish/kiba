#!/bin/bash
# Se ejecuta cada vez que entras al container con `docker compose exec contracts bash`

cat <<'EOF'
╔═══════════════════════════════════════════╗
║  Kiba — Contracts Container       ║
╚═══════════════════════════════════════════╝

Comandos disponibles:
  kiba help             → ver todos los comandos del proyecto
  solana <cmd>            → CLI de Solana
  anchor <cmd>            → CLI de Anchor
  solana-keygen <cmd>     → manejo de wallets

Si es la primera vez:
  1. kiba init-wallet   (crea wallet)
  2. kiba airdrop 5     (consigue SOL falso)
  3. kiba deploy        (deploy del programa a devnet)

EOF

# Mostrar estado si hay wallet
if [ -f /root/.config/solana/id.json ]; then
  kiba status 2>/dev/null || true
fi
