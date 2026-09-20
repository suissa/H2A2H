# H2A2H Causal Responsibility and Provenance

Status: Normative draft for H2A2H v1.0.

This specification defines how H2A2H represents autonomous decision boundaries, causal provenance, responsibility evidence, and Human-return boundaries in systems composed of Humans, Agents, Services, Devices, Tools, and other independently identifiable Entities.

The model is informed by Promise Theory and the Downstream Principle described by Mark Burgess in *Legal Responsibilities Using Autonomous Agents For Artificial Intelligence: Promise Theory Considerations* (2026), while the protocol artifacts and invariants below are H2A2H extensions.

## 1. Core autonomy rule

H2A2H MUST NOT model one autonomous Agent as possessing implicit command authority over another autonomous Agent.

For autonomous-agent profiles:

```text
Event != Command
Observation != Obligation
Capability != Acceptance
Authentication != Authorization
Authorization != Execution
```

Normal Agent-to-Agent cooperation SHOULD be choreographed through semantic events, advertised capabilities/promises, independently evaluated Intents, and local acceptance decisions.

A direct interaction MAY exist for an explicitly modeled protocol operation, including compensation, recovery, challenge, or evidence exchange, but such interaction MUST NOT create undeclared authority over the receiving Agent.

No upstream Entity may promise the autonomous behavior of a downstream Entity. Each Entity may attest only to behavior, commitments, observations, decisions, or effects that it can legitimately evidence.

## 2. Downstream acceptance

A received Intent, offer, event, recommendation, tool result, or capability advertisement MUST NOT be interpreted as self-executing.

For Agent `B` receiving Intent `I` from Entity `A`, an external effect requires an independently evaluated local boundary:

```text
Execute(B, I) =>
    Authenticated(A, B)
    AND Authorized(A, I)
    AND ProofOfPossession(A)
    AND Policy_B(I) = allow
    AND Accept(B, I)
```

Conversely:

```text
Capability(A, I) !=> Accept(B, I)
```

A Capability grants bounded authority to request consideration of an Intent. It never forces the receiver to satisfy that Intent.

## 3. Semantic primitives

### 3.1 INTENT

`INTENT(X, I)` declares a desired semantic outcome by Entity `X`.

An Intent starts or joins a causal context. It does not guarantee execution and does not grant authority by itself.

### 3.2 PROMISE

`PROMISE(X, P)` records or advertises a behavior/capability that Entity `X` represents itself as able and willing to provide under stated conditions.

An Entity MUST NOT create a normative H2A2H promise on behalf of an autonomous Entity that has not made or cryptographically delegated that representation.

### 3.3 ACCEPT

`ACCEPT(X, Y, C)` records Entity `X` independently accepting semantic input, an offer, a result, or an Intent `Y` under context `C`.

A conforming implementation SHOULD support:

```text
ACCEPT
REJECT
DEFER
PARTIAL
CHALLENGE
```

`PARTIAL` MUST identify the accepted subset or transformed Intent. A material semantic transformation MUST create a new auditable Intent/event rather than silently rewriting the upstream Intent.

### 3.4 ACT

`ACT(X, A, C)` records Action `A` attempted or performed by Entity `X` under authority/context `C`.

Externally consequential Actions MUST satisfy Capability/OpenDelegation and VAAL rules before crossing the execution boundary.

### 3.5 ATTEST

`ATTEST(X, F, P)` records verifiable evidence from Entity `X` about fact `F` under proof profile `P`.

An attestation is evidence, not universal truth. Verifiers MUST evaluate identity, proof, trust policy, time, scope, and provenance.

## 4. Causal Responsibility Graph

The canonical causal model is a directed acyclic graph (DAG), not a single linear chain.

Each node is an immutable semantic event, decision, or effect. Each causal edge means that one recorded event/Intent materially contributed to another event.

A node MUST be able to carry:

