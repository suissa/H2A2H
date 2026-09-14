# H2A2H External Agent API Profile

Status: Normative draft for H2A2H v1.0.

This profile defines a standard boundary for external Agents to request participation in an H2A2H interaction without collapsing authentication, access, Capability, Intent, acceptance, and execution into a single API call.

The semantic model is transport-neutral. HTTP is the reference binding. HTTP `POST` means delivery of a protocol artifact; it MUST NOT be interpreted as command authority over the receiver.

## 1. Security and semantic gates

An external Agent request MUST cross the following gates in order:

```text
1. Transport authentication      -> mTLS
2. Agent identity binding        -> certificate/Entity identity
3. Capability validation         -> bounded authority
4. Proof of possession           -> DPoP-style sender binding
5. Intent validation             -> semantic target + version + schema
6. Policy evaluation             -> receiver-local policy
7. Local acceptance              -> ACCEPT | REJECT | DEFER | PARTIAL | CHALLENGE
8. Exact Action authorization    -> VAAL when consequential
9. Execution/effect              -> Action boundary
10. Receipt + attestation        -> what actually happened
11. Causal provenance append     -> causal_events + ResponsibilityEnvelope
```

Passing one gate MUST NOT imply passing another.

In particular:

```text
mTLS != Capability
Capability != Intent
Intent != Acceptance
Acceptance != ActionAuthorization
ActionAuthorization != Effect
```

## 2. External Agent identity

Every external Agent MUST present a stable H2A2H Entity identity independently of network location.

```yaml
agent:
  entity_id: agent:019...
  kind: Agent
  canonical_label: External.SupplierOptimizationAgent
  identity_profile: h2a2h.identity.x509-bound.v1
```

The mTLS client certificate MUST be bound by policy to the presented Agent identity. Certificate rotation MAY preserve `entity_id` only when continuity is verifiable.

## 3. Capability document

A Capability is a bounded, verifiable authorization artifact. It grants the Agent authority to request consideration or execution inside a declared semantic scope.

```yaml
capability:
  capability_id: capability:01J...
  issuer:
    entity_id: org:allascode
  subject:
    entity_id: agent:external-019
  audience:
    entity_id: agent:financial-optimizer
  issued_at: 2026-09-14T00:00:00Z
  expires_at: 2026-09-14T01:00:00Z

  scope:
    intents:
      - Business.OptimizeProfitability
      - Financials.AssessCashFlow
    resources:
      - company:123
    effects:
      - read
      - propose
    max_risk: medium

  constraints:
    max_depth: 0
    human_confirmation_required_for:
      - Financials.Payment.Execute

  proof:
    profile: h2a2h.proof.signed.v1
    key_id: key:issuer:2026-09
    value: "..."
```

Capability scope MUST be positively enumerated and fail closed.

A Capability MAY be derived from OpenDelegation. When both exist, the effective authority is the intersection of all applicable constraints.

## 4. Capability provider ancestry

A derived Capability MUST NOT widen the authority provided by the Capability it references:

```text
EffectiveScope(derived) subset-or-equal EffectiveScope(provider)
```

Authority ancestry uses `provider_capability_id`.

`provider_capability_id` identifies the Capability that provided or issued the authority being attenuated. It MUST NOT be interpreted as a causal parent, object parent, process parent, or command hierarchy.

`provider_capability_id` MUST NOT be used as causal provenance. Causality is represented by `causal_events`.

## 5. Proof of possession

A captured Capability MUST NOT be usable by another Agent merely by copying the bearer artifact.

Remote high-assurance profiles MUST bind requests to a sender-controlled key using DPoP-style proof-of-possession.

The PoP proof SHOULD bind:

- Agent identity;
- capability ID/digest;
- HTTP method and target URI or transport-equivalent semantic endpoint;
- request/envelope digest;
- nonce;
- timestamp;
- proof key identifier/thumbprint.

The receiver MUST reject replay and sender/capability mismatch deterministically.

## 6. IntentProposal

The standard external request artifact is `IntentProposal`.

```yaml
protocol: h2a2h
version: 1.0.0
kind: intent_proposal
message_id: msg:01J...
interaction_id: interaction:01J...
correlation_id: corr:01J...

sender:
  entity_id: agent:external-019
  kind: Agent
receiver:
  entity_id: agent:financial-optimizer
  kind: Agent

intent:
  intent_id: intent:optimize:01J...
  canonical_label: Business.OptimizeProfitability
  version: 1.0.0

capability:
  capability_id: capability:01J...
  digest: sha256:...

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
  - event_id: event:marketing:01J...
    intent:
      intent_id: intent:marketing:01J...
      canonical_label: Marketing.AssessDemand
      version: 1.0.0
    relation: evidence

payload:
  schema: schema://business/optimize-profitability/input/1
  value: {}

timestamp: 2026-09-14T00:00:00Z
expires_at: 2026-09-14T00:05:00Z
```

The semantic shorthand for the causal set is:

```text
causal_events = [inventory.intent, financial.intent, marketing.intent]
```

Persisted records SHOULD preserve the concrete `event_id` as well as the Intent reference.

## 7. Receiver-local acceptance

After authenticating and authorizing the sender, the receiver MUST still independently decide whether to accept the proposed Intent.

The canonical response is `IntentDecision`:

