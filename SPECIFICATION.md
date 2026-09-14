# H2A2H Protocol Specification v1.0

Status: Normative draft.

H2A2H means **Human-to-Agent-to-Human**. It specifies a transport-independent identity, responsibility, delegation/Capability, Intent, interaction, proof, causal-provenance, and interoperability model for digital actions that originate from Human or authorized Entity intent, may cross autonomous machine/entity boundaries, and ultimately preserve the required Human responsibility/return boundary.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative requirements.

## 1. Scope

H2A2H standardizes:

- semantic participant/Entity identity;
- Human/Organization responsibility boundaries;
- Intent references through OpenIntent Protocol;
- bounded machine-verifiable delegation and Capability semantics;
- declarative communication through OpenEntityChannels;
- transport-neutral H2A2H envelopes;
- autonomous receiver-local acceptance;
- causal responsibility/provenance through `causal_events[]`;
- the canonical interaction lifecycle;
- Human-in-the-Healing-Loop escalation/resume;
- Verifiable Action Authorization Layer (VAAL);
- Proof-of-Human-Return (PoHR);
- security profile requirements;
- external-Agent API semantics;
- provenance/audit semantics;
- MCP/A2A bridge rules;
- version negotiation/evolution;
- conformance requirements.

H2A2H does not mandate a particular Agent framework, LLM, orchestration architecture, programming language, identity provider, database, message broker, or network transport.

## 2. Non-goals

H2A2H is not:

- a universal replacement for MCP, A2A, HTTP, gRPC, NATS, QUIC, WebSocket, or other transports/protocols;
- an Agent reasoning algorithm;
- a system that treats authentication credentials as delegated authority;
- a requirement that every participant be an Agent;
- a requirement that a Human synchronously approve every machine action;
- a mechanism that automatically determines legal liability or guilt;
- a requirement to expose private LLM chain-of-thought.

## 3. Entities and terminology

An **Entity** is an independently identifiable semantic participant capable of owning identity, behavior, policy, capabilities, channels, and/or responsibility. Entity kinds include Human, Agent, Organization, Service, Device, Government, Hospital, School, Business, and extensible additional kinds.

An Agent MUST be treated as one Entity kind, not as the universal type of all participants.

Normative terminology and identity distinctions are defined in `spec/terminology.md` and `spec/identity-responsibility.md`.

## 4. Core autonomy architecture

H2A2H treats autonomous participants as local decision makers.

For autonomous-Agent profiles:

```text
Event != Command
Observation != Obligation
Capability != Acceptance
Authentication != Authorization
Authorization != Execution
```

A sender can propose an Intent, advertise a Capability/promise, or emit a semantic event. The receiving autonomous Agent independently evaluates whether to accept or reject participation.

Normal autonomous Agent-to-Agent interaction SHOULD use semantic event choreography rather than implicit command authority.

An H2A2H interaction may be represented as:

```text
Human/Entity Intent
-> authenticated bounded participation
-> one or more receiver-local acceptance decisions
-> authorized Actions/effects
-> auditable causal provenance
-> result
-> required Human return/acknowledgement
```

See `spec/responsibility-causal-provenance.md`.

## 5. Intent semantics

H2A2H uses OpenIntent Protocol as the semantic declaration of the desired outcome.

An H2A2H-resolvable Intent MUST have:

- stable `canonical_label`;
- explicit version;
- input/output semantics;
- required participant roles;
- required authority;
- acceptable communication requirements;
- pre/postconditions where applicable.

`canonical_label` MUST represent semantic meaning rather than code paths, transport names, process names, or deployment topology.

Transport selection MUST NOT be hard-coded in domain Agent behavior. See `spec/openintent-integration.md`.

## 6. Authority: Delegation and Capability

OpenDelegation expresses explicit bounded authority across delegation relationships. External-Agent profiles MAY use a Capability artifact as a bounded, sender/audience-scoped authorization projection.

Authentication MUST NOT be treated as delegation or Capability.

For a child authority derived from a provider authority:

