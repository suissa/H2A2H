# Audit, Provenance, and Causal Trace Model

Status: Normative draft for H2A2H v1.0.

A completed, rejected, failed, or externally effected H2A2H interaction MUST be reconstructible from protocol/audit records without requiring inspection of private Agent internals or model chain-of-thought.

## Mandatory provenance

Audit records MUST be able to represent:

- interaction/correlation identities;
- protocol `causation_id` when one message directly caused another;
- semantic `causal_events[]` when multiple events/Intents contributed to a decision;
- `root_intent_id` and current Intent canonical label/version;
- lifecycle transitions;
- participant and responsibility-boundary changes;
- Capability/delegation validation/reference and changes;
- selected channel/security profile;
- receiver-local acceptance decisions;
- VAAL ActionCommitment/ActionMandate/ActionReceipt references for consequential effects;
- proof creation/validation;
- Human escalation/correction/approval points;
- final Human return/acknowledgement when required;
- terminal status;
- timestamps and durations where measurable.

## Append-only model

Normative audit history is append-only. Corrections MUST append a correcting record that references the prior record; they MUST NOT erase the historical event.

Implementations SHOULD support digest chaining or another tamper-evident mechanism. Each record MAY bind to the digest of its predecessor.

## Audit record

A canonical record contains or references:

- `audit_id`;
- `event_id` when the record represents a semantic event;
- `interaction_id`;
- `correlation_id`;
- optional protocol `causation_id`;
- optional `root_intent_id`;
- `causal_events[]` when applicable;
- semantic event label;
- timestamp;
- participant/actor reference when relevant;
- Intent reference;
- lifecycle state/transition when relevant;
- Capability/delegation/proof/channel references;
- receiver-local decision and policy hash when relevant;
- redacted semantic data/reference;
- `previous_digest` and `digest` for chained profiles.

## Protocol causation versus semantic causality

`causation_id` and `causal_events` serve different purposes:

```text
causation_id   -> the direct protocol message/event that triggered this message
causal_events  -> the semantic events/Intents materially used in this decision/effect
```

A message may have one direct `causation_id` while a decision has several `causal_events`.

Example:

```text
request message M1
   -> response message M2       (M2.causation_id = M1)

inventory.intent ----\
financial.intent -----+-> optimization.intent  (three causal_events)
marketing.intent ----/
```

## Causal graph verification

For policy-defined accountable effects, verification SHOULD reconstruct a valid causal path from a recognized Intent to the effect.

If no valid path can be reconstructed, the effect MUST be classifiable as `UnaccountedEffect` under profiles that require causal accounting.

A valid high-assurance path may require evidence of:

- authenticated identity;
- valid Capability/delegation;
- proof-of-possession;
- receiver-local acceptance;
- exact Action authorization;
- concrete ActionReceipt;
- required Human acceptance/return boundaries.

## Cross-transport tracing

Transport-specific trace identifiers MAY be mapped into `trace` metadata, but H2A2H correlation and semantic causal references MUST survive transport changes.

A NATS -> gRPC -> QUIC -> HTTP interaction remains one correlated interaction when the lifecycle says so.

## Redaction

Sensitive values MAY be redacted while preserving:

- field presence when needed for semantics;
- stable content digest when policy allows;
- schema/reference;
- provenance of which participant produced/consumed the data;
- Intent identity;
- causal-event references;
- reason/policy for redaction.

Redaction MUST NOT falsify the semantic event that occurred.

## Export

A conforming implementation SHOULD export an interaction audit bundle containing ordered audit records plus the causal-event graph and referenced proof metadata.

External verification SHOULD be possible without Agent memory/state.

## Verification

Verification of a tamper-evident audit bundle MUST detect, where applicable:

- removed/reordered digest-chained records;
- altered digested record content;
- broken predecessor links;
- unknown/missing referenced `causal_events`;
- interaction/correlation mismatch;
- Intent mismatch;
- invalid Capability/delegation/proof;
- invalid ActionReceipt;
- false `accounted_success` claims for effects without the required provenance.

## Privacy

Audit does not mean unlimited logging. Implementations SHOULD minimize sensitive payload retention and prefer digests/references where full content is not required.

Access to Human identity mapping MAY be separated from general audit access.

Private chain-of-thought MUST NOT be required to validate H2A2H accountability.

## Invariants

1. Boundary crossings and lifecycle transitions are auditable.
2. Historical failures, rejections, challenges, or escalations cannot be erased by later success.
3. Correlation survives transport changes.
4. `causal_events` preserves semantic multi-causality when relevant.
5. Redaction preserves event truth/provenance.
6. A completed interaction can be reconstructed without Agent internals.
7. Tamper-evident profiles detect mutation/reordering/removal.
8. An accountable effect has a valid causal provenance path or is explicitly `UnaccountedEffect`.
