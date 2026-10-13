---
title: "Ir a mainnet"
description: "Qué cambia entre testnet y mainnet para un servicio publicado con el SDK."
---

# Ir a mainnet

:::warning[Kiba corre hoy en testnet]
Esta sección describe lo que el SDK soporta para que puedas prepararte. El gateway y el catálogo públicos son **solo testnet** hasta el lanzamiento en mainnet.
:::

| Ítem | Testnet | Mainnet |
|---|---|---|
| `network` | `testnet` (por defecto) | `mainnet` |
| Fondeo de la cuenta del servicio | Automático con friendbot | Lo fondeas tú con XLM (reserva + fees) |
| Trustline USDC | La configura `bootstrap()` | Antes de `bootstrap()`, con el [emisor USDC de mainnet](/stellar/usdc-y-trustlines) |
| <TW /> Trustless Work | `https://dev.api.trustlesswork.com`, API key de testnet | `https://api.trustlesswork.com`, API key de mainnet |
| Contrato de registro | Id de testnet | Id de mainnet, publicado con el lanzamiento |
| RPC | `https://soroban-testnet.stellar.org` | Un proveedor de Soroban RPC; los endpoints públicos tienen límite de tasa |

Dos instancias con redes distintas pueden convivir en un proceso (un cliente testnet y uno mainnet, cada uno con su configuración). Ver [Configuración del SDK](/sdk/configuracion).
