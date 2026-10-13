---
title: "Erros"
description: "Códigos HTTP e mensagens de erro comuns da API do gateway."
---

# Erros

Todo erro é um objeto JSON com uma única string `error`:

```json
{ "error": "service required" }
```

| Status | Significado |
|---|---|
| `400` | Entrada inválida: campo faltando ou desconhecido, valor inválido, nome longo demais. A mensagem diz qual. |
| `401` | Credencial ausente ou inválida. Em `/mcp` a resposta traz `WWW-Authenticate` com a URL dos metadados do recurso. |
| `404` | Usuário, chave ou conexão desconhecidos. |
| `500` | A chamada ao serviço falhou ou um upstream (descoberta, Trustless Work <TW />, Stellar) devolveu erro. A string `error` traz a mensagem do upstream. **Uma chamada que falha é reembolsada em créditos.** |

## Mensagens comuns

| Mensagem | Causa |
|---|---|
| `service required` | Falta `service` em `POST /v1/call`. |
| Campo desconhecido | Há campos além de `service` e `payload`: coloque a entrada do serviço dentro de `payload`. |
| `insufficient balance` | Créditos e wallet juntos não cobrem o preço. |
| `invalid amount (must be 0 < n <= 1000)` | Valor de recarga fora do intervalo. |
| `balance cap exceeded (max $10000)` | A recarga ultrapassaria o teto de créditos. |
| `name required` / `name too long (max 64)` | Nome inválido ao criar uma API key. |

Mais casos em [FAQ e solução de problemas](/recursos/faq#llamadas).