```text
effective_scope(child) subset-or-equal effective_scope(provider)
```

Child authority MUST NOT widen Intent, Action, resource, temporal, monetary, geographic, security, or depth constraints.

Sessions derived from Human delegation MUST NOT outlive their backing authority and MUST NOT silently renew. Revocation MUST prevent new effects without requiring Agent restart.

See `spec/opendelegation.md` and `spec/external-agent-api.md`.

## 7. Entity identity and responsibility

A canonical Entity reference separates:

- semantic identity (`canonical_label`);
- stable Entity identity (`entity_id`);
- interaction participant identity;
- runtime/process/session identity;
- Human identity reference;
- accountability/responsibility identity.

Network address MUST NOT be canonical Entity identity.

The canonical responsibility model is an append-only DAG of events, decisions, handoffs, and effects. A linear responsibility chain is a compatibility/projection view only when it does not misrepresent concurrent causality.

Delegation/Capability provider ancestry and causal provenance MUST remain separate relationships.

See `spec/identity-responsibility.md` and `spec/responsibility-causal-provenance.md`.

## 8. Causal events

Semantic multi-causality is represented by `causal_events[]`.

Each persisted causal reference SHOULD preserve both:

- concrete `event_id`; and
- the Intent reference (`intent_id`, `canonical_label`, `version`) giving the event semantic meaning.

A compact semantic view may be:

```text
causal_events = [inventory.intent, financial.intent, marketing.intent]
```

This MUST NOT be confused with `provider_capability_id` or `provider_delegation_id`, which represent provider authority ancestry.

## 9. OpenEntityChannels

Entities MAY declare multiple communication channels. Intents MAY declare communication requirements.

A runtime resolves:

```text
Intent requirements
intersect sender channels
intersect receiver channels
intersect security policy
intersect runtime constraints
```

Fallback MUST NOT weaken required security, authority, reliability, ordering, or acknowledgement semantics.

Reference profiles include in-memory, HTTP/HTTPS, WebSocket, SSE, gRPC, QUIC, NATS, MCP, and bridge-compatible A2A profiles.

See `spec/openentitychannels.md`.

## 10. Canonical message envelope

All H2A2H semantic messages use the transport-neutral envelope defined by `spec/envelope.md`.

At minimum an envelope identifies:

- H2A2H protocol/version;
- message, interaction, and correlation identity;
- direct protocol `causation_id` when applicable;
- semantic `causal_events[]` when applicable;
- message kind;
- Intent reference;
- sender and receiver Entity references;
- timestamp;
- payload semantics.

`causation_id` identifies direct protocol-message causation. `causal_events[]` identifies semantic multi-event/Intent causality. They MUST NOT be treated as synonyms.

When required, Capability/delegation, responsibility, proof, idempotency, trace, channel, and extension metadata are carried or referenced explicitly.

A transport response MUST NOT be interpreted as autonomous acceptance or H2A2H lifecycle completion unless the semantic lifecycle conditions have been satisfied.

## 11. Receiver-local acceptance

For an autonomous receiver, valid identity and authority permit an Intent to be considered; they do not force acceptance.

A receiver SHOULD expose one of:

```text
ACCEPT
REJECT
DEFER
PARTIAL
CHALLENGE
```

A material `PARTIAL` transformation MUST be explicit and auditable.

See `spec/external-agent-api.md` and `spec/responsibility-causal-provenance.md`.

## 12. Canonical lifecycle

The success path is:

```text
CREATED
-> INTENT_CAPTURED
-> AUTHORITY_VALIDATED
-> PARTICIPANTS_RESOLVED
-> CHANNEL_BOUND
-> EXECUTING
-> RETURN_PENDING
-> HUMAN_RETURNED
-> ACKNOWLEDGED?
-> CLOSED
```

Recoverable protocol states include `HEALING_REQUIRED`, `HUMAN_ESCALATION_REQUIRED`, and `SUSPENDED`.

Terminal non-success states include `CANCELLED`, `EXPIRED`, `REJECTED`, and `FAILED_TERMINAL`.

