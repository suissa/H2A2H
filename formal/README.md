# H2A2H Formal Models

H2A2H maintains separate machine-checkable projections for lifecycle/delegation and causal responsibility.

## Core lifecycle model

`H2A2H.tla` models the protocol lifecycle, delegation scope/depth, authority expiry/revocation, responsibility preservation, Human return, acknowledgement, and terminal-state stability.

| Formal invariant | Normative concept |
| --- | --- |
| `DelegationScopeMonotonicity` | Derived authority MUST be a subset of provider/effective authority. |
| `DelegationDepthBounded` | Delegation maximum depth. |
| `ResponsibilityPreserved` | Initiating accountability boundary remains represented. |
| `NoExecutionWithoutAuthority` | Expired/revoked authority cannot authorize execution. |
| `HumanReturnBeforeClose` | `CLOSED` requires Proof-of-Human-Return. |
| `AcknowledgementImpliesReturn` | Human acknowledgement cannot exist without Human return. |
| `TerminalIsStable` | Terminal lifecycle states do not resume through ordinary transitions. |

Run with:

```text
java -cp tla2tools.jar tlc2.TLC -config formal/H2A2H.cfg formal/H2A2H.tla
```

## Causal responsibility model

`H2A2H-Responsibility.tla` projects the autonomous external-Agent boundary described by:

- `spec/responsibility-causal-provenance.md`
- `spec/external-agent-api.md`

The model intentionally distinguishes technical effects from accounted effects. An externally observed effect can be classified `unaccounted` when no valid H2A2H authority/provenance path exists.

| Formal invariant | Normative concept |
| --- | --- |
| `AccountedEffectRequiresAuthentication` | Accounted effects require authenticated identity/channel evidence. |
| `AccountedEffectRequiresCapability` | Accounted effects require valid bounded Capability. |
| `AccountedEffectRequiresPoP` | Capability presentation is sender-bound by proof-of-possession. |
| `AccountedEffectRequiresIntent` | Execution occurs only for a validated semantic Intent. |
| `AccountedEffectRequiresLocalAcceptance` | Downstream autonomous receiver must independently accept. |
| `AccountedEffectRequiresActionAuthorization` | Consequential Action authorization precedes accounted effect. |
| `AccountedEffectRequiresCausalEvents` | Accounted effects retain at least one semantic causal event in this finite model. |
| `HumanBoundaryPreserved` | Policy-required Human acceptance cannot be bypassed. |
| `EffectAccountedOrClassified` | Every observed effect is either accounted or explicitly unaccounted. |
| `UnaccountedIsNotAccounted` | Protocol cannot claim accountability for an unaccounted effect. |

`RaiseTrust` deliberately leaves `authorityEpoch` and `capabilityValid` unchanged, projecting the rule that trust history does not manufacture or widen authority.

Run with:

```text
java -cp tla2tools.jar tlc2.TLC -config formal/H2A2H-Responsibility.cfg formal/H2A2H-Responsibility.tla
```

## Relationship to runtime

The TypeScript runtime is not the source of truth for these invariants. Runtime tests, JSON Schemas, protocol specifications, and TLA+ models are separate projections that SHOULD remain mutually traceable.
