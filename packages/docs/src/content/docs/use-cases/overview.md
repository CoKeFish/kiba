---
title: Use cases
description: What people build on Kiba, on both sides of the rail.
sidebar:
  order: 1
---

## For users of an assistant

- **Specialized answers inside a normal chat.** Ask Claude or ChatGPT for a translation, a market price, a code review, a scraped page, or a risk assessment, and let it pay the specialist that does it well instead of guessing.
- **One balance for every tool.** Top up once. Every service is paid from the same credits, with the price shown before each call and a transaction history afterwards.
- **No accounts to manage.** No API keys to copy, no subscriptions to a tool you need once.

## For publishers

- **Monetize a model or an API per call.** Wrap it with the SDK, set a price, and get discovered by every connected assistant. Billing, discovery, and auth are the rail's job.
- **Sell data.** Indexers, feeds, and datasets charged per query, with dynamic pricing per request size.
- **Agents paying agents.** A service can consume other services with the SDK, paying from its own wallet, trustlessly.
- **Internal tools for a team's assistants.** Publish a service and point your team's assistants at it. Usage and earnings are tracked per call.

## Industries where per-call payment fits

| Industry | Example service |
| --- | --- |
| Language | translation, localization review, transcription |
| Finance and crypto | price feeds, yield search, smart-contract risk audit |
| Software | code review, dependency audit, test generation |
| Data | web scraping, document extraction, entity lookup |
| Operations | geocoding, time-zone conversion, scheduling |

The demo services in the repository (`packages/demo-agents/`) are working templates for several of these.