```yaml
kind: intent_decision
interaction_id: interaction:01J...
proposal_message_id: msg:01J...
decision: ACCEPT
receiver:
  entity_id: agent:financial-optimizer
intent:
  intent_id: intent:optimize:01J...
policy:
  policy_id: policy:financial-optimizer:v7
  policy_hash: sha256:...
reason_code: policy.allowed
accepted_scope:
  intents:
    - Business.OptimizeProfitability
attestation_ref: proof:decision:01J...
timestamp: 2026-09-14T00:00:01Z
```

Decision semantics:

- `ACCEPT` — receiver accepts the proposed Intent under the returned scope.
- `REJECT` — receiver refuses it; no effect follows from that proposal.
- `DEFER` — receiver cannot decide yet; no partial authority is created.
- `PARTIAL` — receiver accepts a strict semantic subset; the subset MUST be explicit and auditable.
- `CHALLENGE` — additional proof, state, credential, or Human evidence is required.

## 8. Consequential Actions

Acceptance of an Intent does not authorize arbitrary effects.

Before a consequential Action crosses an execution boundary, the receiver MUST apply VAAL:

```text
IntentProposal
-> IntentDecision(ACCEPT)
-> ActionCommitment
-> ActionMandate
-> ALLOW
-> Effect
-> ActionReceipt
```

A material change to the ActionCommitment invalidates prior authorization.

## 9. HTTP reference binding

### 9.1 Discovery

```http
GET /.well-known/h2a2h/agent-card
```

Returns the receiver's stable Entity identity, supported protocol versions, supported security profiles, accepted Intent namespaces, Capability requirements, channels, and schema links.

Discovery MUST NOT itself grant authority.

### 9.2 Submit IntentProposal

```http
POST /h2a2h/v1/interactions
Content-Type: application/h2a2h+json
DPoP: <proof>
```

The request MUST use mTLS for profiles requiring mutual authentication.

The body is the canonical H2A2H `IntentProposal`.

A successful HTTP transport response means only that the protocol artifact was processed. It MUST NOT be interpreted as `ACCEPT` unless the body contains a valid `IntentDecision` with that decision.

### 9.3 Interaction state

```http
GET /h2a2h/v1/interactions/{interaction_id}
```

Returns the protocol-visible interaction state, latest decision, proof references, and result/receipt references permitted by policy.

### 9.4 Evidence/challenge response

```http
POST /h2a2h/v1/interactions/{interaction_id}/evidence
```

Carries additional proof material requested by `CHALLENGE`. It does not bypass the original Capability/Intent constraints.

### 9.5 Event delivery

```http
POST /h2a2h/v1/events
```

Carries semantic events. Event delivery MUST preserve the same autonomy rule: delivery is observation, not command.

## 10. Standard error/rejection codes

At minimum:

```text
external_agent.mtls_required
external_agent.identity_mismatch
external_agent.capability_missing
external_agent.capability_invalid
external_agent.capability_expired
external_agent.capability_scope_denied
external_agent.pop_missing
external_agent.pop_invalid
external_agent.pop_replay
external_agent.intent_unknown
external_agent.intent_version_unsupported
external_agent.intent_schema_invalid
external_agent.policy_denied
external_agent.human_confirmation_required
external_agent.action_authorization_required
external_agent.causal_event_invalid
```

Errors MUST distinguish transport/authentication failure from semantic rejection.

## 11. Causal provenance at the API boundary

Every accepted proposal SHOULD append a causal decision event containing:

- proposal `message_id`;
- sender Agent identity;
- Capability reference;
- Intent reference;
- receiver policy hash;
- local decision;
- `causal_events`;
- proof/attestation reference.

Every consequential effect MUST append or reference its `ActionReceipt` and ResponsibilityEnvelope.

## 12. Access equation

A receiver may conceptualize an external request as:

```text
Access(A, R, I, C, K, T) =
    mTLS(A)
    AND IdentityBound(A)
    AND CapabilityValid(C, A, R, I, T)
    AND PoPValid(K, A, C, Request)
    AND IntentValid(I)
```

`Access = true` means the request may reach receiver-local policy/acceptance evaluation. It does **not** mean the Intent must be accepted.

```text
Execute(I) =
    Access(...)
    AND LocalPolicyAllows(I)
    AND LocalAcceptance(I)
    AND ExactActionAuthorized(I)
```

## 13. Zero-Trust rule

Every request MUST be evaluated on its own evidence. Prior successful interaction, trusted network location, high trust score, or a valid mTLS session MUST NOT silently widen Capability scope.

Trust MAY reduce provider-selection uncertainty or increase/decrease scrutiny. Trust MUST NOT manufacture authority.

## 14. Invariants

1. `mTLS` authenticates the channel/peer but does not grant semantic authority.
2. Capability scope is explicit, bounded, expiring, revocable, and attenuating.
3. Proof-of-possession binds a request to the Agent actually presenting the Capability.
4. Intent is explicit and versioned.
5. Receiver-local acceptance is mandatory for autonomous execution.
6. HTTP status success does not imply Intent acceptance or H2A2H lifecycle completion.
7. Consequential effects require VAAL authorization.
8. `causal_events` remains distinct from Capability/delegation provider ancestry.
9. Every accepted/effected transition is auditable.
10. Transport bindings do not redefine the semantic protocol.