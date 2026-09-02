# Agentic Protocol Landscape and H2A2H Composition

Status: Exploratory vNext research note. Non-normative.

This document maps the current agentic interoperability ecosystem into H2A2H and identifies where H2A2H should compose with existing standards instead of replacing them.

## Principle

H2A2H should not become a competing transport, tool protocol, UI protocol, commerce protocol, payment protocol, or domain data standard.

H2A2H is most valuable when it preserves semantic Intent, delegated authority, responsibility, provenance, security requirements, and Human return while an interaction crosses those protocols.

The protocol stack should therefore be treated as compositional:

| Layer | Existing protocol / standard | Primary responsibility | H2A2H relationship |
| --- | --- | --- | --- |
| Human-facing runtime | AG-UI | Bidirectional Agent <-> User application events, state, interruptions and interaction | Carry H2A2H correlation, authority, Human-in-the-Healing-Loop and PoHR state through user-facing runs |
| Generated UI | A2UI | Declarative Agent -> UI surfaces | Render H2A2H requests, approvals, evidence, status and Human-return surfaces without granting authority by rendering them |
| Agent interoperability | A2A | Agent discovery, Agent Cards, tasks, messages, artifacts and extensions | Bridge H2A2H Entities/Intents/delegations into A2A tasks while retaining the H2A2H responsibility lifecycle |
| Tools and data | MCP | Tools, resources, prompts and capability negotiation | Bind an H2A2H Intent to concrete tool/resource capabilities without treating tool availability as authority |
| Commerce capability layer | UCP | Commerce service discovery, capability negotiation, extensions, schemas and multiple transport bindings | Project UCP capabilities into H2A2H Intents and preserve delegation/PoHR around the commercial lifecycle |
| Agentic checkout | ACP | Buyer-Agent-Seller checkout, capability negotiation, payment handlers, order/checkout lifecycle and extensions | Use ACP as the concrete commerce execution profile when an Intent enters checkout/order execution |
| Payment authorization | AP2 and payment handlers | Payment mandates, credentialed payment authorization and payment-specific trust | Keep payment authority narrower than the enclosing H2A2H delegation; a payment mandate is not universal action authority |
| Legal context | LCP and domain legal standards | Discoverable terms, jurisdiction, dispute context and legal artifacts | Bind legal evidence/context to H2A2H provenance and responsibility, without treating legal context as delegation |
| Transport / messaging | HTTP, SSE, WebSocket, QUIC, NATS, Kafka, RabbitMQ, Redpanda, BullMQ and other OpenEntityChannels bindings | Delivery of protocol messages/events | Selected declaratively by OpenEntityChannels; protected by H2A2H eXtreme Zero Trust profiles |

## AG-UI versus A2UI

The names are similar but they solve different problems and H2A2H should support both.

- **AG-UI** is an Agent-User interaction protocol. It standardizes the event stream between an agentic backend and user-facing application.
- **A2UI** is an Agent-to-UI declarative rendering protocol. It lets an Agent describe or update a UI surface using a renderer-safe structured format.

In H2A2H terms:

- AG-UI is a communication/runtime projection of the Human boundary.
- A2UI is an artifact/presentation projection of the Human boundary.
- Neither protocol by itself proves delegated authority.
- Neither protocol by itself satisfies Proof-of-Human-Return.

A UI may display an approval control, but H2A2H must still prove which Human approved what, under which delegation and Intent, at which semantic/effect boundary.

## UCP as a reusable architectural pattern

UCP contains a particularly useful pattern that is more general than commerce even though its current specification is commerce-centered:

1. machine-readable discovery profile;
2. discrete versioned capabilities;
3. services that group operations/events for a domain;
4. extensions that augment base capabilities;
5. capability intersection / negotiation;
6. multiple transport bindings for the same semantic service;
7. schema references for machine validation;
8. namespace governance;
9. explicit version negotiation;
10. transport-independent semantics.

H2A2H should reuse this structural idea for domain capability profiles rather than invent bespoke integration logic for every new domain.

