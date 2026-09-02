# H2A2H eXtreme Zero Trust Profiles

Status: Normative draft.

## 1. Purpose

H2A2H adopts existing interoperability and commerce protocols without forking their wire semantics. Instead, H2A2H defines an **eXtreme Zero Trust (XZT) security profile overlay** that can be bound to any declared communication channel.

The profile names are:

- `A2A-XZT` — Agent2Agent with H2A2H eXtreme Zero Trust requirements;
- `AP2-XZT` — Agent Payments Protocol with H2A2H authority, proof and payment controls;
- `B2A-XZT` — Business-to-Agent commerce profile governed by H2A2H responsibility/delegation;
- `PROCUREMENT-XZT` — agentic procurement profile for sourcing, quotation, negotiation, approval, purchase and settlement;
- `MCP-XZT` — Model Context Protocol using the H2A2H eXtreme Zero Trust security profile.

`MCP-XZT` is a profile of MCP, not a fork of MCP. Implementations MUST remain wire-compatible with the negotiated MCP specification and MUST NOT rename standard MCP methods, headers or message semantics.

## 2. Security composition

Every remote XZT channel MUST compose independent controls for:

1. semantic Entity identity;
2. Human-bound or Organization-bound authority;
3. passwordless authentication where a Human participates;
4. post-quantum-capable key establishment policy;
5. transport confidentiality and peer authentication;
6. sender-bound proof of possession;
7. message-level integrity and replay resistance;
8. least-authority delegation;
9. one-effect / one-consumption linear semantics where declared;
10. deterministic evidence and audit;
11. LinearAutoDestroy for ephemeral sensitive material.

Authentication MUST NOT be interpreted as delegation. Transport encryption MUST NOT be interpreted as payment authorization. A valid protocol message MUST NOT be interpreted as Human approval unless the effective delegation explicitly allows the effect.

## 3. Quantum-safe policy

H2A2H uses the term `quantum_safe` as an algorithm-agile policy target. Implementations MUST declare the actual cryptographic suite rather than claim generic quantum security.

A reference profile SHOULD support hybrid key establishment combining a classical mechanism with a NIST post-quantum KEM such as ML-KEM. Long-lived signatures, certificates and credentials MUST be replaceable through configuration and algorithm negotiation.

No implementation may claim post-quantum protection merely because QUIC, TLS, mTLS or DPoP is enabled.

## 4. Passwordless Human authority

For Human-bound authority, an XZT profile SHOULD support WebAuthn/passkeys or an equivalent phishing-resistant passwordless authenticator.

Human authorization evidence MUST bind at least:

- Human identity reference;
- Intent reference and version;
- delegation scope;
- monetary/resource limits when applicable;
- validity window;
- challenge/nonce;
- interaction/correlation identity.

A session derived from a Human authorization MUST NOT silently widen or renew the underlying delegation.

## 5. LinearAutoDestroy

`LinearAutoDestroy` is the H2A2H lifecycle rule for ephemeral secrets, capability tokens and one-shot sensitive payload material.

When a value is declared `linear: true`, the runtime MUST ensure that:

- ownership is explicit;
- the value has at most one effective consuming path unless a schema explicitly declares fan-out-safe derivation;
- copies are prohibited or represented as cryptographically independent derivations;
- consumption, expiration, cancellation or terminal failure transitions the value to an unusable state;
- destruction is auditable without recording the secret itself.

Examples include ephemeral private keys, one-time capability tokens, payment authorization handles and decrypted high-sensitivity payload buffers.

## 6. Canonical envelope before adapters

All H2A2H messages MUST exist first in a transport-neutral canonical envelope. A broker/protocol adapter transforms only the transport representation.

The canonical event name, Intent, Entity references, correlation identifiers, authority and proof references MUST be identical regardless of whether the selected adapter is NATS, QUIC, Kafka, RabbitMQ, Redpanda, BullMQ, HTTP, gRPC, A2A, MCP or another declared technology.

An adapter MUST NOT mutate the semantic event name to match a broker naming convention. Instead it MUST maintain an internal reversible mapping between canonical H2A2H names and transport-specific topics/subjects/routing keys/streams/queues.

## 7. Universal Adapter contract

Every channel adapter MUST expose the following semantic operations independent of language or transport:

