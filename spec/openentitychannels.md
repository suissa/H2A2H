# OpenEntityChannels

Status: Normative draft for H2A2H v1.0.

OpenEntityChannels declares how an Entity can communicate without embedding transport selection inside domain Agents. H2A2H runtimes bind or forge transport clients/servers from declarations.

Every remote channel MAY use the baseline security profiles, but H2A2H deployments requiring the strongest profile SHOULD declare `h2a2h.security.xzt.v1`. XZT semantics are defined in `extreme-zero-trust-profiles.md`.

## Channel declaration

Each channel declaration MUST include:

- `channel_id` or stable profile reference;
- `transport`;
- `mode`: request/reply, pub/sub, stream, datagram, queue, log or compatible composite;
- endpoint/addressing metadata or an endpoint resolver reference;
- supported protocol/version range;
- security profile requirements;
- capabilities such as ordering, reliability, streaming, max payload, acknowledgement semantics, durability and replay.

## Initial transport and project profiles

H2A2H reference implementations SHOULD be adapter-capable for:

- `in-memory` — same-runtime low-latency messaging;
- `http`/`https` — request/reply and web callbacks;
- `websocket` — bidirectional streaming sessions;
- `sse` — server-to-client event streams;
- `grpc` — typed RPC/streaming;
- `quic` — low-latency multiplexed transport profile;
- `nats` / `jetstream` — request/reply, pub/sub and durable streams;
- `kafka` — partitioned durable event log;
- `redpanda` — Kafka-compatible durable event log;
- `rabbitmq` / AMQP — exchange/queue/routing-key messaging;
- `bullmq` — Redis-backed queue/job transport;
- `redis-streams` — stream/consumer-group messaging;
- `mqtt` — topic-oriented pub/sub where allowed by policy;
- `mcp` — MCP bridge/profile where semantics match;
- `a2a` — Agent2Agent protocol binding/bridge;
- `ap2` — Agent Payments Protocol commerce/payment extension where applicable.

Support for a technology does not imply that every Intent can use it. Technology names identify adapters; canonical H2A2H semantics remain independent of the technology.

## Canonical event identity

The event name visible to the H2A2H runtime MUST remain canonical across every adapter.

For example, a canonical event such as `Financial.SellMachine.SaleIdentified` MUST be observed by domain code under that exact semantic identity whether transported through NATS, QUIC, Kafka, Redpanda, RabbitMQ, BullMQ or another adapter.

An adapter MAY transform that identifier internally into a subject, topic, stream, routing key or queue name only through a reversible mapping. Transport-specific names MUST NOT leak back as replacement semantic event names.

## Selection

The runtime computes a compatible binding from:

`Intent requirements ∩ sender channels ∩ receiver channels ∩ security policy ∩ runtime constraints`.

If multiple candidates remain, runtime policy MAY prioritize by latency, reliability, locality, cost, privacy, durability, replay capability or explicit priority metadata.

Domain Agents MUST NOT perform this selection themselves.

## Fallback

Fallback is allowed only when the Intent/channel declaration permits it. Fallback MUST NOT:

- widen delegated authority;
- weaken a required security profile;
- violate ordering/reliability/durability requirements;
- silently downgrade semantic acknowledgement requirements;
- bypass replay, idempotency or proof requirements;
- replace an XZT-required channel with a non-XZT channel.

## Universal Adapter contract

Reference adapters expose the following transport-neutral operations:

- `open(config)`;
- `close()`;
- `publish(envelope)`;
- `request(envelope)` when request/reply is supported;
- `subscribe(canonical_event, handler)` when subscription is supported;
- `ack(delivery)`;
- `nack(delivery, reason)`;
- `health()`;
- `capabilities()`;
- `mapCanonicalToTransport(canonical_event)`;
- `mapTransportToCanonical(transport_name)`.

An adapter MAY expose transport-specific diagnostics, but domain behavior MUST remain usable through the common contract.

Unsupported transport guarantees MUST be reported as capability mismatches rather than silently emulated with weaker semantics.

## Version negotiation

Each declaration MUST expose a supported H2A2H version/range and channel profile version. A binding succeeds only when peers share compatible protocol and channel versions.

Version failure MUST produce a deterministic negotiation result rather than an opaque transport error.

## Addressing

Addressing MAY be direct (`url`, `subject`, `topic`, `queue`, `routing_key`, `host`, `service`) or indirect (`resolver_ref`). Addressing is runtime metadata and MUST NOT become part of semantic Entity identity.

## Security

Channel transport security and delegated authority are separate concerns. A mutually authenticated encrypted channel does not itself prove permission to execute an Intent.

When `security.profile: h2a2h.security.xzt.v1` is declared, the adapter MUST preserve the XZT requirements for identity, replay defense, proof-of-possession, algorithm-agile post-quantum policy, bounded delegation and LinearAutoDestroy. The exact crypto suite MUST be declared; generic claims such as `quantum: true` are insufficient.

## Example

```yaml
protocol: openentitychannels
version: 1.0.0
entity:
  entity_id: agent:commerce-a
channels:
  - channel_id: commerce-local
    transport: in-memory
    mode: request_reply
    versions: ["1.x"]
    security:
      profile: h2a2h.security.local-trusted.v1
    capabilities:
      ordered: true
      reliable: true
      streaming: false

  - channel_id: commerce-universal
    adapter: universal
    transport: nats
    mode: pub_sub
    endpoint:
      host: 127.0.0.1
      port: 4222
    versions: ["1.x"]
    security:
      profile: h2a2h.security.xzt.v1
      passwordless: webauthn
      key_establishment: hybrid-x25519-ml-kem
      proof_of_possession: dpop
      peer_authentication: mtls
      linear_auto_destroy: true
    mapping:
      strategy: reversible
      preserve_canonical_event: true
    capabilities:
      reliable: true
      streaming: true
```

The `transport` value above can be changed to another compatible configured adapter without changing the canonical event semantics or domain Agent code.

## UniversalServer and Forger requirements

A channel forger/binder or UniversalServer MUST:

1. validate declarations against the canonical Adapter Schema;
2. resolve compatible profile/version;
3. load the corresponding adapter factory;
4. bind addressing and security configuration;
5. expose the common Universal Adapter contract;
6. preserve canonical envelope and event identity;
7. perform reversible internal transport-name mapping;
8. reject configurations where the selected adapter cannot meet the Intent/channel guarantees;
9. fail deterministically when no compatible adapter/profile exists.

It MUST NOT require modifying an Agent's domain code when a compatible declared channel changes.

## Code generation

The normative Adapter Schema is JSON Schema 2020-12 serialized in YAML. Compilers MAY generate language-specific interfaces and configuration types. The H2A2H reference target set includes Zig 0.16, Rust, TypeScript and Go.

Generated bindings MUST represent the same semantic interface and MUST NOT introduce language-specific domain semantics.

## Invariants

1. Channel choice is declarative/runtime-bound, not domain-Agent logic.
2. Transport replacement MUST NOT change Intent semantics.
3. Canonical event names MUST remain identical outside the adapter boundary.
4. Transport-specific topic/subject/queue naming MUST be internal and reversibly mapped.
5. Security requirements MUST survive fallback.
6. Entity identity MUST remain independent of network address.
7. Adapter-specific data MUST not leak into the canonical H2A2H envelope except inside explicitly namespaced channel metadata.
8. XZT is an overlay profile and MUST NOT fork or rename the underlying A2A, AP2 or MCP wire protocol.