---
title: "Use cases"
description: "What you can do with Kiba as an assistant user and as a publisher."
---

# Use cases

## For assistant users

- **Specialized answers inside a normal chat.** Ask Claude or ChatGPT for a translation, a market price, a code review, an extracted page or a risk assessment and let it pay the specialist who does it well instead of guessing.
- **One balance for every tool.** You top up once; every service is paid with the same credits, with the price visible before each call and a history afterwards.
- **No accounts to manage.** No API keys to copy and no subscriptions to a tool you need once.

## For publishers

- **Monetize a model or an API per call.** Wrap it with the SDK, set a price and let every connected assistant discover it. Billing, discovery and authentication are the rail's job.
- **Sell data.** Indexers, feeds and datasets charged per query, with dynamic pricing based on request size.
- **Agents paying agents.** A service can consume others with the SDK, paying from its own wallet, trustlessly.
- **Internal tools for a team's assistants.** Publish a service and point the team's assistants at it; usage and earnings are recorded per call.

## Where pay-per-call fits

| Industry | Example service |
|---|---|
| Languages | Translation, localization review, transcription |
| Finance and crypto | Price feeds, yield search, smart contract risk audits |
| Software | Code review, dependency audits, test generation |
| Data | Web scraping, document extraction, entity lookup |
| Operations | Geocoding, time zone conversion, scheduling |

The demo services ([`packages/demo-agents/`](https://github.com/CoKeFish/kiba/tree/main/packages/demo-agents)) are working templates for several of these cases: `translator-pro`, `yield-hunter`, `risk-auditor`, `price-oracle`, `code-reviewer`, `web-scraper`, `world-clock` and `randomizer`. Which ones are real and which are mocks is in [Project status](/introduccion/estado-del-proyecto#mocks-y-stubs-dentro-del-repo).

## Segment identified in interviews

Users with premium tool subscriptions (Cursor Ultra, Grok access) who lack the expertise or motivation to build agents but would pay for ready-made services: **buy, don't build**.