## ACP and UCP are complementary

ACP and UCP SHOULD NOT be modeled as synonyms.

A useful H2A2H composition is:

```text
Human Intent
  -> H2A2H / OpenIntent
  -> OpenDelegation authority
  -> UCP discovery + capability negotiation
  -> ACP checkout/order execution when applicable
  -> AP2/payment handler for payment-specific authorization
  -> A2A for remote Agent collaboration
  -> MCP for tool/data operations
  -> AG-UI for bidirectional Human interaction
  -> A2UI for declarative UI artifacts
  -> Proof-of-Human-Return
```

UCP is the broader commerce capability and interoperability layer. ACP is a concrete transaction/checkout execution model. H2A2H remains the enclosing responsibility and Human-return lifecycle.

## H2A2H mapping rules for UCP

A UCP capability MAY be projected into an OpenIntent capability binding.

Recommended semantic mapping:

- UCP service -> H2A2H domain/profile reference;
- UCP capability -> OpenIntent canonical capability/Intent reference;
- UCP extension -> namespaced OpenIntent/H2A2H extension;
- UCP business/platform profile -> H2A2H Entity capability advertisement;
- UCP capability negotiation -> H2A2H compatibility negotiation;
- UCP REST/MCP/A2A binding -> OpenEntityChannels transport/protocol binding;
- UCP checkout/order identity -> H2A2H correlation/causation-linked domain object;
- UCP buyer consent -> evidence associated with H2A2H delegation or an Intent-specific consent requirement;
- UCP/AP2 payment mandate -> payment-scoped authority evidence, never global delegation.

A bridge MUST NOT infer that support for `checkout`, `order`, `fulfillment`, `discount`, `payment`, or another UCP capability authorizes the Agent to invoke it.

## H2A2H mapping rules for ACP

ACP SHOULD be treated as a domain execution adapter, not as the source of H2A2H authority.

- ACP checkout session -> correlated H2A2H domain execution/session;
- ACP capability intersection -> compatible execution feature set;
- ACP intervention requirement -> H2A2H Human intervention / UI requirement when Human participation is required;
- ACP payment handler -> payment-specific capability binding;
- ACP extension -> namespaced bridge extension;
- ACP order lifecycle -> H2A2H domain events linked by causation;
- ACP completion -> commercial lifecycle completion only, not automatic Proof-of-Human-Return.

## eXtreme Zero Trust requirement

All bridge profiles remain subject to the configured H2A2H eXtreme Zero Trust profile.

The selected external protocol does not weaken the following H2A2H requirements:

- explicit Entity identity;
- explicit Intent identity;
- non-widening delegation;
- correlation and causation preservation;
- replay/idempotency protection;
- ephemeral or scoped credentials where configured;
- channel-specific authentication and encryption;
- audit/provenance continuity;
- proof preservation;
- Human-return semantics.

Transport and protocol support are capabilities, not trust.

## Why the next standards work should move beyond commerce

The current ecosystem has strong foundational protocols for Agent <-> Tool, Agent <-> Agent, Agent <-> User, generated UI, commerce and payments. The gap is increasingly the semantic action layer for ordinary non-commerce Web work.

The next H2A2H contribution should therefore focus on reusable action capability profiles that can be composed into domains such as communication, scheduling, government, education, healthcare, research, legal workflows and case management.

See `domain-capability-profiles.md`.

## References

- Agentic Commerce Protocol (ACP): https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- Universal Commerce Protocol (UCP): https://ucp.dev/
- Agent2Agent Protocol (A2A): https://a2a-protocol.org/
- Model Context Protocol (MCP): https://modelcontextprotocol.io/
- AG-UI: https://docs.ag-ui.com/
- A2UI: https://github.com/google/A2UI
- Agentic Booking: https://agenticbooking.org/
- Legal Context Protocol: https://github.com/legal-context-protocol/legal-context-protocol
- W3C AI Agent Protocol Community Group: https://www.w3.org/community/agentprotocol/
