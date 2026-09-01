# OpenDelegation Protocol

Status: Normative draft for H2A2H v1.0.

OpenDelegation expresses explicit, bounded, machine-verifiable authority. It answers **who delegated what authority to whom, under which constraints, for how long, and with which evidence**.

Authentication is not delegation. Possessing credentials, an API key, a session cookie, a passkey-bound session, or network access MUST NOT by itself grant authority to execute an Intent.

## Delegation document

A delegation MUST contain:

- `protocol`: `opendelegation`;
- `version`;
- `delegation_id`;
- `delegator`: Entity reference;
- `delegate`: Entity reference;
- `issued_at`;
- `not_before` when delayed activation is required;
- `expires_at` for bounded authority;
- `scope`;
- `constraints`;
- `parent_delegation_id` when authority is re-delegated;
- `proof` or a verifiable proof reference.

## Scope

Scope MUST be positively enumerated. It MAY include:

- allowed Intent canonical labels;
- allowed action/capability labels;
- resource/entity constraints;
- data boundaries;
- maximum monetary/quantitative limits;
- geographic/legal boundaries;
- channel/security profile restrictions.

A runtime MUST treat undeclared authority as denied.

## Scope monotonicity

For any child delegation `Dchild` derived from parent `Dparent`:

`effective_scope(Dchild) ⊆ effective_scope(Dparent)`

A child delegation MUST NOT widen Intent, action, resource, temporal, monetary, geographic, or security authority.

## Temporal validity

A delegation is active only if:

`issued_at <= now`, `not_before <= now` when present, `now < expires_at` when present, and it has not been revoked.

A child delegation MUST NOT expire later than its parent.

## Session binding

A Human MAY define the maximum duration during which an Agent may act on their behalf. A runtime session derived from a delegation MUST NOT outlive the delegation and MUST NOT silently extend it.

When authority is no longer active, an Agent MAY request re-authorization. The request itself grants no additional authority.

## Revocation

A delegation MAY be revoked before expiration. Revocation MUST identify:

- delegation being revoked;
- revoking Entity;
- timestamp;
- reason code where policy allows;
- proof.

Runtimes MUST reject new effects under a revoked delegation. Long-running work MUST re-evaluate authority at effect boundaries defined by the Intent/policy.

## Non-delegable authority

A policy MAY mark an Intent/action as non-delegable or require direct Human confirmation. Such constraints MUST survive downstream handoff.

A delegate MUST NOT remove a `human_confirmation_required` or `non_delegable` constraint inherited from upstream authority.

## Maximum delegation depth

A delegation MAY declare `max_depth`. The root grant is depth 0. Re-delegation that would exceed the remaining depth MUST be rejected.

## Proof of authority

A proof profile MUST bind at minimum:

- delegation identity;
- delegator identity/reference;
- delegate identity/reference;
- scope digest;
- temporal constraints;
- parent delegation reference when applicable.

The exact cryptographic method is selected by the H2A2H security profile.

## Responsibility preservation

Delegation does not transfer away historical responsibility. The responsibility chain MUST retain the accountable boundary that issued or exercised the delegation according to policy.

## Example

```yaml
protocol: opendelegation
version: 1.0.0
delegation_id: delegation:01J...
delegator:
  entity_id: human:alice
delegate:
  entity_id: agent:alice-commerce
issued_at: 2026-09-01T17:00:00-03:00
expires_at: 2026-09-01T18:00:00-03:00
scope:
  intents:
    - Commerce.PurchaseProducts
  actions:
    - commerce.purchase.create
  limits:
    currency: BRL
    max_amount: 500.00
constraints:
  max_depth: 1
  human_confirmation_required_for:
    - commerce.purchase.above_limit
proof:
  profile: h2a2h.proof.signed.v1
  value: "..."
```

## Validation algorithm

A conforming validator MUST:

1. validate document shape/version;
2. validate identity references;
3. validate proof under the selected profile;
4. validate activation and expiry;
5. check revocation state;
6. validate requested Intent/action against scope;
7. recursively validate parent delegation when present;
8. prove scope monotonicity and depth constraints;
9. apply inherited non-delegable/human-confirmation constraints;
10. return explicit validation evidence or a deterministic rejection reason.

## Deterministic rejection reasons

At minimum:

- `delegation.missing`
- `delegation.invalid_proof`
- `delegation.not_active`
- `delegation.expired`
- `delegation.revoked`
- `delegation.scope_denied`
- `delegation.scope_widened`
- `delegation.depth_exceeded`
- `delegation.parent_invalid`
- `delegation.human_confirmation_required`
- `delegation.non_delegable`
