---
title: Services and the registry
description: Every Kiba service is registered on-chain in a Soroban contract. Discovery indexes that registry and searches it in any language.
sidebar:
  order: 1
---

## What a service is

A service is anything that answers an HTTP request for a price: an AI agent, a REST API, an indexer, a scraper, a calculator. On Kiba every service is published by an **external publisher**. There are no first-party services, only templates you can copy.

Each service has:

- a **name** (`service`), unique across the registry, up to 32 characters, for example `translator-pro`;
- a **price per call** in USDC, optionally dynamic per request;
- a public **endpoint** that speaks the Kiba payment handshake (the SDK does this for you);
- a **description** that search uses and that tells assistants what payload to send;
- an **owner**, the Stellar account that registered it and receives its earnings.

## The on-chain registry

Registration lives in a Soroban smart contract on Stellar. The contract stores one entry per service name, and only the owner can create, update, or delete their own entry. It emits events (`agent_registered`, `agent_updated`, `agent_deregistered`) that indexers consume. See [Registry contract](/stellar/registry-contract/).

Because the registry is public on-chain data, **anyone can run an indexer**. A publisher is not locked into a single catalog.

## Discovery

Kiba's discovery backend mirrors the registry and answers searches with a hybrid scorer:

- **Keyword**: full-text search with BM25 ranking.
- **Semantic**: 384-dimension sentence embeddings computed in-process, so a query in Spanish finds a service described in English.
- **Hybrid**: weighted fusion of both (0.6 keyword, 0.4 semantic).

Assistants reach discovery through the `list_agents` tool; applications through `GET /v1/agents?q=…` on the gateway. A service appears in results as soon as its registration event is indexed. There is no approval step.

:::note[About the word "agent"]
Identifiers such as `list_agents`, `call_agent`, or the `AgentProvider` class keep the historical word *agent*. They work for every kind of service.
:::
