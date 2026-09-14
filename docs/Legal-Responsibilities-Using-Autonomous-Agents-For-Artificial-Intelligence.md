# Legal Responsibilities Using Autonomous Agents For Artificial Intelligence — Paper and H2A2H Response

Status: Research/design note. This document is not legal advice.

## Paper

**Mark Burgess. _Legal Responsibilities Using Autonomous Agents For Artificial Intelligence: Promise Theory Considerations_. arXiv:2608.08022, 8 August 2026.**

- arXiv: https://arxiv.org/abs/2608.08022
- H2A2H related specs: `../spec/responsibility-causal-provenance.md` and `../spec/external-agent-api.md`

## 1. Why this paper matters

The paper addresses a problem that becomes unavoidable as software Agents acquire more independent decision-making capability: when an AI system causes harm, failure, unauthorized access, or other unexpected effects, simply asking “which Human told it to do that?” may no longer describe the actual causal structure.

Modern Agent systems compose multiple independently operated components: Humans, an Agent integrator, LLM providers, tools, APIs, services, devices, policies, and other Agents. Their behavior is not necessarily frozen by a single author or operator. Decisions are made at several boundaries during execution.

The paper argues that Promise Theory provides a better causal vocabulary for this environment.

## 2. Promise Theory axiom used by Burgess

The central rule in the paper is:

> No agent may promise anything on behalf of any agent other than itself.

This is not merely etiquette. Burgess uses it as a causal limitation: an autonomous component cannot guarantee the independent choice of another autonomous component.

That immediately challenges traditional “command and control” models. A sender can ask, propose, advertise, or attempt to impose something, but the receiver is the component that ultimately accepts, rejects, partially accepts, or ignores it.

## 3. The Downstream Principle

The paper's key consequence is the **Downstream Principle**.

In a chain of offer and acceptance, the downstream receiver retains the final local choice. An upstream provider can promise best-effort behavior, but cannot promise the receiver's acceptance.

For distributed AI this means that causal responsibility is localized at acceptance boundaries:

```text
Upstream offer/recommendation
        |
        v
Downstream Agent evaluates
        |
        +--> accepts
        +--> rejects
        +--> accepts only part
        +--> chooses another provider
```

This reverses the intuitive “push causality” view in which a sender is imagined to determine the downstream result.

## 4. How the paper applies this to LLM Agents

Burgess analyzes an Agent architecture containing a user, an AI Agent/integrator, an external LLM, and tools/services.

The causal sequence is roughly:

1. The Agent has an intended function and sends desired outcomes/context to an LLM service.
2. The Agent independently accepts the user's request and current context.
3. The LLM independently accepts the prompt and produces a response/recommendation.
4. The Agent receives the LLM output and independently decides whether to use it.
5. If a tool is selected, the Agent requests its service.
6. The tool independently accepts or rejects access according to its own interface/access-control promises.
7. The Agent receives tool results and independently accepts, rejects, or interprets them.
8. The Agent may update context and continue the loop.

The important claim is that an LLM recommendation does not execute itself. The Agent integrator chooses whether and how to act upon it. Likewise, a tool is not forced to comply merely because a request arrived.

The paper therefore places substantial responsibility on the Agent integrator for what it accepts from the LLM and which tools it activates, while also discussing the responsibility of the owner/operator and the end user's decision to use the system.

## 5. Trust in the paper

Burgess treats trust as a downstream assessment of promise keeping over time.

A receiver can evaluate whether a provider historically delivered what it advertised. Poor history can cause the receiver to increase scrutiny or choose a redundant/fallback provider.

This is important for H2A2H because trust is evidence for selection and monitoring, not authority. A trustworthy Agent still needs valid Capability/Delegation to perform a protected Action.

## 6. Distributed causality

The paper also points out that causal ordering becomes technically difficult when Agents aggregate information from several concurrent sources.

This is directly relevant to multi-Agent systems. A decision can converge from several independently produced observations:

