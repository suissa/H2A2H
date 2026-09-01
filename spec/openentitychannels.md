# OpenEntityChannels

Status: Normative draft for H2A2H v1.0.

OpenEntityChannels declares how an Entity can communicate without embedding transport selection inside domain Agents. H2A2H runtimes bind or forge transport clients/servers from declarations.

## Channel declaration

Each channel declaration MUST include:

- `channel_id` or stable profile reference;
- `transport`;
- `mode`: request/reply, pub/sub, stream, datagram, or compatible composite;
- endpoint/addressing metadata or an endpoint resolver reference;
- supported protocol/version range;
- security profile requirements;
- capabilities such as ordering, reliability, streaming, max payload, and acknowledgement semantics.

## Initial transport profiles

H2A2H v1.0 reference implementations SHOULD support:

- `in-memory` — same-runtime low-latency messaging;
- `http`/`https` — request/reply and web callbacks;
- `websocket` — bidirectional streaming sessions;
- `sse` — server-to-client event streams;
- `grpc` — typed RPC/streaming;
- `quic` — low-latency multiplexed transport profile;
- `nats` — request/reply and pub/sub messaging;
- `mcp` — tool/resource bridge where semantics match;
- `a2a` bridge profile where applicable.

Support for a transport does not imply that every Intent can use it.

## Selection

The runtime computes a compatible binding from:

`Intent requirements ∩ sender channels ∩ receiver channels ∩ security policy ∩ runtime constraints`.

If multiple candidates remain, runtime policy MAY prioritize by latency, reliability, locality, cost, privacy, or explicit priority metadata.

Domain Agents MUST NOT perform this selection themselves.

## Fallback

Fallback is allowed only when the Intent/channel declaration permits it. Fallback MUST NOT:

- widen delegated authority;
- weaken a required security profile;
- violate ordering/reliability requirements;
- silently downgrade semantic acknowledgement requirements.

## Common channel contract

Reference adapters expose the following transport-neutral operations:

- `bind(declaration)`;
- `send(envelope)`;
- `request(envelope)` when request/reply is supported;
- `subscribe(handler)` when events/streams are supported;
- `close()`;
- `capabilities()`.

An adapter MAY expose transport-specific diagnostics, but domain behavior MUST remain usable through the common contract.

## Version negotiation

Each declaration MUST expose a supported H2A2H version/range and channel profile version. A binding succeeds only when peers share compatible protocol and channel versions.

Version failure MUST produce a deterministic negotiation result rather than an opaque transport error.

## Addressing

Addressing MAY be direct (`url`, `subject`, `host`, `service`) or indirect (`resolver_ref`). Addressing is runtime metadata and MUST NOT become part of semantic Entity identity.

## Security

Channel transport security and delegated authority are separate concerns. A mutually authenticated encrypted channel does not itself prove permission to execute an Intent.

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
  - channel_id: commerce-nats
    transport: nats
    mode: request_reply
    endpoint:
      subject: h2a2h.commerce.agent-a
    versions: ["1.x"]
    security:
      profile: h2a2h.security.mtls-dpop.v1
    capabilities:
      ordered: false
      reliable: true
      streaming: true
```

## Forger requirements

A channel forger/binder MUST:

1. validate declarations;
2. resolve compatible profile/version;
3. load the corresponding adapter factory;
4. bind addressing and security configuration;
5. expose the common channel contract;
6. fail deterministically when no compatible adapter/profile exists.

It MUST NOT require modifying an Agent's domain code when a compatible declared channel changes.

## Invariants

1. Channel choice is declarative/runtime-bound, not domain-Agent logic.
2. Transport replacement MUST NOT change Intent semantics.
3. Security requirements MUST survive fallback.
4. Entity identity MUST remain independent of network address.
5. Adapter-specific data MUST not leak into the canonical H2A2H envelope except inside explicitly namespaced channel metadata.
