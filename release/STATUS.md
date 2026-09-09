# H2A2H Release Status

## Current protocol status

| Field | Value |
| --- | --- |
| Stable release | Not yet declared |
| Current implementation line | `0.9.x` |
| Target protocol specification | `1.0.0` draft |
| Reference Implementation A | `0.9.0` |
| Independent Reference Implementation B | `0.9.0` |
| Conformance | Passing on `main` |
| Final readiness | Blocked by unchecked promotion gates |

## Definition of Done evidence

The implementation already demonstrates the following candidate-v1
capabilities with two implementations that do not share runtime code:

The release evidence demonstrates:

- Human-originated delegated authority with explicit scope, expiry and revocation;
- transport-neutral H2A2H envelope and declarative Entity channels;
- responsibility-chain preservation across participant handoffs;
- Proof-of-Human-Return generation;
- append-only audit/provenance reconstruction;
- strict schema and lifecycle conformance;
- Human-in-the-Healing-Loop recovery semantics;
- bidirectional Reference A ↔ Reference B interoperability;
- interoperability over direct serialized JSON and HTTP request/reply;
- executable Human→Agent→Agent→Human and multi-Entity scenarios;
- protocol-version compatibility rules and formal lifecycle/delegation invariants;
- successful release gate, typecheck, build, conformance suite and dependency audit.

## Premature historical release

The GitHub release and tag `v1.0.0`, created on 2026-09-01 at
`6aaa84a1bd2efd7683e362ad20e3acd9c9693510`, were published before the
normative documents left draft status and before later authority/recovery
hardening landed. They are retained as historical evidence and MUST NOT be
described as the final stable H2A2H v1.0.

The approved disposition is to preserve the tag and evidence while marking the
GitHub release **withdrawn** and **prerelease**. The `v1.0.0` identity is
permanently consumed and MUST NOT be reused. The first valid stable package
release will therefore use `v1.0.1` or a later SemVer identity after every
promotion gate passes.

No automation may move, overwrite or delete that tag. The dedicated withdrawal
workflow only updates release metadata and leaves the original commit and
conformance evidence intact.

## Remaining promotion work

The authoritative remaining work is the unchecked section in
[`release/v1.0.0.md`](./v1.0.0.md). Stable release automation also verifies
that GitHub has no open issues or pull requests at the release commit.