```text
Inventory.AssessAvailability ----\
Financials.AssessCashFlow --------+--> Business.OptimizeProfitability
Marketing.AssessDemand -----------/
```

There may be no single linear “parent”. H2A2H therefore represents this convergence as `causal_events[]`.

A compact semantic view is:

```text
causal_events = [
  inventory.intent,
  financial.intent,
  marketing.intent
]
```

The persistent form also keeps the unique event occurrence so repeated executions of the same Intent remain distinguishable.

## 7. What the paper does not solve by itself

The paper supplies a causal/responsibility theory, not a complete interoperable Agent protocol.

It does not itself standardize:

- Agent identity encoding;
- mTLS identity binding;
- Capability artifacts;
- delegated authority schemas;
- proof-of-possession;
- exact Intent envelopes;
- receiver acceptance receipts;
- event-store schemas;
- Action authorization;
- Human-return evidence;
- machine-checkable protocol invariants;
- a standard API for external Agents.

These are the engineering layers H2A2H adds.

# H2A2H solution

## 8. Identity: who actually participated?

Every Human, Agent, Service, Device, or Organization has a stable semantic Entity reference independent of IP address, process ID, container, or TLS session.

For an Agent, H2A2H separates:

```text
Entity identity
Runtime/process identity
Certificate/key identity
Capability/delegation identity
Intent identity
Actor coordination identity
Action/effect identity
```

This lets an audit answer which Agent decided, which Actor coordinated, and which Action affected external state.

## 9. Authority: authentication is not permission

H2A2H explicitly separates:

```text
mTLS             -> who is connected / protected channel
Capability       -> what this Agent may request/perform
Proof-of-Possession -> whether this presenter owns the bound key
Intent           -> what semantic outcome is being proposed
Local Acceptance -> whether the receiver chooses to participate
VAAL             -> whether this exact consequential Action may happen now
```

This separation is the protocol equivalent of the paper's autonomy principle.

## 10. External Agents: standard API boundary

H2A2H defines a standard external Agent boundary in `spec/external-agent-api.md`.

An external Agent cannot simply call an endpoint and thereby command another Agent. A request passes independent gates:

```text
mTLS
 -> Agent identity binding
 -> Capability validation
 -> Proof-of-Possession
 -> Intent validation
 -> receiver-local policy
 -> ACCEPT | REJECT | DEFER | PARTIAL | CHALLENGE
 -> VAAL Action authorization when necessary
 -> effect
 -> receipt/attestation
```

Even HTTP `200` does not mean “the Agent obeyed”. Transport success and autonomous acceptance are distinct protocol facts.

## 11. `causal_events`: semantic causal graph

H2A2H records the events/Intents that contributed to a new decision using `causal_events[]`.

Normative form:

```yaml
causal_events:
  - event_id: event:inventory:01J...
    intent:
      intent_id: intent:inventory:01J...
      canonical_label: Inventory.AssessAvailability
      version: 1.0.0
    relation: evidence
  - event_id: event:financial:01J...
    intent:
      intent_id: intent:financial:01J...
      canonical_label: Financials.AssessCashFlow
      version: 1.0.0
    relation: evidence
```

Why keep both fields?

- `event_id` identifies the concrete occurrence.
- `intent` explains what that occurrence meant semantically.

This is more precise than a generic `parent_id` and more auditable than storing only a semantic label.

## 12. Event Sourcing as a responsibility ledger

For each material decision/effect, H2A2H can append a `ResponsibilityEnvelope` to Event Sourcing.

The ledger can preserve:

```text
root Intent
causal_events
Agent identity
Actor identity
Action identity
Capability/delegation
policy hash
local acceptance decision
input/output hashes
ActionReceipt
attestation
Human boundary
```

This makes causal reconstruction possible without requiring disclosure of an LLM's private chain-of-thought.

The system records the semantic evidence necessary to explain the execution boundary, not hidden reasoning tokens.

