---
title: "Problemas frequentes ao publicar"
sidebar_label: "Problemas frequentes"
description: "Erros típicos ao publicar um serviço e como resolvê-los."
---

# Problemas frequentes ao publicar

| Sintoma | Causa e solução |
|---|---|
| **`degraded mode` / se recusa a servir** | O `contractId` não foi resolvido. Passe-o ou defina `STELLAR_CONTRACT_ID`. Só para demos locais sem cadeia: `allowUnverified: true`. |
| **`ConfigError: … platformAddress`** | <TW /> Você definiu a `apiKey` da Trustless Work sem `platformAddress`. Informe um endereço `G…` financiado. |
| **`escrow receiver does not match`** | Quem chama financiou um escrow para outro serviço. O SDK rejeita corretamente a reutilização entre serviços. |
| **Conta da mainnet sem fundos** | Não há friendbot na mainnet. Financie a conta e configure a trustline de USDC antes do `bootstrap()`. |
| **Chamadas assinadas rejeitadas** | Confirme que `platform.publicKey` coincide com a chave publicada do gateway e que seu relógio está a ~2 minutos da hora real. |
| **O serviço não aparece na busca** | Verifique se o `bootstrap()` terminou sem erro e se o registro aparece no [contrato](/stellar/contrato-de-registro). A indexação acontece em instantes depois do evento. |
| **Há chamadas mas nada foi liquidado ainda** | As liquidações são em lote e periódicas. Confira **Payouts** no dashboard. O pagamento vai para a conta dona do registro (veja [Painel do publisher](/publica-un-servicio/panel-de-publisher#dónde-cae-el-dinero)). |

Seu problema é de conexão ou de chamadas como usuário? Veja [FAQ e solução de problemas](/recursos/faq).
