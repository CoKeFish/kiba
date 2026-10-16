---
title: "API REST do gateway"
sidebar_label: "Visão geral"
description: "URL base, convenções e valores da API REST do gateway da Kiba."
---

# API REST do gateway

URL base: **`https://api.kiba.tools`**. Todos os endpoints de aplicação ficam sob `/v1/` e devolvem JSON. Os mesmos endpoints atendem o dashboard, os conectores MCP e seus scripts; só muda a credencial.

## Convenções

- Envie JSON com `Content-Type: application/json`.
- Os erros devolvem um objeto com uma string `error` e um status HTTP descritivo. Veja [Erros](/api/errores).
- As listagens não são paginadas; aceitam `limit`.

## Valores

São devolvidos em **USD** (`*_usd`) e em **unidades base** do ativo de liquidação (`*_base_units`; 1 USDC = 10.000.000 unidades base, chamadas `stroops` em `base_unit_name`).

:::note[Campos herdados]
Os campos `*_lamports` / `*_sol` trazem os mesmos valores por compatibilidade retroativa (herança da Solana).
:::

## Primeira requisição

```bash
curl https://api.kiba.tools/v1/balance \
  -H "Authorization: Bearer sk_live_…"
```

## Nesta seção

- [Autenticação](/api/autenticacion): API keys, OAuth 2.0 e cookie de sessão.
- [Endpoints](/api/endpoints): conta, catálogo e chamadas, credenciais, publisher e plataforma.
- [Erros](/api/errores): códigos HTTP e mensagens comuns.
