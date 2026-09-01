# H2A2H Protocol Specification v1.0

Status: Normative draft.

H2A2H means **Human-to-Agent-to-Human**. It specifies a transport-independent responsibility, delegation, interaction, proof, and interoperability model for digital actions that originate from Human intent, may cross one or more machine/entity boundaries, and ultimately return to a Human endpoint.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative requirements.

## 1. Scope

H2A2H standardizes:

- semantic participant/Entity identity;
- Human responsibility and accountability boundaries;
- Intent references through OpenIntent Protocol;
- bounded machine-verifiable delegation through OpenDelegation Protocol;
- declarative communication through OpenEntityChannels;
- a transport-neutral H2A2H message envelope;
- the canonical interaction lifecycle;
- Human-in-the-Healing-Loop escalation/resume;
- Proof-of-Human-Return (PoHR);
- security profile requirements;
- provenance/audit semantics;
- MCP/A2A bridge rules;
- version negotiation/evolution;
- conformance requirements.

H2A2H does not mandate a particular Agent framework, LLM, orchestration architecture, programming language, identity provider, database, message broker, or network transport.

## 2. Non-goals

H2A2H is not:

- a universal replacement for MCP, A2A, HTTP, gRPC, NATS, QUIC, WebSocket, or other transports/protocols;
- an Agent reasoning algorithm;
- an authorization system that treats authentication credentials as delegated authority;
- a requirement that every participant be an Agent;
- a requirement that a Human synchronously approve every machine action.

## 3. Entities and terminology

An **Entity** is an independently identifiable semantic participant capable of owning identity, behavior, policy, capabilities, channels, and/or responsibility. Entity kinds include Human, Agent, Organization, Service, Device, Government, Hospital, School, Business, and extensible additional kinds.

An Agent MUST be treated as one Entity kind, not as the universal type of all participants.

Normative terminology and identity distinctions are defined in `spec/terminology.md` and `spec/identity-responsibility.md`.

## 4. Core architecture

An H2A2H interaction is modeled as:

`Human intent -> delegated execution -> one or more Entity handoffs -> result -> Human return -> optional Human acknowledgement`

The runtime implementation MAY use workflows, actors, event choreography, services, devices, queues, RPC, streaming, or combinations thereof. The external protocol semantics MUST remain stable.

Every effect requiring delegated authority MUST occur only after effective authority has been validated.

Every accountability-boundary crossing MUST be auditable.

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

## 6. Delegated authority

OpenDelegation Protocol expresses explicit bounded authority.

Authentication MUST NOT be treated as delegation. A credential proves identity/access under a security profile; delegation proves permitted action scope.

For a child delegation derived from a parent:

`effective_scope(child) ⊆ effective_scope(parent)`

Child delegation MUST NOT widen Intent, action, resource, temporal, monetary, geographic, security, or depth constraints.

Sessions derived from Human delegation MUST NOT outlive their backing delegation and MUST NOT silently renew. Revocation MUST prevent new effects without requiring Agent restart.

See `spec/opendelegation.md`.

## 7. Entity identity and responsibility

A canonical Entity reference separates:

- semantic identity (`canonical_label`);
- stable Entity identity (`entity_id`);
- interaction participant identity;
- runtime/process/session identity;
- Human identity reference;
- accountability/responsibility identity.

Network address MUST NOT be canonical Entity identity.

The responsibility chain is append-only provenance of accountable boundaries across an interaction. Delegation and responsibility MUST remain separate relationships.

## 8. OpenEntityChannels

Entities MAY declare multiple communication channels. Intents MAY declare communication requirements.

A runtime resolves:

`Intent requirements ∩ sender channels ∩ receiver channels ∩ security policy ∩ runtime constraints`.

Fallback MUST NOT weaken required security, authority, reliability, ordering, or acknowledgement semantics.

Reference profiles include in-memory, HTTP/HTTPS, WebSocket, SSE, gRPC, QUIC, NATS, MCP, and bridge-compatible A2A profiles.

See `spec/openentitychannels.md`.

## 9. Canonical message envelope

All H2A2H semantic messages use the transport-neutral envelope defined by `spec/envelope.md` and `schemas/h2a2h-v1.schema.json#/$defs/envelope`.

At minimum an envelope identifies:

- H2A2H protocol/version;
- message, interaction, and correlation identity;
- causation when applicable;
- message kind;
- Intent reference;
- sender and receiver Entity references;
- timestamp;
- payload semantics.

When required, delegation, responsibility, proof, idempotency, trace, channel, and extension metadata are carried or referenced explicitly.

A transport response MUST NOT be interpreted as H2A2H lifecycle completion unless all required lifecycle conditions have been satisfied.

## 10. Canonical lifecycle

The success path is:

`CREATED -> INTENT_CAPTURED -> AUTHORITY_VALIDATED -> PARTICIPANTS_RESOLVED -> CHANNEL_BOUND -> EXECUTING -> RETURN_PENDING -> HUMAN_RETURNED -> ACKNOWLEDGED? -> CLOSED`

Recoverable protocol states include `HEALING_REQUIRED`, `HUMAN_ESCALATION_REQUIRED`, and `SUSPENDED`.

Terminal non-success states include `CANCELLED`, `EXPIRED`, `REJECTED`, and `FAILED_TERMINAL`.

Invalid state transitions MUST be rejected deterministically. Synchronous and asynchronous implementations MUST preserve the same semantic lifecycle.

See `spec/lifecycle.md`.

## 11. Human-in-the-Healing-Loop