VAAL and external-Agent acceptance stages MAY be represented as auditable sub-states/events until a future lifecycle major version exposes them directly.

See `spec/lifecycle.md`.

## 13. Verifiable Action Authorization Layer

Acceptance of an Intent does not authorize arbitrary consequential effects.

VAAL separates:

```text
Delegation/Capability
-> ActionCommitment
-> ActionMandate
-> ALLOW | DENY | CHALLENGE
-> Effect
-> ActionReceipt
```

Only `ALLOW` may cross the consequential execution boundary.

See `spec/verifiable-action-authorization.md`.

## 14. Human-in-the-Healing-Loop

Automated healing MAY apply declared deterministic transformations/normalizations during validation/recovery.

Healing MUST NOT:

- invent authority;
- silently reinterpret a materially different Human decision;
- retry recursively without tracking attempts/cycles;
- erase failed attempts from provenance.

When Human knowledge, authority, or choice is required, the interaction enters Human escalation while preserving interaction/correlation and resume state. Human correction is an auditable causal event.

See `spec/human-in-the-healing-loop.md`.

## 15. Proof-of-Human-Return

H2A2H distinguishes:

- transport delivery;
- machine receipt;
- Human presentation;
- explicit Human acknowledgement.

PoHR MUST bind the interaction, intended Human or authorized representative, exact result/digest, return state, channel, time, and proof profile.

Transport delivery alone MUST NOT be labeled Human return.

Pre-effect Human acceptance and post-effect Proof-of-Human-Return are separate causal events.

See `spec/proof-of-human-return.md`.

## 16. Security

Security is decomposed into:

- identity authentication;
- transport protection;
- bounded/delegated authorization;
- proof-of-possession when required;
- proof validation.

These concerns MUST NOT be collapsed into one another.

Reference profiles include local-trusted, signed Ed25519 evidence, mTLS+DPoP remote communication, and WebAuthn-bound Human authorization/session profiles.

Remote profiles MUST provide replay/freshness defense. Security fallback MUST NOT downgrade below required policy.

See `spec/security.md`.

## 17. External Agent API

The standard external-Agent boundary is defined by `spec/external-agent-api.md` and `schemas/h2a2h-external-agent-api-v1.schema.json`.

Reference gate order:

```text
mTLS
-> Agent identity binding
-> Capability validation
-> Proof-of-Possession
-> Intent validation
-> receiver-local policy
-> ACCEPT | REJECT | DEFER | PARTIAL | CHALLENGE
-> VAAL when consequential
-> effect
-> receipt/attestation
-> causal provenance append
```

HTTP is a reference transport binding only. HTTP `POST` MUST NOT be interpreted as command authority.

## 18. Audit and provenance

A completed, failed, rejected, or externally effected interaction MUST be reconstructible from protocol/audit records without inspecting private Agent internals.

Audit MUST preserve lifecycle transitions, participant/responsibility changes, Intent version, `causal_events`, authority provenance, selected channels, local acceptance, proofs, Action receipts, Human interventions, timestamps, and terminal status.

History is append-only. Redaction MAY hide sensitive values while preserving semantic truth, digest/reference, and provenance.

See `spec/audit-provenance.md`.

## 19. Accounted effects

For policy-defined accountable effects, a high-assurance implementation SHOULD reconstruct a valid causal path from a recognized Intent to the effect:

```text
forall e in Effects_accountable:
    exists P: Intent ~> causal_events* ~> e
```

If the required path/evidence cannot be reconstructed, the effect is classifiable as `UnaccountedEffect` even when the external operation technically succeeded.

A deployment MAY distinguish `technical_success`, `semantic_success`, `authorized_success`, and `accounted_success`.

## 20. MCP and A2A interoperability

MCP and A2A MAY be bridge targets or communication profiles when their semantics are compatible.

A bridge MUST preserve namespaced H2A2H metadata necessary for interaction/correlation, Intent, Capability/delegation, responsibility, causal events, proof, and idempotency.

Target-protocol authentication/capability discovery MUST NOT widen H2A2H authority.

