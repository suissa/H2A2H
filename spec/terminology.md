# H2A2H Terminology, Roles, and Invariants

Status: Normative draft for H2A2H v1.0.

## Normative language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as normative requirements.

## Entity

An **Entity** is any independently identifiable semantic participant that can own identity, behavior, policy, capabilities, channels, or responsibility. Typical entity kinds include Human, Agent, Organization, Service, Device, Government, Hospital, School, and Business.

An implementation MUST NOT assume that Agent is the universal participant type. Agent is one Entity kind among others.

## Human

A **Human** is a natural person represented by an identity reference and optionally by one or more authenticated sessions. A Human MAY delegate bounded authority to an Agent or another Entity.

## Agent

An **Agent** is an Entity capable of receiving an Intent, acting within its declared context and authority, emitting protocol messages, and participating in a responsibility chain. An Agent MUST NOT infer authority merely from credential possession or technical reachability.

## Organization

An **Organization** is an accountable legal, administrative, or operational Entity boundary. It MAY own Agents, Services, Devices, policies, and human responsibility relationships.

## Service

A **Service** is a non-human executable capability endpoint. A Service MAY be a participant in H2A2H without being modeled as an Agent.

## Device

A **Device** is a physical or virtual equipment Entity able to send, receive, or execute protocol-relevant behavior.

## Participant

A **Participant** is an Entity instance taking part in one concrete H2A2H interaction.

## Initiating Human

The **Initiating Human** is the Human whose declared intent begins the responsibility chain. The Initiating Human MAY delegate authority but remains traceable in provenance unless a lawful privacy profile explicitly substitutes a verifiable pseudonymous reference.

## Receiving Human

The **Receiving Human** is the Human endpoint for which the final result is intended. Delivery to transport infrastructure alone does not constitute human return.

## Responsible Entity

A **Responsible Entity** is the Entity accountable for one segment of execution. Each execution segment MUST have an accountable boundary.

## Responsible Human

A **Responsible Human** is a Human linked to an Agent or Organization by an explicit responsibility relationship. H2A2H does not require every machine action to synchronously involve a Human, but it MUST preserve the chain needed to resolve accountability.

## Intent

An **Intent** is a semantically identified desired outcome. Every Intent MUST have a stable `canonical_label`, version, declared participants or resolvable participant roles, input/output semantics, and communication requirements sufficient for runtime resolution.

## canonical_label

A **canonical_label** is the most semantically precise stable label for a protocol concept. It MUST identify meaning rather than implementation details. A canonical label SHOULD remain stable across implementation refactors.

## Delegation

A **Delegation** is an explicit, bounded grant of authority from one Entity to another. Delegation MUST define scope and MUST be independently distinguishable from authentication.

## Delegator

The **Delegator** grants authority.

## Delegate

The **Delegate** receives bounded authority.

## Delegation Chain

A **Delegation Chain** is the ordered set of delegation relationships by which effective authority is derived. Delegated scope MUST NOT widen as the chain grows.

## Responsibility Chain

A **Responsibility Chain** is the ordered provenance of accountable participants from the initiating side of an interaction to the final human return. It is distinct from the delegation chain: responsibility answers *who is accountable for each segment*; delegation answers *what authority was granted*.

## Accountability Boundary

An **Accountability Boundary** is the Entity boundary at which responsibility changes hands. Crossing such a boundary MUST be auditable.

## Channel

A **Channel** is a declared communication mechanism available to an Entity or Intent. Transport choice MUST be derived from protocol declarations and runtime policy rather than hard-coded inside domain behavior.

## Handoff

A **Handoff** is a responsibility-preserving transition from one participant to another. A Handoff MUST preserve correlation, applicable delegation evidence, and provenance.

## Session

A **Session** is a bounded runtime authorization context. A Session MUST NOT outlive the delegation authority from which it derives.

## Proof

A **Proof** is a machine-verifiable artifact supporting a protocol claim, such as authority, integrity, execution provenance, acknowledgement, or human return.

## Proof-of-Human-Return

**Proof-of-Human-Return (PoHR)** is the protocol artifact proving that the result reached the intended Human endpoint or an explicitly authorized Human representative under the selected proof profile.

## Interaction

An **Interaction** is one correlated H2A2H lifecycle instance beginning with intent capture and ending in acknowledged human return, explicit cancellation, or a terminal auditable failure.

## Protocol invariants

1. **Human responsibility preservation** — every completed interaction MUST preserve enough provenance to identify the originating responsibility boundary and every subsequent accountability handoff.
2. **No implicit authority** — authentication, reachability, possession of a token, or agent capability MUST NOT be treated as delegation by itself.
3. **Delegation monotonicity** — a delegate MUST NOT delegate more authority than it currently holds.
4. **Explicit expiration** — time-bounded authority MUST become unusable after expiration without silent renewal.
5. **Transport independence** — semantic protocol fields MUST remain valid regardless of selected transport.
6. **Context isolation** — a participant MUST act only within its declared context, capability, and authority.
7. **Correlation preservation** — handoffs MUST preserve interaction correlation and causation.
8. **Idempotent replay handling** — duplicate protocol messages with the same idempotency identity MUST NOT cause unintended duplicate effects.
9. **Auditable boundary crossing** — every accountability boundary transition MUST be representable in the audit trail.
10. **Human-return distinction** — transport delivery, machine receipt, human presentation, and human acknowledgement MUST be distinguishable states.
11. **No hidden transport logic in domain agents** — domain behavior MUST NOT require transport-specific client code to participate in H2A2H.
12. **Failure remains semantic** — a terminal or recoverable failure MUST remain correlated and machine-auditable rather than disappear as an implementation exception.
13. **Entity-kind neutrality** — protocol correctness MUST NOT depend on both endpoints being Agents.
14. **Version visibility** — every normative artifact exchanged at runtime MUST have an explicit protocol/schema version or a versioned reference.
15. **Minimum disclosure** — security and proof profiles SHOULD reveal only data necessary to validate the claimed property.

## Identity distinction

H2A2H distinguishes:

- semantic identity: stable meaning, typically represented by `canonical_label`;
- entity identity: stable identity of the Entity;
- participant identity: concrete participant instance in an interaction;
- runtime instance identity: process/session-specific identity;
- human identity reference: direct or privacy-preserving reference to a Human;
- responsibility identity: the accountable Entity/Human boundary associated with a segment.

These identifiers MAY be related, but implementations MUST NOT collapse them into one value unless the selected profile guarantees identical semantics.
