# Entity Identity and Responsibility Graph

Status: Normative draft for H2A2H v1.0.

H2A2H separates semantic identity, stable Entity identity, runtime participant identity, authority, causal provenance, and responsibility. Network location or process identity MUST NOT substitute for these concepts.

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
- current Capability/delegation references;
- current responsibility/provenance references.

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

An Agent, Service, or Device MAY declare one or more accountability relationships such as:

- `owned_by`;
- `operated_by`;
- `responsible_organization`;
- `responsible_human`;
- `supervised_by`.

These relationships do not automatically grant execution authority. They establish ownership/accountability provenance only.

## Responsibility graph

The canonical H2A2H responsibility representation is an append-only directed acyclic graph of semantic events, decisions, handoffs, and effects.

A responsibility node SHOULD contain:

- `event_id`;
- accountable Entity reference;
- optionally accountable Human reference;
- participant that made the decision or produced the evidence/effect;
- `root_intent_id`;
- current Intent reference;
- `causal_events[]`;
- Capability/delegation reference when authority derives from one;
- Actor/Action references when applicable;
- policy hash/version when a policy decision was material;
- proof/audit evidence references;
- timestamp.

When accountability crosses a boundary, a new node MUST be appended before or atomically with the downstream acceptance/effect boundary.

## `causal_events[]`

`causal_events[]` is the semantic multi-causality relation.

Each entry SHOULD preserve:

```yaml
- event_id: event:inventory:01J...
  intent:
    intent_id: intent:inventory:01J...
    canonical_label: Inventory.AssessAvailability
    version: 1.0.0
  relation: evidence
```

The semantic shorthand:

```text
causal_events = [inventory.intent, financial.intent, marketing.intent]
```

MAY be used for reasoning/query presentation, but persisted accountability evidence SHOULD retain the unique event occurrence as well as the Intent semantics.

`causal_events` MUST NOT be confused with `provider_capability_id` or `provider_delegation_id`; the latter identify the provider/emitter authority lineage, not causality.

## Authority provider ancestry

Authority ancestry is represented with provider-oriented fields such as:

```text
provider_capability_id
provider_delegation_id
```

These fields identify the Capability or Delegation that provided the authority being attenuated or projected into the current artifact.

They MUST NOT be interpreted as causal parents, process parents, ownership parents, object containment, command hierarchy, or DAG ancestry for events.

## Linear responsibility chain compatibility

A linear `responsibility_chain` MAY be emitted as a compatibility/projection view when an interaction is truly sequential or when a consumer cannot process a DAG.

A linear chain MUST NOT be represented as complete causal truth when multiple concurrent `causal_events` contributed to a decision.

Where older H2A2H documents use the term “responsibility chain”, implementations SHOULD interpret it as an ordered projection of the canonical responsibility graph unless the context explicitly requires a sequential structure.

## Example

```yaml
responsibility:
  graph_id: responsibility:01J...
  root_intent_id: intent:company-optimization:01J...
  nodes:
    - event_id: event:inventory:01J...
      participant:
        entity_id: agent:inventory
        kind: Agent
      intent:
        canonical_label: Inventory.AssessAvailability
        version: 1.0.0
      decision: ACCEPT

    - event_id: event:optimization:01J...
      participant:
        entity_id: agent:optimizer
        kind: Agent
      intent:
        canonical_label: Business.OptimizeProfitability
        version: 1.0.0
      causal_events:
        - event_id: event:inventory:01J...
          intent:
            canonical_label: Inventory.AssessAvailability
            version: 1.0.0
          relation: evidence
        - event_id: event:financial:01J...
          intent:
            canonical_label: Financials.AssessCashFlow
            version: 1.0.0
          relation: evidence
```

## Pseudonymous identity

A privacy profile MAY replace direct Human identity with a pseudonymous reference. The protocol MUST retain enough proof to validate required claims without forcing disclosure of unrelated identity attributes.

Pseudonym rotation MUST NOT silently break an active responsibility graph. Rotation events MUST be causally linked and verifiable under the selected identity profile.

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
5. Delegation/Capability and responsibility MUST remain distinct relationships.
6. Causal provenance and provider authority ancestry MUST remain distinct relationships.
7. An H2A2H interaction MUST be traceable to an accountable Human or Organization boundary under the selected governance profile.
8. Privacy-preserving identity MUST support independent claim validation.
9. Identity/key rotation MUST preserve continuity evidence.
10. Entity kinds MUST be extensible without redesigning the envelope or lifecycle.
11. Concurrent causality MUST NOT be flattened into a misleading single-parent chain.