```yaml
event_id: event:01J...
root_intent_id: intent:01J...
causal_events:
  - event_id: event:inventory-assessment:01J...
    intent:
      intent_id: intent:inventory:01J...
      canonical_label: Inventory.AssessAvailability
      version: 1.0.0
    relation: evidence
  - event_id: event:financial-assessment:01J...
    intent:
      intent_id: intent:financial:01J...
      canonical_label: Financials.AssessCashFlow
      version: 1.0.0
    relation: evidence
  - event_id: event:marketing-assessment:01J...
    intent:
      intent_id: intent:marketing:01J...
      canonical_label: Marketing.AssessDemand
      version: 1.0.0
    relation: evidence
agent_id: agent:019...
actor_id: actor:...
action_id: action:...
intent_id: intent:optimization:...
capability_id: capability:...
policy_hash: sha256:...
decision: ACCEPT
timestamp: 2026-09-14T00:00:00Z
attestation_ref: proof:...
```

### 4.1 `root_intent_id`

`root_intent_id` identifies the originating Intent whose causal context this node participates in. Forked sub-Intents MAY have their own `intent_id` while preserving the root reference.

### 4.2 `causal_events[]`

`causal_events[]` identifies the immediate semantic events/Intents that materially contributed to the new event.

The name intentionally avoids `causal_parents`: `parent` is overloaded in distributed systems and can mean delegation ancestry, ownership, process hierarchy, object containment, or tree structure. `causal_events` states exactly what the relation contains.

The field MUST support multiple entries because autonomous systems may combine parallel observations or decisions.

The compact semantic projection:

```text
causal_events = [
  inventory.intent,
  financial.intent,
  marketing.intent
]
```

is useful for reasoning and graph queries. The normative persisted representation SHOULD preserve both:

- the unique `event_id` of the concrete occurrence; and
- the `intent` reference that gives that occurrence semantic meaning.

Using only `inventory.intent` is not sufficient for audit when the same Intent executes more than once. Using only `event:123` is not sufficiently semantic for human/model reasoning. The pair gives both identity and meaning.

Example convergence:

```text
Inventory.AssessAvailability ----\
Financials.AssessCashFlow --------+--> Business.OptimizeProfitability
Marketing.AssessDemand -----------/
```

### 4.3 Authority provider ancestry is separate

`provider_capability_id` or `provider_delegation_id` represents authority provider lineage only. It MUST NOT be interpreted as causal ancestry.

The prefix `provider` is intentional: the referenced artifact provided, issued, or projected the current authority. It is not the parent of the event, not a command source, and not a structural parent in the causal DAG.

```text
causal_events[]          -> which semantic events/Intents contributed to this event
provider_capability_id   -> which Capability provided/issued the current authority
provider_delegation_id   -> which Delegation provided/issued the current authority
root_intent_id           -> which originating desired outcome started the causal context
```

## 5. ResponsibilityEnvelope

A `ResponsibilityEnvelope` is the canonical responsibility/provenance evidence attached to or referenced by a semantically significant H2A2H transition.

```yaml
responsibility:
  event_id: event:01J...
  interaction_id: interaction:01J...
  correlation_id: corr:01J...
  root_intent_id: intent:01J...
  transition_kind: effect
  accepted_causal_events:
    - event_id: event:inventory:01J...
      intent:
        canonical_label: Inventory.AssessAvailability
        version: 1.0.0
      relation: evidence
      digest: sha256:...

  subject:
    entity_id: agent:019...
    kind: Agent

  agent_id: agent:019...
  actor_id: actor:...
  action_id: action:...

  intent:
    intent_id: intent:...
    canonical_label: Financials.Payment.Execute
    version: 1.0.0

  authority:
    capability_id: capability:...
    provider_capability_id: capability:provider:...
    delegation_id: delegation:...
    provider_delegation_id: delegation:provider:...
    policy_hash: sha256:...
    action_mandate_hash: sha256:...

  identity_evidence:
    identity_fingerprint: sha256:...
    certificate_fingerprint: sha256:...
    proof_key_thumbprint: sha256:...

  decision:
    kind: ACCEPT
    reason_code: policy.allowed
    context_hash: sha256:...

  evidence:
    input_hash: sha256:...
    output_hash: sha256:...
    attestation_ref: proof:...
    action_receipt_ref: receipt:...

  timestamp: 2026-09-14T00:00:00Z
```

