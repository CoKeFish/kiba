---
title: "Seguridad y límites conocidos"
sidebar_label: "Seguridad y límites"
description: "Qué protege Kiba hoy y qué no."
---

# Seguridad y límites conocidos

Kiba es una demostración técnica en testnet. Esta página dice qué protege hoy y qué no.

## Qué hay

| Área | Medida |
|---|---|
| Autenticación | OAuth 2.0 con PKCE (S256) y registro dinámico de clientes; tokens atados al recurso `/mcp` (RFC 8707), con vigencia de 30 días y revocables. |
| API keys | Se muestran una sola vez; el gateway guarda solo un hash SHA-256. Se pueden revocar. |
| Sesiones | Cookie JWT. En producción el gateway rechaza un `JWT_SECRET` ausente, por defecto o de menos de 32 caracteres. |
| Llamadas de plataforma a servicios | Certificado firmado con ed25519 (`service`, hash del payload, marca de tiempo, nonce); verificación de frescura (~2 min) y protección contra repetición. El servicio guarda solo la clave pública de la plataforma. |
| Escrow directo | Cada escrow se atiende una sola vez y debe nombrar al servicio como receptor. |
| Servicios | Límite de cuerpo (`256kb`) y de tasa en la ruta de cotización (60/min por defecto). |
| Nombres | `verifyEndpoint` contrasta el `/manifest` del endpoint con el registro on-chain. |
| Liquidación | Las filas se reclaman con `settlement_id` antes de pagar; un pago fallido las libera; el barrido es reentrante. Una llamada fallida se reembolsa. |
| Repositorio | Escaneo de secretos (gitleaks) y pruebas como compuertas del despliegue. Secretos de producción fuera del repo. |

## Límites conocidos

:::warning[Antes de usar Kiba con algo que importe]
- **Solo testnet.** Los saldos no tienen valor real.
- **Sin auditoría formal** del contrato Soroban (prevista antes de mainnet).
- **Sin trabajo regulatorio** (KYC/AML) para operación custodial. Los créditos son un saldo del gateway, es decir, la plataforma custodia ese saldo.
:::

- **Nombres sin protección de marca:** tomar un nombre libre antes que su dueño es posible. Ver [Nombres y confianza](/publica-un-servicio/nombres-y-confianza).
- **Contadores del contrato informativos:** la fuente de verdad de ganancias es el libro del gateway.
- **Tesorería con clave caliente única** en el gateway; reposición automática de fondos y pool de cuentas-canal para alta concurrencia están pendientes.
- Sin SLA ni garantías de disponibilidad.

¿Encontraste un problema de seguridad? Escribe al [correo del equipo](/recursos/soporte#reportes-de-seguridad) en lugar de abrir un issue público.
