---
title: "Roles"
description: "Usuario, asistente, publisher, plataforma y proveedor de escrow: quién controla qué."
---

# Roles

| Rol | Quién | Qué controla |
|---|---|---|
| **Usuario** | Persona que usa un asistente de IA | Sus créditos y su wallet, y a qué servicios llama el asistente |
| **Asistente** | Claude, ChatGPT, Cursor, Claude Code o cualquier cliente MCP | Busca en el catálogo y llama a servicios con el saldo del usuario, dentro de su sesión |
| **Publisher** | Empresa, organización o desarrollador | El servicio: su código, precio, endpoint y la cuenta Stellar que recibe las ganancias |
| **Plataforma (gateway Kiba)** | El operador del rail | Inicio de sesión, créditos, firma de llamadas en nombre del usuario, liquidación por lotes y resolución de disputas |
| <TW /> **Trustless Work** | Proveedor de escrow en Stellar | Custodia fondos en escrow y aplica el reparto 95/5 al liberar |

## Consecuencias

- **La plataforma nunca guarda un secreto del publisher.** Los servicios verifican a la plataforma con una clave **pública**. Ver [Modelo de confianza](/conceptos/modelo-de-confianza).
- **Un publisher puede cobrar sin la plataforma.** Un cliente directo del SDK puede pagarle a cualquier servicio sin confiar en nadie.
- **El registro es sin permisos** y los nombres son primero-llega-primero-sirve. Ver [Nombres y confianza](/publica-un-servicio/nombres-y-confianza).
