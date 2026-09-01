# Audit, Provenance, and Trace Model

Status: Normative draft for H2A2H v1.0.

A completed or failed H2A2H interaction MUST be reconstructible from protocol/audit records without requiring inspection of private Agent internals.

## Mandatory provenance

Audit records MUST be able to represent:

- interaction/correlation/causation identities;
- lifecycle transitions;
- participant and responsibility-boundary changes;
- Intent canonical label/version;
- delegation validation/reference and changes;
- selected channel profile;
- proof creation/validation;
- Human escalation/correction points;
- final Human return/acknowledgement;
- terminal status;
- timestamps and durations where measurable.

## Append-only model

Normative audit history is append-only. Corrections MUST append a correcting record that references the prior record; they MUST NOT erase the historical event.

Implementations SHOULD support digest chaining or another tamper-evident mechanism. Each record MAY bind to the digest of its predecessor.

## Audit record

A canonical record contains:

- `audit_id`;
- `interaction_id`;
- `correlation_id`;
- optional `causation_id`;
- `event` semantic label;
- `timestamp`;
- participant/actor reference when relevant;
- Intent reference;
- lifecycle state/transition when relevant;
- delegation/proof/channel references;
- redacted semantic data/reference;
- `previous_digest` and `digest` for chained profiles.

## Cross-transport tracing

Transport-specific trace identifiers MAY be mapped into `trace` metadata, but H2A2H correlation MUST survive transport changes. A NATS→gRPC→WebSocket interaction remains one correlated interaction when the lifecycle says so.

## Redaction

Sensitive values MAY be redacted while preserving:

- field presence when needed for semantics;
- stable content digest when policy allows;
- schema/reference;
- provenance of which participant produced/consumed the data;
- reason/policy for redaction.

Redaction MUST NOT falsify the semantic event that occurred.

## Export

A conforming implementation SHOULD export an interaction audit bundle in a machine-readable format containing ordered records and referenced proof metadata. External verification SHOULD be possible without Agent memory/state.

## Verification

Verification of a chained audit bundle MUST detect:

- removed/reordered records;
- altered digested record content;
- broken predecessor links;
- interaction/correlation mismatch;
- invalid referenced proof where proof material is available.

## Privacy

Audit does not mean unlimited logging. Implementations SHOULD minimize sensitive payload retention and prefer digests/references where full content is not required. Access to Human identity mapping MAY be separated from general audit access.

## Invariants

1. Boundary crossings and lifecycle transitions are auditable.
2. Historical failures/escalations cannot be erased by later success.
3. Correlation survives transport changes.
4. Redaction preserves event truth/provenance.
5. A completed interaction can be reconstructed without Agent internals.
6. Tamper-evident profiles detect mutation/reordering/removal.