Full private reasoning or model chain-of-thought MUST NOT be required for causal accountability. The envelope preserves externally relevant semantic facts, decisions, authority, and evidence.

At an external boundary, a sender MAY provide `claimed_causal_events` in an IntentProposal. They are not causal graph edges until the receiving Entity has verified and recorded them as `accepted_causal_events` in its decision or ResponsibilityEnvelope. Rejected references remain audit evidence of the assertion; they MUST NOT become accepted provenance by omission or later overwrite.

## 6. Event Sourcing as accountability ledger

H2A2H deployments MAY use Event Sourcing as the persistent representation of the Causal Responsibility Graph.

When used for normative accountability, history MUST be append-only and SHOULD be tamper-evident.

The accountability ledger is required to answer at least:

- what was observed;
- which Intent was active;
- which `causal_events` contributed to the decision;
- which Agent independently accepted or rejected the input;
- which Capability/delegation authorized consideration/execution;
- which policy version/hash was evaluated;
- which Actor coordinated execution;
- which Action produced an external effect;
- which external system accepted or rejected it;
- which Human-return boundary applied;
- which participants attested to the transitions.

This model MUST NOT require storing private internal reasoning when hashes, semantic decisions, policy references, and observable inputs/outputs are sufficient.

## 7. Accounted and unaccounted effects

Let `Effects_accountable` be the set of effects that policy declares consequential enough to require causal accounting.

For every accountable effect `e`, a conforming deployment SHOULD be able to reconstruct a valid path `P` from a recognized Intent to `e`:

```text
forall e in Effects_accountable:
    exists P: Intent ~> causal_events* ~> e
```

A valid path requires sufficient evidence at each policy-defined boundary, including identity, authority, local acceptance, Action authorization, and attestation where required. An asserted external causal reference is insufficient until it is receiver-verified and recorded as accepted provenance.

If no valid path can be reconstructed, the effect is classified as:

```text
UnaccountedEffect
```

`UnaccountedEffect` is a protocol/governance failure even when the external operation technically succeeded.

A system MAY distinguish:

```text
technical_success
semantic_success
authorized_success
accounted_success
```

For high-assurance profiles, only `accounted_success` SHOULD be treated as fully successful.

## 8. Responsibility Boundary

A `ResponsibilityBoundary` is a policy-defined point where autonomous continuation requires additional evidence, Human involvement, or transfer to another accountable Entity.

A profile MAY map risk to handling rules, for example:

```text
LOW       -> autonomous
MEDIUM    -> autonomous + immutable audit
HIGH      -> autonomous + Human notification
CRITICAL  -> Human acceptance required before effect
```

The exact risk model is deployment/domain specific. H2A2H standardizes the existence and evidence of the boundary, not a universal risk score.

When Human authority is required before a consequential Action:

```text
Risk(I, C) >= CriticalThreshold => HumanAcceptance(I, C)
```

The Human-facing authorization SHOULD bind the exact ActionCommitment as specified by VAAL.

## 9. Proof-of-Human-Return

Proof-of-Human-Return (PoHR) is the policy-verifiable return of result/control to the required Human boundary. It does not mean a Human must approve every autonomous step.

```text
HumanIntent
  -> AutonomousDecisions*
  -> Effect
  -> Result
  -> ProofOfHumanReturn
```

If pre-effect Human acceptance is required, that acceptance is a separate causal event and MUST NOT be conflated with post-effect PoHR.

## 10. A3 projection: Agent, Actor, Action

When projected onto the AllasCode A3 model:

- **Agent** owns Intent/Behavior selection and the autonomous decision to pursue an outcome;
- **Actor** owns coordination/binding of the Agent to one or more Actions and execution semantics such as ordering, local atomicity, idempotency, and Event Sourcing;
- **Action** owns one narrow effect and operates only within explicit capabilities.

```text
Agent decided.
Actor coordinated.
Action affected the world.
```

