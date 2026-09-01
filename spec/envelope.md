# Canonical H2A2H Message Envelope

Status: Normative draft for H2A2H v1.0.

The H2A2H envelope is transport-neutral. HTTP headers, NATS subjects, gRPC metadata, QUIC stream identifiers, MCP calls, and other transport details MAY carry or map envelope fields, but MUST NOT redefine their semantics.

## Required fields

```yaml
protocol: h2a2h
version: 1.0.0
message_id: msg:...
interaction_id: interaction:...
correlation_id: corr:...
causation_id: msg:previous-or-null
kind: request|response|event|acknowledgement|escalation|proof
intent:
  canonical_label: Commerce.PurchaseProducts
  version: 1.0.0
sender: { entity_id: "...", kind: Agent }
receiver: { entity_id: "...", kind: Agent }
timestamp: "..."
payload:
  schema: "schema://..."
  value: {}
```

Every envelope MUST identify protocol/version, message identity, interaction/correlation, message kind, sender, receiver, timestamp, Intent reference, and payload semantics.

## `message_id`

Uniquely identifies one protocol message. A retry of the same logical idempotent message SHOULD retain the same idempotency identity while transport delivery attempts MAY have separate transport diagnostics.

## `interaction_id`

Identifies the H2A2H lifecycle instance. It is stable from creation through closure.

## `correlation_id`

Groups causally related messages. A child/fork interaction MAY have a distinct `interaction_id` while retaining a parent correlation reference.

## `causation_id`

References the message/event that directly caused this message. Initial messages MAY use null/absence.

## `idempotency_key`

Required when the Intent declares idempotency as required or derived. Processing the same key within its declared scope MUST NOT create duplicate unintended effects.

## Message kinds

- `request`: asks a participant to perform/continue an Intent;
- `response`: returns the immediate result of a request, not necessarily lifecycle completion;
- `event`: records/announces a semantic occurrence;
- `acknowledgement`: acknowledges a protocol condition or Human receipt where profile rules allow;
- `escalation`: requests Human or policy intervention;
- `proof`: carries or references proof material.

## Sender/receiver

Sender and receiver use Entity/participant references. Network addresses MUST NOT replace Entity identity.

## Delegation

When delegated authority is required, the envelope MUST contain a `delegation` reference or enough verifiable material to resolve the effective delegation chain.

```yaml
delegation:
  delegation_id: delegation:...
  chain_digest: "..."
```

## Responsibility chain

The envelope MUST either carry the active responsibility chain/reference or provide a verifiable immutable reference to it.

## Payload

Payload semantics are declared by schema/reference. Payload MAY be inline or referenced.

```yaml
payload:
  schema: schema://commerce/purchase-products/input/1
  media_type: application/json
  value: {...}
```

Large/binary payloads SHOULD use a content reference plus digest rather than forcing transport-independent envelope implementations to embed bytes.

## Proof references

Proofs MAY be inline when small or referenced:

```yaml
proofs:
  - type: delegation
    ref: proof:...
  - type: human_return
    ref: pohr:...
```

## Time

`timestamp` is required. `expires_at` MAY bound message validity. Expired messages MUST NOT produce new effects unless a protocol profile explicitly defines safe late processing.

## Trace context

Transport-neutral tracing metadata MAY include `trace_id`, `span_id`, and vendor-neutral baggage references. Trace metadata MUST NOT grant authority.

## Channel metadata

Channel metadata MUST be namespaced and non-semantic:

```yaml
channel:
  profile: h2a2h.channel.nats.v1
  metadata:
    h2a2h.nats.subject: h2a2h.commerce.agent-b
```

A receiver MUST be able to validate the semantic envelope after removing channel-specific metadata.

## Extensions

Optional extension fields MUST be namespaced. Unknown optional extensions MAY be ignored when the versioning policy declares them non-critical. Critical unknown extensions MUST cause deterministic negotiation/validation failure.

## Deterministic serialization

When envelopes are signed/hashed, the selected security profile MUST define canonical serialization. Implementations MUST NOT depend on object insertion order or transport-specific formatting.

## Invariants

1. Envelope semantics remain identical across transports.
2. Sender/receiver identity is not a network address.
3. Correlation and causation survive handoffs.
4. Required delegation and responsibility references survive handoffs.
5. Unknown optional extensions do not mutate core semantics.
6. Trace metadata does not imply authority.
7. Response receipt does not imply lifecycle closure.
8. Idempotency is enforced according to the Intent declaration.
