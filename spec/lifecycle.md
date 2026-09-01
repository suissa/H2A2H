# Canonical H2A2H Interaction Lifecycle

Status: Normative draft for H2A2H v1.0.

An H2A2H interaction is a correlated state machine. Implementations MAY execute stages using different internal architectures, but they MUST preserve the externally observable lifecycle semantics defined here.

## States

`CREATED -> INTENT_CAPTURED -> AUTHORITY_VALIDATED -> PARTICIPANTS_RESOLVED -> CHANNEL_BOUND -> EXECUTING -> RETURN_PENDING -> HUMAN_RETURNED -> ACKNOWLEDGED -> CLOSED`

Recoverable states:

- `HEALING_REQUIRED`
- `HUMAN_ESCALATION_REQUIRED`
- `SUSPENDED`

Terminal non-success states:

- `CANCELLED`
- `EXPIRED`
- `REJECTED`
- `FAILED_TERMINAL`

Every transition MUST preserve `interaction_id`, `correlation_id`, the applicable responsibility chain, and the protocol version.

## 1. CREATED

A runtime creates an interaction identity before processing external intent data.

Required output:
- unique `interaction_id`;
- creation timestamp;
- protocol version;
- initial initiating participant reference when already known.

The state MUST NOT imply authority or successful intent interpretation.

## 2. INTENT_CAPTURED

The initiating Human or authorized upstream Entity provides enough semantic information to resolve an Intent.

Required checks:
- Intent reference or resolvable `canonical_label`;
- input payload or payload reference;
- schema/version reference when required by the Intent;
- initiating responsibility reference.

Failure semantics:
- ambiguous or recoverably invalid intent -> `HEALING_REQUIRED` or `HUMAN_ESCALATION_REQUIRED`;
- unsupported intent -> `REJECTED`.

## 3. AUTHORITY_VALIDATED

The runtime validates the authority required to execute the requested Intent.

The runtime MUST distinguish authentication from delegation. Authentication proves who or what a participant is; delegation proves what it is allowed to do.

Required checks:
- delegation exists when required;
- delegation is authentic under the selected security profile;
- delegation is active and not expired/revoked;
- requested Intent/action is inside scope;
- effective scope does not exceed any parent delegation;
- session lifetime does not exceed delegation lifetime.

Failure semantics:
- missing or correctable authority -> `HUMAN_ESCALATION_REQUIRED`;
- expired authority -> `EXPIRED` unless re-authorization is allowed and requested;
- invalid or widened authority -> `REJECTED`.

## 4. PARTICIPANTS_RESOLVED

The runtime resolves the concrete participants required by the Intent and responsibility model.

Resolution MAY use registries, local configuration, discovery, directory services, or application-specific resolvers, but resolved participant identity MUST be represented using H2A2H entity references.

Required output:
- sender participant;
- next receiving participant;
- applicable responsible Entity/Human boundary;
- declared capabilities relevant to the Intent.

Unresolvable required participants cause `SUSPENDED`, `HUMAN_ESCALATION_REQUIRED`, or `FAILED_TERMINAL` according to policy.

## 5. CHANNEL_BOUND

The runtime selects and binds a declared communication channel.

Selection MUST be based on OpenEntityChannels/OpenIntent declarations plus runtime policy. A domain Agent MUST NOT procedurally choose a transport client as part of domain behavior.

Required checks:
- both sides support a compatible channel profile;
- security requirements are satisfied;
- request/reply, pub/sub, streaming, ordering, and reliability needs are compatible;
- version negotiation succeeds.

Unavailable channels MAY trigger fallback when fallback is explicitly allowed. Otherwise the interaction enters `SUSPENDED`, `HUMAN_ESCALATION_REQUIRED`, or `FAILED_TERMINAL`.

## 6. EXECUTING

One or more participants execute the Intent through responsibility-preserving handoffs.

Each handoff MUST:
- preserve correlation;
- record causation;
- preserve or narrow delegation scope;
- append an accountability boundary transition when responsibility changes;
- produce auditable provenance;
- maintain idempotency semantics.

