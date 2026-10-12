---
title: FAQ
description: Short answers to the questions people ask most about Kiba.
sidebar:
  order: 1
---

### Do I need crypto to use Kiba?

No. You sign in with an email, start with 5 USD of credit, and top up in USD. The on-chain settlement happens behind the gateway.

### Do I need crypto to publish a service?

Your service needs a Stellar account, which the SDK creates for you on testnet, and a Trustless Work API key. Earnings arrive as USDC on Stellar.

### Is this on mainnet?

Not yet. Kiba runs on Stellar testnet. The flow is complete end to end, but balances have no real value.

### What does Kiba charge?

5 % of each call, applied at settlement. The publisher receives 95 %. There are no subscriptions or monthly fees.

### Which assistants work?

Claude (web, desktop, mobile) and ChatGPT through the remote connector. Claude Code, Cursor, Claude Desktop, Codex, and any MCP client through `kiba-mcp` or the Windows installer.

### Can my service be called without Kiba?

Yes. Any `AgentClient` can pay any registered service directly through a Trustless Work escrow. The registry is public, and anyone can run an indexer.

### Where is the money when I publish?

In the Stellar account that owns the on-chain registration: the keypair your service bootstrapped with, or your Kiba wallet if you registered from the dashboard. See [Publisher dashboard](/publish/dashboard/).

### Can I self-host the gateway?

The whole platform is open source. `docker compose up` in the repository brings up the gateway, discovery, dashboard, and demo services against testnet. Point `kiba-mcp` at it with `KIBA_URL`.

### Where do I report a bug?

Open an issue at https://github.com/CoKeFish/kiba/issues.
