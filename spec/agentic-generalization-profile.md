# H2A2H Agentic Generalization Profile v1

Status: normative draft.

This profile generalizes reusable architectural primitives from the Agentic Commerce Protocol (ACP) into domain-independent H2A2H semantics. It does not claim invention of ACP Discovery, Capability Negotiation, Extensions, Payment Handlers, Intent Traces, or delegated authentication. H2A2H reuses their architectural patterns while changing the semantic unit from commerce-specific checkout/payment objects to Entity, Intent, Action, capability, authorization, state transition, and receipt artifacts.

## 1. Prior-art mapping

| ACP concept | H2A2H generalization |
|---|---|
| Discovery | Entity Discovery |
| Capability Negotiation | Semantic Capability Negotiation |
| Extensions Framework | Semantic Extension Framework |
| Payment Handler | Capability/Action Handler |
| Intent Trace | Intent Transition Trace |
| Delegate Authentication lifecycle | Challenge / Intervention lifecycle |
| AP2 Open Mandate | VAAL DelegationMandate |
| AP2 closed/action mandate | VAAL ActionMandate |
| checkout-bound state | ActionCommitment |
| transaction receipt | ActionReceipt |

The ACP RFCs remain the authoritative source for ACP behavior. This document defines H2A2H behavior only.

## 2. Canonical semantic identity

The common vocabulary across discovery, negotiation, extensions, authorization, handlers, execution, traces, and receipts is `canonical_label`.

Examples:

```text
health.records.share
education.course.enroll
government.license.renew
infrastructure.production.deploy
```

A transport name, implementation class, URL, queue, topic, or process name MUST NOT substitute for a semantic `canonical_label`.

## 3. Entity Discovery

An Entity MAY publish a cacheable public discovery document at:

```text
/.well-known/h2a2h.json
```

Discovery answers stable pre-flight questions:

- which H2A2H versions are supported;
- which transports are exposed;
- which semantic capabilities are available;
- which extensions and handlers may be used;
- where human and machine-readable specifications are located.

Discovery is descriptive and MUST NOT be treated as authorization.

```text
capability advertised != authority granted
```

Agent entities MAY reference or embed compatible A2A Agent Card data. Non-Agent Entities are represented by the H2A2H Entity profile and MUST NOT be forced into the Agent type.

## 4. Semantic Capability Negotiation

Session/context negotiation resolves:

```text
RequesterCapabilities
∩ ProviderCapabilities
∩ IntentRequirements
∩ AuthorizationRequirements
∩ ContextConstraints
= NegotiatedCapabilitySet
```

Required capabilities missing from the intersection make the negotiation incompatible.

Negotiation MUST be deterministic for semantically equivalent declarations independent of input ordering.

The reference implementation computes:

- `requester_capabilities_hash`;
- `provider_capabilities_hash`;
- `requirements_hash`;
- `negotiation_hash`.

The selected negotiation hash SHOULD be bound into the subsequent `ActionCommitment`. This prevents a participant from silently changing the negotiated security or execution profile after authorization.

## 5. Semantic Extensions

Extensions are semantic before they are structural.

```yaml
canonical_label: health.fhir.consent
extends:
  - health.records.share
version: 1.0.0
schema: https://example.org/schema.json
spec: https://example.org/spec
```

An extension MAY also define JSON/JSON-Schema projection paths, but physical schema locations do not define semantic identity.

Extensions SHOULD use stable namespaced identifiers, independent versions, machine-readable schemas, and lifecycle states such as draft, experimental, stable, deprecated, and retired.

Unknown optional extensions MAY be ignored only when they do not alter authorization or core semantics. Unknown critical extensions MUST fail closed.

## 6. Capability/Action Handlers

Handlers make implementation bindings self-describing without changing the semantic Action.

A handler declares:

- stable handler identity;
- semantic capability it implements;
- version;
- human-readable specification;
- configuration schema;
- input/output schemas;
- supported channels;
- required authorization profiles;
- provider-specific configuration.

Example relation:

```text
health.records.share
        ↓
health.records.fhir.r4
        ↓
provider-specific handler configuration
```

An Agent should implement a handler specification once and use it with any conforming provider instance.

## 7. Generic lifecycle

The profile resolves the reusable ACP/AP2 patterns into the following domain-independent lifecycle:

```text
Entity Discovery
  -> Capability Negotiation
  -> Extension Resolution
  -> Handler Resolution
  -> OpenIntent
  -> OpenDelegation
  -> VAAL ActionCommitment
  -> VAAL ActionMandate
  -> ALLOW | DENY | CHALLENGE
  -> Execution Boundary
  -> ActionReceipt
  -> Intent Transition Trace when semantically relevant
```

`OpenEntityChannels` determines communication. Negotiation MAY select compatible channel profiles, but authorization semantics MUST remain transport-independent.

## 8. Challenge / Intervention

A verifier may return `CHALLENGE` instead of `ALLOW` or `DENY` when the current evidence is insufficient but the operation can become valid after additional evidence.

Examples:

- Human confirmation;
- WebAuthn/passkey proof;
- OpenID4VP credential presentation;
- professional credential;
- second approver;
- parental authorization;
- hardware-backed proof;
- fresh state commitment.

The challenge MUST remain bound to the same `ActionCommitment` unless the challenge explicitly requires a new commitment.

For Human interaction, the implementation SHOULD bind:

```text
provider proposal
= presented_hash
= Human-authorized commitment
= executed commitment
```

Proof-of-Human-Return remains the H2A2H mechanism for proving that control/result returned to the required Human endpoint.

## 9. Intent Transition Trace

An Intent Trace generalizes ACP cancellation traces into structured reasons for semantic lifecycle transitions.

Examples include:

```text
EXECUTING -> HUMAN_ESCALATION_REQUIRED
EXECUTING -> HEALING_REQUIRED
EXECUTING -> REJECTED
HEALING_REQUIRED -> EXECUTING
```

A trace contains a semantic reason `canonical_label`, optional failed constraints, minimal structured metadata, alternative availability, and an explicit disclosure policy.

Traces MUST NOT become an uncontrolled free-text telemetry channel for personal or confidential information.

## 10. Security invariants

1. Discovery MUST NOT confer authority.
2. Negotiation MUST NOT widen delegated authority.
3. Required security capabilities MUST fail closed when absent.
4. A negotiated capability set SHOULD be cryptographically bound before execution.
5. Extensions MUST NOT bypass VAAL, OpenDelegation, security profiles, or Proof-of-Human-Return.
6. Handlers MUST NOT change the semantic meaning of their declared capability/Action.
7. A challenge MUST NOT be interpreted as authorization.
8. Intent traces MUST NOT alter authoritative state by themselves.
9. Transport fallback MUST NOT weaken negotiated security requirements.
10. `canonical_label` is semantic identity; implementation identifiers remain replaceable projections.

## 11. Reference implementation

The TypeScript reference implementation is provided by:

- `src/capability-negotiation.ts`;
- `src/vaal.ts`;
- `src/intent-trace.ts`.

The machine-readable artifact bundle is:

- `schemas/h2a2h-agentic-generalization-v1.schema.json`.

The implementation is a projection of these semantics, not their definition.
