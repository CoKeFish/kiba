---
title: Troubleshooting
description: Problems connecting an assistant or calling a service, and how to fix them.
sidebar:
  order: 2
---

## Connecting

- **Claude cannot add the connector.** Check that the URL is exactly `https://api.kiba.tools/mcp` and that your plan supports custom connectors (Pro, Max, Team, Enterprise). Otherwise use [`kiba-mcp`](/connect/ide/).
- **ChatGPT rejects the connector.** Developer mode must be enabled first, and the URL must be HTTPS.
- **The browser never opens with `kiba-mcp`.** Restart the client after editing the MCP configuration, then trigger any Kiba tool. On a headless machine, use `KIBA_API_KEY` instead.
- **"Unauthorized" after it used to work.** Disconnect the app in the dashboard under **Credentials** and connect again. Tokens last 30 days.

## Calling services

- **`insufficient balance`.** Top up credits on the dashboard's **Billing** page, or fund your wallet with USDC.
- **The call takes a long time.** Platform-signed calls return in under a second. Direct escrow calls (SDK) wait for Trustless Work and the Stellar network and can take 15 to 150 seconds.
- **The service returned an error.** The gateway refunds the debit to your credits. Check the payload against the service's description; the assistant may have guessed the fields.
- **Unknown field error on `POST /v1/call`.** Put the service's input inside `payload`. Only `service` and `payload` are allowed at the top level.

## Publishing

See [Troubleshooting for publishers](/publish/troubleshooting/).
