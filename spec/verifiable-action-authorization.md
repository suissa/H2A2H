# H2A2H Verifiable Action Authorization Layer (VAAL) v1

Status: normative draft.

VAAL defines how an Entity proves that a consequential semantic Action may cross an execution boundary on behalf of another Entity.

The core rule is:

> No externally consequential Action SHALL cross an execution boundary without a verifiable, attenuated, context-bound authorization chain whose semantic target is the Action's `canonical_label`.

## 1. Separation of concerns

```text
Authentication -> who is this Entity?
OpenDelegation -> who may act for whom, within which envelope?
OpenIntent -> what outcome is desired?
Capability Negotiation -> what can these participants safely execute together?
VAAL -> may this exact Action happen now?
Execution -> mutate authoritative state
ActionReceipt -> what actually happened?
Proof-of-Human-Return -> did control/result return to the required Human?
```

Authentication MUST NOT be treated as delegated authority.

## 2. Core artifacts

VAAL v1 defines:

- `DelegationMandate` — bounded autonomous authority;
- `ActionCommitment` — canonical semantics of the exact proposed Action;
- `ActionMandate` — authorization for that exact ActionCommitment;
- `ActionReceipt` — verifiable execution evidence.

A challenge is a separate state indicating that additional evidence is required.

## 3. ActionCommitment

`ActionCommitment` binds at least:

- `canonical_action`;
- principal;
- executing Agent;
- provider;
- target resource/entity;
- parameters;
- Intent reference;
- negotiated capability hash;
- current authoritative state hash when state-dependent;
- proposed next-state hash when knowable before execution.

The reference implementation computes `request_hash` over the semantic fields. A change to those fields invalidates the commitment.

The negotiated capability hash is intentionally included. An Agent and Provider MUST NOT authorize under one security/capability profile and execute under another without generating a new ActionCommitment.

## 4. DelegationMandate

A DelegationMandate identifies:

```text
principal
-> delegate
-> allowed semantic Actions
-> constraints
-> validity window
-> optional parent mandate
-> proof
```

Authority MUST attenuate:

```text
Authority(child) subset-or-equal Authority(parent)
```

An ActionMandate MUST NOT outlive its DelegationMandate.

## 5. Constraints

The reference profile supports semantic constraints with:

- `canonical_label`;
- path into the ActionCommitment;
- deterministic operator;
- optional comparison value.

Reference operators are:

```text
equals
one_of
max
min
contains
exists
```

Domain profiles MAY define richer constraint languages, but unknown critical constraints MUST fail closed.

Examples:

```yaml
canonical_label: health.records.allowed-purpose
path: parameters.purpose
operator: one_of
value:
  - treatment
```

```yaml
canonical_label: education.workload.max
path: parameters.hours_per_week
operator: max
value: 8
```

## 6. ActionMandate

An ActionMandate is a closed authorization. It MUST bind:

- principal;
- Agent;
- exact `canonical_action`;
- DelegationMandate hash;
- ActionCommitment hash;
- audience/provider;
- nonce;
- validity window;
- execution-use limit;
- proof reference.

A captured mandate MUST NOT automatically authorize another Action, Agent, provider, request, state, or time window.

## 7. Verification

A conforming verifier performs the logical equivalent of:

```text
1. validate time/freshness
2. validate principal continuity
3. validate Agent continuity
4. validate canonical Action
5. validate delegation scope
6. validate audience
7. validate DelegationMandate binding
8. validate ActionCommitment binding
9. recompute ActionCommitment request hash
10. validate delegation proof
11. validate action proof
12. evaluate all constraints
13. evaluate Human-return/escalation policy
14. atomically consume replay/use allowance
15. ALLOW, DENY, or CHALLENGE
```

Only `ALLOW` may cross the execution boundary.

## 8. Decisions

### ALLOW

All required evidence is valid and the exact Action may execute.

### DENY

The request cannot execute under the supplied authorization chain.

Examples:

- expired delegation;
- Action outside scope;
- provider outside audience;
- state/request commitment changed;
- constraint failed;
- invalid proof;
- replay/use allowance exhausted.

### CHALLENGE

The Action is not yet authorized, but may become authorized after additional evidence.

Examples:

- explicit Human approval;
- credential presentation;
- fresh state snapshot;
- second approver;
- replay-consumption infrastructure unavailable.

A challenge MUST NOT be interpreted as partial authorization.

## 9. Human confirmation binding

When Human authorization is required, the Human-facing challenge SHOULD cryptographically bind the exact ActionCommitment presented to the Human.

The desired invariant is:

```text
H(provider proposal)
= H(Agent-presented semantics)
= H(Human-authorized semantics)
= ActionMandate.action_commitment_hash
= H(executed semantics)
```

Any material semantic change requires a new commitment and, where applicable, a new Human authorization.

## 10. Replay resistance

A conforming consequential execution MUST have a durable atomic consumption boundary for mandate use.

The implementation MUST NOT perform replay protection as a non-atomic `check -> execute -> mark` sequence when concurrent execution is possible.

The reference implementation exposes a `consume(mandateId, nonce, maxUses)` binding. Production implementations SHOULD back this with durable compare-and-set, unique constraints, transactional storage, or equivalent atomic semantics.

## 11. ActionReceipt

After consequential execution, the executor/verifier SHOULD produce an ActionReceipt binding:

- verifier;
- executor;
- principal;
- Agent;
- `canonical_action`;
- ActionMandate hash;
- ActionCommitment hash;
- execution time;
- result/result hash;
- before/after state hashes when available.

Receipts SHOULD be signed or otherwise included in a tamper-evident H2A2H audit chain.

## 12. Integration with H2A2H lifecycle

The canonical H2A2H runtime lifecycle is extended conceptually as:

```text
INTENT_CAPTURED
-> AUTHORITY_VALIDATED
-> PARTICIPANTS_RESOLVED
-> CHANNEL_BOUND
-> CAPABILITIES_NEGOTIATED
-> ACTION_COMMITTED
-> ACTION_AUTHORIZED
-> EXECUTING
-> ACTION_RECEIPTED
-> RETURN_PENDING
-> HUMAN_RETURNED
-> CLOSED
```

Existing v1 lifecycle implementations MAY represent the intermediate VAAL stages as auditable sub-states/events without changing the public top-level state enum until the next lifecycle version.

## 13. Domain profiles

VAAL is domain-independent. Profiles SHOULD reuse existing domain standards rather than duplicate them.

Examples:

- commerce: AP2/UCP-compatible bindings;
- health: FHIR Consent and healthcare credentials;
- education: W3C VC/Open Badges/CLR-compatible credentials;
- government: jurisdiction-specific identity/authority credentials;
- enterprise: organizational delegation and approval policy;
- DevOps: commit/environment/policy-bound deployment authorization;
- IoT: device/action/time/location-bound authorization.

## 14. Reference implementation

Normative TypeScript projection:

- `src/vaal.ts`

Normative machine-readable profile:

- `schemas/h2a2h-agentic-generalization-v1.schema.json`

Conformance coverage:

- `src/test/vaal.test.ts`