## 13. Agent / Actor / Action responsibility in AllasCode

H2A2H maps cleanly to the AllasCode A3 model:

```text
Agent  -> decided which Intent/Behavior to pursue
Actor  -> coordinated execution and Event Sourcing
Action -> produced the narrow external effect
```

Therefore a later investigation does not have to collapse all responsibility into “the Agent”. It can ask separately:

- Did the Agent accept the causal inputs?
- Was its Capability valid?
- Which policy version allowed the decision?
- Did the Actor preserve idempotency/ordering?
- Was the exact Action authorized?
- What effect did the Action actually produce?

## 14. `UnaccountedEffect`

H2A2H introduces an explicit failure class:

```text
UnaccountedEffect
```

An effect may technically succeed while failing the responsibility protocol.

Example:

```text
payment sent successfully
BUT
no valid Capability/ActionMandate/causal path exists
```

The system can distinguish:

```text
technical_success
semantic_success
authorized_success
accounted_success
```

In a high-assurance environment, only `accounted_success` is fully successful.

## 15. Human responsibility boundaries

H2A2H does not require Human approval for every Agent decision.

Instead, policy defines `ResponsibilityBoundary` rules based on risk/domain:

```text
LOW       -> autonomous
MEDIUM    -> autonomous + immutable audit
HIGH      -> autonomous + Human notification
CRITICAL  -> Human acceptance before effect
```

When Human approval is required, VAAL binds approval to the exact ActionCommitment so a later material change cannot reuse stale authorization.

After execution, Proof-of-Human-Return can prove that the result/control reached the required Human boundary.

Pre-effect Human acceptance and post-effect PoHR are different causal events.

## 16. Choreography rather than Agent commands

AllasCode/H2A2H should model ordinary autonomous Agent cooperation through events:

```text
Inventory.StockRiskDetected
        |
        +--> PurchasingAgent accepts -> evaluates purchase Intent
        +--> MarketingAgent ignores/rejects
        +--> FinancialAgent accepts -> evaluates cash-flow Intent
```

The event does not order any Agent to act. Each Agent reacts because its own Intent, Behavior, policy, current state, and Capability make the event relevant.

This is a direct engineering expression of the autonomy/downstream reasoning in the paper.

## 17. Legal interpretation

H2A2H does **not** claim that a cryptographic causal graph automatically determines legal liability.

The graph can provide stronger evidence for questions such as:

- which Entity accepted which information;
- what authority was active;
- what policies were in force;
- what Action crossed the execution boundary;
- what external system accepted the effect;
- whether Human approval was required and obtained;
- whether the result returned to a Human;
- whether any material effect lacks a valid provenance path.

Courts, regulators, contracts, organizational law, negligence standards, product liability rules, and jurisdiction still determine legal consequences.

The H2A2H contribution is to make the technical causal history significantly less ambiguous.

## 18. Formal property

For every policy-defined accountable effect `e`:

```text
forall e in Effects_accountable:
    exists P: Intent ~> causal_events* ~> e
```

If the system cannot reconstruct a valid path containing the required identity, authority, acceptance, authorization, and evidence boundaries, it MUST classify the effect as unaccounted under the selected governance profile.

The TLA+ projection is defined in:

- `formal/H2A2H-Responsibility.tla`
- `formal/H2A2H-Responsibility.cfg`

## 19. Resulting architecture

The combined model is:

```text
Human Intent
   |
   v
Agent identity + Capability
   |
   v
IntentProposal
   |
   v
Receiver-local acceptance
   |
   v
Behavior / Actor coordination
   |
   v
VAAL Action authorization
   |
   v
Action effect
   |
   v
ActionReceipt + Attestation
   |
   v
Event Sourcing / causal_events graph
   |
   v
Result + Proof-of-Human-Return
```

The main consequence is that autonomy is no longer an obstacle to accountability. Autonomy becomes an explicit series of independently evidenced decision boundaries.