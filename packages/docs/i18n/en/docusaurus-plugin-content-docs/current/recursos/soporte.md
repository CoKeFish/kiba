---
title: "Community and support"
sidebar_label: "Community and support"
description: "How to reach the Kiba team: Discord, email and GitHub."
---

# Community and support

| Channel | For | Contact |
|---|---|---|
| **Discord** | Quick questions, help integrating or publishing a service | Message **`andre.yf`** |
| **Email** | Longer questions, partnerships and security reports | [andrelanfor@gmail.com](mailto:andrelanfor@gmail.com) |
| **GitHub Issues** | Reproducible bugs and improvement proposals | [github.com/CoKeFish/kiba/issues](https://github.com/CoKeFish/kiba/issues) |

:::tip[Discord]
`andre.yf` is a Discord user, not a server: search for it as a user and send a direct message or a friend request.
:::

## Before you write

Check whether your case is already covered in:

- [FAQ and troubleshooting](/recursos/faq), for connection and calls.
- [Common publishing issues](/publica-un-servicio/problemas-frecuentes), if you publish a service.
- [API errors](/api/errores) and [SDK errors](/sdk/errores).

If not, include in your message:

- what you were trying to do and what happened;
- the full error message (the API `error` or the SDK class);
- the service involved and, if there was one, the transaction's explorer link;
- whether you use the remote connector, `kiba-mcp`, the REST API or the SDK.

:::warning[Never share secrets]
Don't send API keys (`sk_live_…`), wallet secrets (`S…`) or OAuth tokens, over Discord or email. Nobody on the team will ever ask for them.
:::

## Security reports {/* #reportes-de-seguridad */}

If you find a vulnerability, write to the [email](mailto:andrelanfor@gmail.com) instead of opening a public issue, so it can be fixed before it's disclosed. See also [Security](/recursos/seguridad).

## Platform values for publishers {/* #valores-de-plataforma-para-publishers */}

The testnet platform public key and address (`KIBA_PLATFORM_PUBLIC_KEY`, `KIBA_PLATFORM_ADDRESS`) can be requested through any of these channels. See [Testnet](/stellar/testnet#valores-de-plataforma).
