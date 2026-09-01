# Proof-of-Human-Return (PoHR)

Status: Normative draft for H2A2H v1.0.

Proof-of-Human-Return is the verifiable artifact that distinguishes H2A2H completion from ordinary machine-to-machine delivery. It proves, under a selected proof profile, that a result reached the intended Human endpoint or an explicitly authorized Human representative.

## Distinct return states

H2A2H MUST distinguish:

1. `transport_delivered` — bytes/message reached transport infrastructure;
2. `machine_received` — an Agent/Service/Device accepted the message;
3. `human_presented` — the result was presented through a Human-facing channel;
4. `human_acknowledged` — the Human explicitly acknowledged receipt when required.

A protocol profile MUST state which state is sufficient for PoHR validity. It MUST NOT label `transport_delivered` alone as proof of human return.

## PoHR artifact

A PoHR artifact MUST include:

- `protocol: h2a2h.pohr`;
- `version`;
- `proof_id`;
- `interaction_id`;
- `target_human` or privacy-preserving target reference;
- `result_digest` or verifiable immutable result reference;
- `return_state`;
- `channel`;
- `presented_at` when presentation is claimed;
- `acknowledged_at` when acknowledgement is claimed;
- `proof_profile`;
- `evidence` or an evidence reference;
- issuer/verifier identity as required by the proof profile.

## Target Human

The target MUST resolve to the Human declared by the Intent or to an explicitly authorized representative. A representative claim MUST reference the authority by which that representative may receive the result.

## Result binding

PoHR MUST cryptographically or deterministically bind to the exact result using a digest or immutable content reference. Reusing a proof for a materially different result MUST fail validation.

## Proof profiles

H2A2H defines profile classes rather than one mandatory cryptographic stack.

### `h2a2h.pohr.presentation.v1`

Proves that the result was presented through an authenticated Human-facing session/channel. Suitable when explicit acknowledgement is not required.

### `h2a2h.pohr.acknowledgement.v1`

Requires an explicit Human acknowledgement bound to the result digest and interaction.

### `h2a2h.pohr.representative.v1`

Allows an authorized Human representative. The evidence MUST include the representative authority reference.

### `h2a2h.pohr.privacy-preserving.v1`

Allows pseudonymous/zero-disclosure target references provided independent validation can prove that the intended recipient condition was met without exposing unnecessary identity data.

## Validation

A conforming validator MUST verify:

1. artifact version/shape;
2. interaction correlation;
3. target Human/representative authorization;
4. result digest/reference binding;
5. claimed return state;
6. channel/session evidence;
7. timestamps and expiry where applicable;
8. proof profile-specific signature/assertion evidence;
9. issuer/verifier trust under the selected security profile.

## Failure/non-delivery

A failed return MUST remain auditable. Non-success states include:

- `pohr.target_unresolved`
- `pohr.delivery_failed`
- `pohr.presentation_unproven`
- `pohr.acknowledgement_timeout`
- `pohr.invalid_evidence`
- `pohr.result_mismatch`
- `pohr.representative_unauthorized`

A timeout MUST NOT be converted into successful PoHR merely because transport delivery succeeded.

## Example

```yaml
protocol: h2a2h.pohr
version: 1.0.0
proof_id: pohr:01J...
interaction_id: interaction:01J...
target_human:
  entity_id: human:bob
result_digest:
  algorithm: sha-256
  value: "..."
return_state: human_acknowledged
channel:
  profile: h2a2h.channel.websocket.v1
  endpoint_ref: human-session:bob:42
presented_at: 2026-09-01T17:42:00-03:00
acknowledged_at: 2026-09-01T17:42:03-03:00
proof_profile: h2a2h.pohr.acknowledgement.v1
evidence:
  profile: h2a2h.proof.signed.v1
  value: "..."
```

## Privacy

PoHR evidence SHOULD disclose the minimum data required to validate return. Audit systems MAY store identity references separately from proof material when access-control/privacy policy requires separation.

## Invariants

1. PoHR MUST bind interaction, target condition, and result.
2. Machine receipt MUST NOT be conflated with Human presentation.
3. Human presentation MUST NOT be conflated with explicit acknowledgement.
4. Representative receipt MUST prove representative authority.
5. Failed return remains correlated and auditable.
6. Proof validation MUST be independently executable without inspecting Agent internals.
