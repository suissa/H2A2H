# H2A2H Formal Model

`H2A2H.tla` is the machine-checkable model of the protocol core. `H2A2H.cfg` configures TLC to explore a finite scope/delegation space and check the invariants.

Mapping to normative specification:

| Formal invariant | Normative concept |
| --- | --- |
| `DelegationScopeMonotonicity` | OpenDelegation child scope MUST be a subset of parent/effective authority. |
| `DelegationDepthBounded` | OpenDelegation maximum delegation depth. |
| `ResponsibilityPreserved` | Responsibility chain always retains the initiating accountability boundary. |
| `NoExecutionWithoutAuthority` | Authority validation precedes authorized execution and expired/revoked authority is invalid. |
| `HumanReturnBeforeClose` | `CLOSED` requires Proof-of-Human-Return. |
| `AcknowledgementImpliesReturn` | Human acknowledgement cannot exist without Human return. |
| `TerminalIsStable` | Terminal lifecycle states cannot resume through ordinary lifecycle transitions. |

The TypeScript runtime is not the source of truth for these invariants. Both runtime tests and the normative specification are expected to project the same rules represented here.

A typical TLC invocation is:

```text
java -cp tla2tools.jar tlc2.TLC -config formal/H2A2H.cfg formal/H2A2H.tla
```

The repository CI may execute this when the TLA+ toolchain is available; the conformance suite separately checks executable runtime projections of the same invariants.
