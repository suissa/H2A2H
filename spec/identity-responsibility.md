# Entity Identity and Responsibility Chain

Status: Normative draft for H2A2H v1.0.

H2A2H separates semantic identity, Entity identity, runtime participant identity, and responsibility. Network location or process identity MUST NOT substitute for these concepts.

## Entity reference

A canonical Entity reference MUST contain:

- `entity_id`: globally or trust-domain unique identity;
- `kind`: semantic Entity kind such as Human, Agent, Organization, Service, Device, Government, Hospital, School, or Business;
- `canonical_label` when the Entity has a stable semantic label;
- optional `identity_profile` and verifiable identity material/reference.

`entity_id` identifies *which Entity*. `canonical_label` identifies *semantic meaning*. They MUST NOT be assumed interchangeable.

## Participant identity

A participant is a concrete Entity participation in an interaction. A participant reference MAY add:

- `participant_id`;
- `runtime_instance_id`;
- `session_id`;
- role within the Intent;
- current responsibility/delegation references.

A restarted process MAY have a new runtime identity while preserving Entity identity.

## Human identity

H2A2H does not require a universal identity provider. A Human identity reference MAY be:

- direct identity under a trust domain;
- DID/verifiable credential profile;
- authenticated account/session reference;
- pseudonymous pairwise identifier;
- privacy-preserving proof subject.

The selected profile MUST still allow the claims required by delegation, responsibility, and Proof-of-Human-Return to be validated.

## Responsible-owner relationships

An Agent, Service, or Device MAY declare one or more responsibility relationships such as:

- `owned_by`;
- `operated_by`;
- `responsible_organization`;
- `responsible_human`;
- `supervised_by`.

These relationships do not automatically grant execution authority. They establish accountability/provenance relationships.

## Responsibility chain

A responsibility chain is an ordered append-only sequence of segments. Each segment contains:

- `segment_id`;
- accountable Entity reference;
- optionally accountable Human reference;
- participant that performed or handed off work;
- Intent/action scope for the segment;
- `entered_at` and `exited_at` where known;
- predecessor segment;
- delegation reference when authority derives from delegation;
- proof/audit evidence references.

When accountability crosses a boundary, a new segment MUST be appended before or atomically with the handoff.

## Example

```yaml
responsibility_chain:
  chain_id: responsibility:01J...
  segments:
    - segment_id: r0
      accountable_entity:
        entity_id: human:alice
        kind: Human
      participant:
        entity_id: human:alice
        kind: Human
      role: initiating_human
      intent: Commerce.PurchaseProducts
    - segment_id: r1
      predecessor: r0
      accountable_entity:
        entity_id: org:alice-company
        kind: Organization
      accountable_human:
        entity_id: human:alice
        kind: Human
      participant:
        entity_id: agent:alice-commerce
        kind: Agent
      delegation_id: delegation:alice-commerce-session
      intent: Commerce.PurchaseProducts
```

## Pseudonymous identity

A privacy profile MAY replace direct Human identity with a pseudonymous reference. The protocol MUST retain enough proof to validate required claims without forcing disclosure of unrelated identity attributes.

Pseudonym rotation MUST NOT silently break an active responsibility chain. Rotation events MUST be causally linked and verifiable under the selected identity profile.

## Identity rotation

Entity keys, credentials, process instances, and endpoints MAY rotate without changing `entity_id` if the identity profile proves continuity. A change in semantic Entity identity MUST use a new `entity_id` or an explicit migration/alias record.

## Serialization

Identity and responsibility records MUST be transport-neutral. Transport addresses belong to OpenEntityChannels, not canonical Entity identity.

## Resolution

A runtime resolving a participant MUST output:

- resolved Entity reference;
- role/capability match evidence;
- responsibility boundary;
- supported identity/security profile;
- channel references separately.

## Invariants

1. Every active participant MUST be uniquely referenceable inside an interaction.
2. Runtime/process identity MUST NOT replace stable Entity identity.
3. Network address MUST NOT be canonical Entity identity.
4. Responsibility changes MUST be append-only and auditable.
5. Delegation and responsibility MUST remain distinct relationships.
6. An H2A2H interaction MUST be traceable to an accountable Human or Organization boundary under the selected governance profile.
7. Privacy-preserving identity MUST support independent claim validation.
8. Identity/key rotation MUST preserve continuity evidence.
9. Entity kinds MUST be extensible without redesigning the envelope or lifecycle.
