---
title: "Roadmap"
description: "What's already in main, what's next, what's conditional and what was ruled out."
---

# Roadmap

Status of each line. **Anything marked "evaluated" isn't implemented.**

## Already in `main`

- On-chain registry, hybrid discovery, gateway with OAuth and credits, remote MCP connector, `kiba-mcp`, Windows installer, dashboard with publisher panel, SDK, batch settlement.
- Non-custodial user wallets via Privy (when `PRIVY_APP_ID`/`PRIVY_APP_SECRET` are configured).

## Next

| Line | Details |
|---|---|
| **Kiba's own escrows** | Replace <TW /> Trustless Work for the x402 escrow and the 95/5 split. Decided in October 2026; design and implementation in progress. See [Trustless Work](/stellar/trustless-work). |
| **Mainnet** | Mainnet deployment with a **prior audit of the Soroban contract**. Automatic treasury refunding and a channel-account pool (concurrency) as pending technical items. |
| **Colombia fiat ramp** | COP → USDC top-up via PSE and USDC → COP withdrawal to a Bre-B key. Main candidate: **VANK** (SEP-10/24/6/12/38 anchor; sandbox `dev-stable-anchor.thisisvank.com`; production requires certification with 3 cases, an integration agreement and a `stellar.toml` with `SIGNING_KEY`). Backup: **Koywe** (PSE in, Bre-B/ACH out). PayU, Cobre, Mono and the Nequi API had also been considered. Challenge: custodial FX risk and regulatory exposure. |
| **Ecosystem development** | Publisher onboarding, catalog expansion by vertical and first paying users. |
| **OpenZeppelin Relayer + x402 facilitator** (evaluated) | Submits transactions and sponsors fees, so the agent doesn't need XLM. Replaces Launchtube (discontinued by the SDF). `@x402/stellar` package (x402 v2); testnet facilitator `channels.openzeppelin.com/x402/testnet`. If Kiba settles through its own escrow mechanism, maybe only the Relayer part is needed. |
| **Privy: validate Soroban signing** (evaluated) | Confirm that it signs Soroban *auth entries* on Stellar (needed for x402), that its policies apply to Stellar and that server-delegated signing doesn't reintroduce custody. |
| **Stellar 8004** (evaluated) | Identity, reputation and validation registries on Soroban (ERC-8004 style), on mainnet. Publish service attestations and keep Kiba's own signals (paid calls, refunds). SDK `@trionlabs/stellar8004`. |
| **OpenZeppelin Smart Account Kit** (evaluated, after validating Privy) | On-chain rules for agents (caps, session keys). The integration kit isn't audited. |
| **Market-based dynamic pricing** (proposal) | Price based on service usage (1 time vs. 10) and marketplace supply and demand. Not implemented. |
| **REAPP** (under evaluation, phase 2) | Mandate pattern to improve multi-agent orchestration. It's complementary: it operates at the mandate/authorization layer; Kiba is the marketplace layer on top. |

## Conditional

| Project | Condition |
|---|---|
| x402 bazaars (Rail402, AgentSmith, Rumble Fish, Vellar) | Wait for mainnet. Automatic catalog of payable services; services are listed when settling through their facilitator. Vellar is testnet and unaudited. |

## Ruled out for now

| Project | Reason |
|---|---|
| **Reflector** (on-chain prices) | Dynamic pricing depends on internal usage and demand, not external prices. |
| **Pollar** | Duplicates Privy. |
| **DeFindex / yield on balances** | Regulatory risk. |
| **MPP channels** | Kiba doesn't have the cost problem they solve. |

## Out of scope for this version

Third-party publishers and external users at scale, mainnet, formal audit, KYC/AML and SLA. See [Project status](/introduccion/estado-del-proyecto).
