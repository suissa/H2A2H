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
kind: request|response|event|acknowledgement|escalation|proof|intent_proposal|intent_decision
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

Groups causally related protocol activity. A child/fork interaction MAY have a distinct `interaction_id` while retaining a parent correlation reference.

## `causation_id`

References the single protocol message/event that directly caused this protocol message when such a direct relationship exists. Initial messages MAY use null/absence.

`causation_id` is intentionally not the complete semantic causal graph.

## `causal_events[]`

When a semantic decision/effect depends on one or more prior events/Intents, an envelope MAY carry or reference `causal_events[]`:

```yaml
causal_events:
  - event_id: event:inventory:01J...
    intent:
      intent_id: intent:inventory:01J...
      canonical_label: Inventory.AssessAvailability
      version: 1.0.0
    relation: evidence
  - event_id: event:financial:01J...
    intent:
      canonical_label: Financials.AssessCashFlow
      version: 1.0.0
    relation: evidence
```

The semantic shorthand MAY be presented as:

```text
causal_events = [inventory.intent, financial.intent, marketing.intent]
```

Persisted audit evidence SHOULD retain the concrete `event_id` plus Intent semantics.

The distinction is:

```text
causation_id  -> direct protocol-message causation
causal_events -> semantic multi-event/Intent causality
```

## `idempotency_key`

Required when the Intent declares idempotency as required or derived. Processing the same key within its declared scope MUST NOT create duplicate unintended effects.

## Message kinds

- `request`: asks a participant to consider/continue an Intent under the applicable profile;
- `response`: returns the immediate result of a request, not necessarily lifecycle completion;
- `event`: records/announces a semantic occurrence;
- `intent_proposal`: external/autonomous participant proposes an Intent for receiver-local evaluation;
- `intent_decision`: receiver records `ACCEPT|REJECT|DEFER|PARTIAL|CHALLENGE`;
- `acknowledgement`: acknowledges a protocol condition or Human receipt where profile rules allow;
- `escalation`: requests Human or policy intervention;
- `proof`: carries or references proof material.

No message kind grants undeclared command authority over an autonomous receiver.

## Sender/receiver

Sender and receiver use Entity/participant references. Network addresses MUST NOT replace Entity identity.

## Capability / Delegation

When delegated/bounded authority is required, the envelope MUST contain a Capability/OpenDelegation reference or enough verifiable material to resolve the effective authority chain.

```yaml
capability:
  capability_id: capability:...
  digest: sha256:...

delegation:
  delegation_id: delegation:...
  chain_digest: sha256:...
```

Capability/delegation ancestry MUST NOT be inferred from `causal_events`.

## Responsibility

The envelope MUST either carry the active `ResponsibilityEnvelope`, a responsibility graph reference, or a verifiable immutable reference sufficient for the selected governance profile.

A legacy linear `responsibility_chain` MAY be used only as a projection when it does not misrepresent concurrent causality.

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
  - type: capability
    ref: proof:...
  - type: action_authorization
    ref: mandate:...
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
3. Correlation survives handoffs.
4. `causation_id` and `causal_events` have distinct semantics.
5. Required Capability/delegation/responsibility references survive handoffs.
6. Unknown optional extensions do not mutate core semantics.
7. Trace metadata does not imply authority.
8. Transport response receipt does not imply autonomous acceptance or lifecycle closure.
9. Idempotency is enforced according to the Intent declaration.
10. Event/Intent delivery does not imply command authority.