A2A task completion or MCP tool completion does not by itself satisfy PoHR or H2A2H accounted-success requirements.

See `spec/interop-mcp-a2a.md`.

## 21. Versioning and extensions

Normative artifacts use semantic versions.

Same-major peers MAY interoperate when required features/extensions are mutually supported. Different major versions require an explicit bridge/profile.

Extensions MUST be namespaced and classified optional or critical. Unknown optional extensions MAY be ignored only when they do not alter core semantics. Unknown critical extensions MUST cause deterministic rejection.

See `spec/versioning.md`.

## 22. Normative schemas

`schemas/h2a2h-v1.schema.json` remains the normative JSON Schema 2020-12 bundle for the original H2A2H v1 core artifact set.

`schemas/h2a2h-external-agent-api-v1.schema.json` defines the external-Agent/causal-responsibility extension artifacts, including:

- Capability;
- `IntentProposal`;
- `IntentDecision`;
- `causal_events` references;
- `ResponsibilityEnvelope`.

The legacy `responsibilityChain` schema fragment is a linear compatibility projection and MUST NOT be used to claim complete causality for a concurrent DAG.

## 23. Formal invariants

`formal/H2A2H.tla` models lifecycle/delegation invariants.

`formal/H2A2H-Responsibility.tla` models the external-Agent/accountability boundary, including:

- authentication before accounted effect;
- Capability before accounted effect;
- proof-of-possession before accounted effect;
- validated Intent before accounted effect;
- local acceptance before accounted effect;
- exact Action authorization before accounted effect;
- semantic causal evidence before accounted effect;
- required Human boundary preservation;
- explicit classification of unaccounted effects;
- trust changes that do not manufacture authority.

Formal artifacts, schemas, specification clauses, and executable conformance tests SHOULD remain mutually traceable.

## 24. Conformance

A conforming implementation MUST pass the applicable H2A2H conformance suite.

Conformance categories include:

- normative schema validation;
- lifecycle transitions;
- authority expiration/revocation/scope;
- identity/responsibility integrity;
- external-Agent mTLS/PoP/Capability gating when applicable;
- autonomous receiver-local acceptance;
- semantic causal-event integrity;
- idempotency/replay behavior;
- channel resolution/negotiation;
- VAAL proof validation;
- escalation/resume;
- Human return;
- version/extension compatibility.

A protocol-level v1.0 interoperability claim requires at least two implementations with independent internal code paths to complete compatible bidirectional H2A2H interactions using normative specification artifacts rather than shared runtime internals.

## 25. Reference implementation

The TypeScript implementation in `src/` is a reference projection of the protocol, not the definition of the protocol itself.

Implementation-specific behavior MUST NOT override the normative specification.

The external-Agent causal-responsibility profile may be implemented incrementally, but an implementation MUST NOT claim conformance to that profile until its applicable schema, security, authority, acceptance, provenance, and Action-authorization requirements are enforced.

## 26. Theoretical basis and legal boundary

The causal-responsibility model is informed by Mark Burgess, *Legal Responsibilities Using Autonomous Agents For Artificial Intelligence: Promise Theory Considerations*, arXiv:2608.08022 (2026), particularly the autonomy axiom and Downstream Principle.

H2A2H does not claim that technical causal evidence automatically determines legal liability. The protocol supplies verifiable technical evidence for later governance, audit, contractual, regulatory, judicial, or arbitral assessment.

See `docs/Legal-Responsibilities-Using-Autonomous-Agents-For-Artificial-Intelligence.md`.

## 27. v1.0 interoperability condition

H2A2H v1.0 is considered protocol-complete when:

1. specifications and schemas are versioned and internally consistent;
2. reference runtime/SDK passes applicable conformance tests;
3. reference E2E scenarios close with valid PoHR/audit;
4. the external-Agent profile, when claimed, passes its Capability/PoP/acceptance/causal-accounting tests;
5. a second independent implementation passes conformance and interoperates bidirectionally;
6. CI/release automation produces a reproducible conformance report;
7. no unresolved normative blocker remains.
