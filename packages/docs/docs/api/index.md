---
title: "API REST del gateway"
sidebar_label: "Visión general"
description: "URL base, convenciones y montos de la API REST del gateway de Kiba."
---

# API REST del gateway

URL base: **`https://api.kiba.tools`**. Todos los endpoints de aplicación viven bajo `/v1/` y devuelven JSON. Los mismos endpoints sirven al dashboard, a los conectores MCP y a tus scripts; solo cambia la credencial.

## Convenciones

- Envía JSON con `Content-Type: application/json`.
- Los errores devuelven un objeto con un string `error` y un estado HTTP descriptivo. Ver [Errores](/api/errores).
- Los listados no están paginados; aceptan `limit`.

## Montos

Se devuelven en **USD** (`*_usd`) y en **unidades base** del activo de liquidación (`*_base_units`; 1 USDC = 10.000.000 unidades base, llamadas `stroops` en `base_unit_name`).

:::note[Campos heredados]
Los campos `*_lamports` / `*_sol` llevan los mismos valores por compatibilidad hacia atrás (herencia de Solana).
:::

## Primer request

```bash
curl https://api.kiba.tools/v1/balance \
  -H "Authorization: Bearer sk_live_…"
```

## En esta sección

- [Autenticación](/api/autenticacion): API keys, OAuth 2.0 y cookie de sesión.
- [Endpoints](/api/endpoints): cuenta, catálogo y llamadas, credenciales, publisher y plataforma.
- [Errores](/api/errores): códigos HTTP y mensajes comunes.