Automated healing MAY apply declared deterministic transformations/normalizations during validation/recovery.

Healing MUST NOT:

- invent authority;
- silently reinterpret a materially different Human decision;
- retry recursively without tracking attempts/cycles;
- erase failed attempts from provenance.

When Human knowledge, authority, or choice is required, the interaction enters Human escalation while preserving interaction/correlation and resume state. Human correction is an auditable causal event.

See `spec/human-in-the-healing-loop.md`.

## 12. Proof-of-Human-Return

H2A2H distinguishes:

- transport delivery;
- machine receipt;
- Human presentation;
- explicit Human acknowledgement.

PoHR MUST bind the interaction, intended Human (or authorized representative), exact result/digest, return state, channel, time, and proof profile.

Transport delivery alone MUST NOT be labeled Human return.

PoHR profiles include presentation, acknowledgement, representative, and privacy-preserving modes. Failed Human return remains correlated and auditable.

See `spec/proof-of-human-return.md`.

## 13. Security

Security is decomposed into:

- identity authentication;
- transport protection;
- delegated authorization;
- proof validation.

These concerns MUST NOT be collapsed into one another.

Reference profiles include local-trusted, signed Ed25519 evidence, mTLS+DPoP remote communication, and WebAuthn-bound Human authorization/session profiles.

Remote profiles MUST provide replay/freshness defense. Security fallback MUST NOT downgrade below required policy.

See `spec/security.md`.

## 14. Audit and provenance

A completed or failed interaction MUST be reconstructible from protocol/audit records without inspecting private Agent internals.

Audit MUST preserve lifecycle transitions, participant/responsibility changes, Intent version, delegation provenance, selected channels, proofs, Human interventions, timestamps, and terminal status.

History is append-only. Redaction MAY hide sensitive values while preserving semantic truth, digest/reference, and provenance.

Tamper-evident digest chaining is defined by the reference implementation.

See `spec/audit-provenance.md`.

## 15. MCP and A2A interoperability

MCP and A2A MAY be bridge targets or communication profiles when their semantics are compatible.

A bridge MUST preserve namespaced H2A2H metadata necessary for interaction/correlation, Intent, delegation, responsibility, proof, and idempotency.

Target-protocol authentication/capability discovery MUST NOT widen H2A2H authority.

A2A task completion or MCP tool completion does not by itself satisfy PoHR.

Lossy bridges MUST declare unsupported/lossy semantics instead of claiming native H2A2H equivalence.

See `spec/interop-mcp-a2a.md`.

## 16. Versioning and extensions

Normative artifacts use semantic versions.

Same-major peers MAY interoperate when required features/extensions are mutually supported. Different major versions require an explicit bridge/profile.

Extensions MUST be namespaced and classified optional or critical. Unknown optional extensions MAY be ignored only when they do not alter core semantics. Unknown critical extensions MUST cause deterministic rejection.

See `spec/versioning.md`.

## 17. Normative schemas

`schemas/h2a2h-v1.schema.json` is the JSON Schema 2020-12 normative artifact bundle.

It contains schemas for:

- Entity references;
- responsibility chains;
- envelopes;
- OpenIntent integration artifacts;
- OpenDelegation;
- OpenEntityChannels;
- Proof-of-Human-Return;
- audit records;
- escalation records.

Normative examples MUST validate against the appropriate `$defs` fragment.

## 18. Formal invariants

`formal/H2A2H.tla` is the formal state/invariant projection of the protocol core. It models:

- allowed lifecycle transitions;
- authority expiry/revocation;
- delegation scope monotonicity/depth;
- responsibility preservation;
- Human-return-before-close;
- acknowledgement implication;
- terminal-state stability.

Formal artifacts, schemas, specification clauses, and executable conformance tests SHOULD remain mutually traceable.

## 19. Conformance

A conforming implementation MUST pass the applicable H2A2H conformance suite.

Conformance categories include:

- normative schema validation;
- lifecycle transitions;
- delegation expiration/revocation/scope;
- identity/responsibility integrity;
- idempotency/replay behavior;
- channel resolution/negotiation;
- proof validation;
- escalation/resume;
- Human return;
- version/extension compatibility.

A protocol-level v1.0 interoperability claim requires at least two implementations with independent internal code paths to complete a compatible bidirectional H2A2H interaction using the normative specification rather than shared runtime internals.

## 20. Reference implementation

The TypeScript implementation in `src/` is a reference projection of the protocol, not the definition of the protocol itself.

It includes:

- canonical runtime lifecycle;
- delegation sessions;
- security/proof primitives;
- healing/escalation coordinator;
- tamper-evident audit trail;
- SDK and artifact registry;
- channel adapters/forger;
- MCP/A2A bridge projections;
- version negotiation;
- E2E examples/tests.

Implementation-specific behavior MUST NOT override the normative specification.

## 21. Normative examples

At minimum the repository contains:

- an OpenIntent example;
- a bounded OpenDelegation example;
- executable Human→Agent→Agent→Human flow;
- executable Human→Agent→Organization/Service/Device/Government→Agent→Human flows;
- valid and invalid conformance fixtures.

## 22. v1.0 interoperability condition

H2A2H v1.0 is considered protocol-complete when:

1. this specification and schemas are versioned and internally consistent;
2. reference runtime/SDK passes conformance tests;
3. the reference E2E scenarios close with valid PoHR/audit;
4. a second independent implementation passes conformance and interoperates bidirectionally;
5. CI/release automation produces a reproducible conformance report;
6. no unresolved normative blocker remains.