The provenance graph SHOULD distinguish decision, coordination, authorization, and effect nodes.

## 11. Choreography, not command

For autonomous-agent profiles, the canonical interaction is event choreography:

```text
Semantic Event
     |
     +--> Agent A observes -> ACCEPT -> Behavior
     +--> Agent B observes -> REJECT/ignore
     +--> Agent C observes -> ACCEPT -> Behavior
```

A produced event declares that something happened. It MUST NOT carry implicit authority obliging another Agent to act.

Compensating Actions MAY explicitly target effects produced by another participant, but compensation MUST still pass its own authority and acceptance boundaries.

## 12. Trust from evidence

A receiver MAY derive trust/trustworthiness assessments from historical promise/commitment outcomes.

```text
Promise/Capability Advertisement
  -> Observed Outcome
  -> Attestation
  -> Historical Evidence
  -> Downstream Trust Assessment
```

Trust is local to the evaluator and MUST NOT automatically grant or widen authority.

## 13. Technical responsibility versus legal liability

H2A2H causal provenance provides evidence about technical identity, authority, decisions, dependencies, and effects.

It MUST NOT be represented as an automatic determination of legal guilt, negligence, personhood, or liability.

Legal responsibility may depend on jurisdiction, contracts, ownership, operator duties, product liability, negligence standards, organizational relationships, evidence admissibility, and judicial/arbitral interpretation.

The protocol goal is narrower and testable: preserve enough evidence to reconstruct autonomous causal participation without pretending that a protocol can replace legal judgment.

## 14. Invariants

A conforming implementation/projection SHOULD preserve:

1. **NoImplicitCommand** — observation of an event or Intent never implies obligation to execute.
2. **LocalAcceptanceRequired** — a downstream autonomous effect requires a local acceptance/authorization decision.
3. **CapabilityDoesNotForceAcceptance** — valid Capability never forces execution.
4. **AuthenticationDoesNotGrantAuthority** — authenticated channel/identity never widens Capability/delegation scope.
5. **CausalEventsAndProviderAuthorityDistinct** — `causal_events` and provider authority ancestry are separate relations.
6. **CausalEventsAreSemanticAndUnique** — persisted causal references preserve concrete `event_id` plus Intent semantics when available.
7. **AccountableEffectsHaveProvenance** — every accountable effect has a valid causal path or is classified `UnaccountedEffect`.
8. **ActionAuthorizationBeforeEffect** — consequential Action authorization precedes the effect.
9. **ResponsibilityEvidenceAppendOnly** — later success cannot erase earlier rejection, challenge, failure, or Human intervention.
10. **HumanBoundaryPreserved** — required Human-return or Human-acceptance boundaries cannot be silently bypassed.
11. **TrustDoesNotExpandAuthority** — trust history does not create authority.
12. **AgentActorActionSeparated** — decision, coordination, and external effect can be distinguished in provenance.
13. **NoPrivateReasoningDependency** — accountability verification does not require disclosure of private chain-of-thought.

## 15. Relationship to other H2A2H specifications

- `identity-responsibility.md` — stable Entity/Agent identity and accountable ownership relationships.
- `opendelegation.md` — attenuated authority.
- `verifiable-action-authorization.md` — exact consequential Action authorization.
- `security.md` — authenticated channels and proof profiles.
- `audit-provenance.md` — append-only evidence/export requirements.
- `proof-of-human-return.md` — return to Human authority/presentation.
- `external-agent-api.md` — standard boundary for external Agents.

## 16. Theoretical reference

Mark Burgess, *Legal Responsibilities Using Autonomous Agents For Artificial Intelligence: Promise Theory Considerations*, arXiv:2608.08022, 2026. https://arxiv.org/abs/2608.08022

H2A2H adopts the autonomy/downstream insight as theoretical motivation. `ResponsibilityEnvelope`, Causal Responsibility Graph, `causal_events`, API gates, `UnaccountedEffect`, A3 mapping, risk boundaries, and proof requirements are H2A2H design proposals and MUST NOT be attributed to Burgess unless independently supported by his text.