An implementation MAY execute synchronously, asynchronously, through messages, actors, workflows, event choreography, services, devices, or combinations of these techniques.

The protocol MUST NOT require a fixed internal orchestration architecture.

## 7. RETURN_PENDING

The requested outcome exists, but the protocol has not yet established human return.

This state is mandatory whenever the final protocol target is a Human.

Transport delivery to an Agent, inbox, queue, gateway, device, or notification service does not by itself transition the interaction to `HUMAN_RETURNED`.

## 8. HUMAN_RETURNED

The selected Proof-of-Human-Return profile has established that the result reached the intended Human or explicitly authorized Human representative.

Required record:
- target Human reference or privacy-preserving equivalent;
- result/payload digest or result reference;
- return timestamp;
- delivery/presentation channel;
- proof profile;
- proof material or verifiable proof reference.

`HUMAN_RETURNED` does not necessarily imply explicit Human acknowledgement.

## 9. ACKNOWLEDGED

The receiving Human or authorized representative explicitly acknowledges receipt when the Intent requires acknowledgement.

Acknowledgement MUST be distinguishable from presentation or transport delivery.

For Intents that do not require explicit acknowledgement, runtime policy MAY transition directly from `HUMAN_RETURNED` to `CLOSED` while recording `acknowledgement_required=false`.

## 10. CLOSED

The interaction is complete and immutable except for append-only audit annotations permitted by policy.

Closure MUST record:
- terminal status;
- final Intent version;
- final responsibility chain;
- delegation/proof references;
- audit trace reference;
- completion timestamp.

## Healing and human escalation

### HEALING_REQUIRED

Used when the interaction can potentially continue after deterministic validation, normalization, transformation, or recovery rules. Healing MUST NOT create new authority or silently reinterpret a materially different Human decision.

A successful healing step returns to the state whose preconditions are now satisfied.

### HUMAN_ESCALATION_REQUIRED

Used when safe continuation requires Human knowledge, authority, correction, or decision.

The runtime MUST preserve the original interaction state and correlation. Human input MUST generate a causally linked event rather than creating an unrelated interaction unless explicitly chosen by the Human.

### SUSPENDED

Used for recoverable environmental conditions such as unavailable channels or temporary dependencies. Suspension MUST include a reason and resume policy.

## Synchronous and asynchronous execution

The same state model applies to synchronous and asynchronous execution.

A synchronous transport response MUST NOT be treated as lifecycle closure unless all required H2A2H terminal conditions are satisfied.

An asynchronous interaction MUST be resumable from persisted protocol state using correlation and causation metadata.

## Transition invariants

1. A state MUST NOT be skipped when its semantic condition is required by the Intent/profile.
2. `AUTHORITY_VALIDATED` MUST occur before any effect requiring delegated authority.
3. `CHANNEL_BOUND` MUST occur before a remote handoff.
4. Delegation scope MUST only stay equal or narrow during downstream handoff.
5. Accountability transitions MUST be recorded before or atomically with responsibility transfer.
6. `HUMAN_RETURNED` MUST require the selected PoHR validation condition.
7. `ACKNOWLEDGED` MUST require explicit acknowledgement when acknowledgement is required.
8. A terminal state MUST preserve enough evidence to reconstruct why it was reached.
9. Replayed idempotent messages MUST NOT create duplicate lifecycle effects.
10. Resume from healing, escalation, or suspension MUST continue the same interaction unless policy explicitly forks a child interaction with a causation link.

## Minimal transition record

Every transition SHOULD be representable as:

```json
{
  "interaction_id": "h2a2h:interaction:...",
  "from": "AUTHORITY_VALIDATED",
  "to": "PARTICIPANTS_RESOLVED",
  "event": "h2a2h.lifecycle.participants_resolved",
  "actor": "entity:...",
  "correlation_id": "...",
  "causation_id": "...",
  "timestamp": "...",
  "evidence": []
}
```

The concrete schema is defined separately, but implementations MUST preserve these semantics.
