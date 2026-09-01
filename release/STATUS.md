# H2A2H Release Status

## Stable protocol

| Field | Value |
| --- | --- |
| Stable release | `v1.0.0` |
| Protocol specification | `1.0.0` |
| Reference Implementation A | `1.0.0` |
| Independent Reference Implementation B | `1.0.0` |
| Release tag | `v1.0.0` |
| Tagged commit | `6aaa84a1bd2efd7683e362ad20e3acd9c9693510` |
| Conformance | Passed |
| Dependency audit | Passed — 0 vulnerabilities at release time |
| Release date | 2026-09-01 |

## Definition of Done evidence

H2A2H v1.0 satisfies the roadmap Definition of Done with two implementations that do not share runtime implementation code.

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

## Immutable release evidence

Release: https://github.com/suissa/H2A2H/releases/tag/v1.0.0

Conformance report: https://github.com/suissa/H2A2H/releases/download/v1.0.0/conformance-report.json

The `v1.0.0` tag is treated as immutable. Later commits on `main` do not move an already published version tag; a new protocol/reference version requires a new version and tag.

## Roadmap state

Issues #2 through #27 are complete. Issue #1 closes the v1.0 implementation roadmap after this status record is merged and its CI passes.
