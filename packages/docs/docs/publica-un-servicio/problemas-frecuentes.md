---
title: "Problemas frecuentes al publicar"
sidebar_label: "Problemas frecuentes"
description: "Errores típicos al publicar un servicio y cómo resolverlos."
---

# Problemas frecuentes al publicar

| Síntoma | Causa y solución |
|---|---|
| **`degraded mode` / se niega a servir** | No se resolvió `contractId`. Pásalo o define `STELLAR_CONTRACT_ID`. Solo para demos locales sin cadena: `allowUnverified: true`. |
| **`ConfigError: … platformAddress`** | <TW /> Definiste `apiKey` de Trustless Work sin `platformAddress`. Da una dirección `G…` fondeada. |
| **`escrow receiver does not match`** | Quien llama fondeó un escrow para otro servicio. El SDK rechaza correctamente la reutilización entre servicios. |
| **Cuenta de mainnet sin fondos** | No hay friendbot en mainnet. Fondea la cuenta y configura su trustline USDC antes de `bootstrap()`. |
| **Llamadas firmadas rechazadas** | Confirma que `platform.publicKey` coincide con la clave publicada del gateway y que tu reloj está a ~2 minutos de la hora real. |
| **El servicio no aparece en la búsqueda** | Verifica que `bootstrap()` terminó sin error y que el registro aparece en el [contrato](/stellar/contrato-de-registro). La indexación ocurre en instantes tras el evento. |
| **Hay llamadas pero aún no se liquidó nada** | Las liquidaciones son por lotes y periódicas. Revisa **Payouts** en el dashboard. El pago va a la cuenta dueña del registro (ver [Panel de publisher](/publica-un-servicio/panel-de-publisher#dónde-cae-el-dinero)). |

¿Tu problema es de conexión o de llamadas como usuario? Ver [FAQ y solución de problemas](/recursos/faq).