- `open(config)`;
- `close()`;
- `publish(envelope)`;
- `subscribe(canonical_event, handler)`;
- `ack(delivery)`;
- `nack(delivery, reason)`;
- `health()`;
- `capabilities()`;
- `mapCanonicalToTransport(canonical_event)`;
- `mapTransportToCanonical(transport_name)`.

Optional capabilities MAY include request/reply, transactions, consumer groups, durable subscriptions, ordering keys, dead-letter queues and stream replay.

Unsupported capabilities MUST be declared explicitly and MUST NOT be silently emulated with weaker semantics.

## 8. Adapter configuration as code

Transport selection MUST be declarative. Domain Agents and Intents MUST NOT contain broker-specific client code.

A UniversalServer reads `config.yml`, validates it against the canonical adapter JSON Schema represented in YAML, loads the configured adapter, and exposes the same H2A2H canonical envelope to the runtime.

Changing NATS to Kafka, QUIC, RabbitMQ, Redpanda or BullMQ MUST require configuration and deployment changes only, unless the new transport cannot satisfy the semantic requirements declared by the Intent/channel profile.

## 9. A2A-XZT

A2A-XZT preserves Agent Card discovery, A2A tasks/messages/artifacts and negotiated protocol bindings while adding H2A2H responsibility, delegation, proof and security requirements.

A2A capability discovery MUST NOT widen authority. A2A task completion MUST NOT be interpreted as Human return or Human approval.

## 10. AP2-XZT

AP2-XZT composes AP2 checkout/payment mandates and receipts with H2A2H OpenDelegation and Human responsibility.

Before a payment effect, the runtime MUST verify:

- AP2 mandate validity;
- effective H2A2H delegation;
- spend/resource/vendor constraints;
- freshness and replay protection;
- required Human approval policy;
- payment proof binding to the exact commercial Intent.

Payment credentials and decrypted payment material SHOULD use LinearAutoDestroy when their lifecycle permits it.

## 11. B2A-XZT and PROCUREMENT-XZT

B2A is treated as a commerce interaction profile rather than a single universal wire protocol. `B2A-XZT` defines the responsibility boundary where a Business exposes machine-consumable commercial capability to an Agent acting under bounded authority.

`PROCUREMENT-XZT` defines a protocol-neutral procurement lifecycle:

`REQUESTED -> POLICY_VALIDATED -> SOURCING -> QUOTED -> EVALUATED -> NEGOTIATED? -> APPROVAL_REQUIRED? -> APPROVED -> ORDERED -> PAYMENT_AUTHORIZED -> SETTLED -> DELIVERED -> ACCEPTED -> CLOSED`

Each state transition MUST carry causal provenance. Procurement policies MAY constrain supplier allowlists, budgets, categories, jurisdictions, delivery windows, contract terms and required Human approval thresholds.

Procurement execution MAY use A2A, MCP, HTTP APIs, EDI, AP2 or another channel, provided the selected adapter preserves required semantics.

## 12. MCP-XZT

MCP-XZT is a security/governance overlay for MCP clients and servers. It MUST preserve MCP protocol-version negotiation and standard method semantics.

For remote MCP, H2A2H policy MAY require stronger controls than baseline MCP authorization, including mTLS, proof-of-possession, hybrid post-quantum key establishment, OpenDelegation validation and LinearAutoDestroy for ephemeral credentials.

MCP tool discovery proves capability visibility only. Tool availability MUST NOT grant delegated authority to invoke effects.

## 13. Adapter code generation

The canonical adapter interface is defined using JSON Schema 2020-12 serialized as YAML. H2A2H/UbiQUIC compilers generate language bindings for at least:

- Zig 0.16;
- Rust;
- TypeScript;
- Go.

Generated code is Everything as Code: transport identity, endpoints, ports, security profile, delivery guarantees, topic/subject mapping, retry/DLQ rules and capabilities are data declared in configuration rather than hard-coded domain behavior.

## 14. Conformance

An XZT-conformant adapter MUST pass the same transport-neutral conformance vectors for canonical event identity, correlation, ordering declaration, idempotency, replay defense, authorization rejection and mapping reversibility.

Two adapters are semantically substitutable only if both satisfy every channel requirement declared by the Intent and OpenEntityChannels profile.