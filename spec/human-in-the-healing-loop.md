# Human-in-the-Healing-Loop

Status: Normative draft for H2A2H v1.0.

H2A2H treats recoverable invalidity as a resumable protocol condition. Automated healing may transform data only within declared deterministic/reversible rules. When the protocol cannot continue safely without Human knowledge, authority, or choice, the interaction enters Human-in-the-Healing-Loop escalation.

## Escalation causes

At minimum:

- invalid or incomplete payload after automatic healing is exhausted;
- missing/expired authority;
- ambiguous Intent;
- unresolved participant;
- unavailable compatible channel after allowed fallback;
- policy conflict;
- proof validation failure;
- Human confirmation required by delegation/policy.

## State preservation

Escalation MUST preserve:

- `interaction_id` and correlation;
- current lifecycle state and intended resume state;
- original payload/reference;
- transformations already attempted;
- validation failures;
- delegation/responsibility references;
- causation link to the failure that triggered escalation.

A Human correction SHOULD resume the same interaction. A new child interaction is allowed only when explicitly modeled with a parent causation/correlation link.

## Healing plan

A healing plan contains ordered or graph-addressable steps. Every step MUST have a stable semantic label and MUST record whether it was already attempted. Recursive healing MUST detect cycles/repeated states rather than retry indefinitely.

Normalization belongs to validation/healing; domain actions MUST NOT silently normalize semantically invalid input.

## Human correction

Human input MUST be represented as an auditable event. The correction may:

- provide missing data;
- select among ambiguous interpretations;
- grant/refuse/limit renewed authority;
- resolve a policy choice;
- confirm or reject an effect;
- choose cancellation.

Human correction MUST NOT retroactively erase failed attempts from provenance.

## Resume

Before resume, the runtime MUST revalidate the conditions relevant to the resume state. Authority MUST be revalidated at the effect boundary; prior validation cannot be assumed if delegation expired or was revoked while suspended.

## Terminal outcomes

If Human input cannot or does not resolve the condition, policy MAY transition to `CANCELLED`, `EXPIRED`, `REJECTED`, or `FAILED_TERMINAL`. The terminal record MUST preserve the escalation history.

## Invariants

1. Healing MUST NOT invent authority.
2. Healing MUST NOT silently reinterpret a materially different Human choice.
3. Each attempted healing step MUST be recorded.
4. Recursive healing MUST detect repeated attempts/cycles.
5. Human correction MUST be causally linked to the original failure.
6. Resume MUST continue the same interaction or an explicitly linked child interaction.
7. Authority and policy MUST be revalidated before resumed effects.
