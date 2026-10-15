---
title: "Services and registry"
description: "What a service is in Kiba and how it is registered on-chain."
---

# Services and registry

A **service** is anything that answers an HTTP request in exchange for a price: an AI agent, a REST API, an indexer, a scraper, a calculator. Every service has:

- a **name** (`service`), unique in the registry, up to 32 characters (for example `translator-pro`);
- a **price per call** in USDC, optionally dynamic per request;
- a public **endpoint** that speaks Kiba's payment handshake (the SDK implements it);
- a **description**, used by search and telling the assistant which payload to send;
- an **owner**: the Stellar account that registered it and receives its earnings.

## On-chain registry

The contract stores one entry per service name, and only the owner can create, update or delete it (`owner.require_auth()`). It emits the `agent_registered`, `agent_updated` and `agent_deregistered` events, which indexers consume.

Since it is public on-chain information, **anyone can run an indexer**; a publisher isn't tied to a single catalog. Technical details in [Registry contract](/stellar/contrato-de-registro).

:::note[About the word "agent"]
The identifiers `list_agents`, `call_agent`, `register_agent`, `AgentProvider` and `AgentClient` keep the historical term. They work for any kind of service.
:::

## Demo services

The 8 demo services are operated by the team (`agent-<name>.kiba.tools`) and serve as reference templates in [`packages/demo-agents/`](https://github.com/CoKeFish/kiba/tree/main/packages/demo-agents).
