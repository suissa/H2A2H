# Changelog

## Unreleased

### Agentic generalization

- Added Entity Discovery and deterministic semantic Capability Negotiation derived from reusable ACP architectural patterns.
- Added negotiation hashes that can be bound into consequential ActionCommitments to prevent post-authorization capability/security downgrade.
- Added Semantic Extensions and self-describing Capability/Action Handler resolution.
- Added the Verifiable Action Authorization Layer (VAAL) with DelegationMandate, ActionCommitment, ActionMandate, `ALLOW`/`DENY`/`CHALLENGE` decisions and ActionReceipt.
- Added deterministic constraint enforcement, temporal attenuation, audience binding, proof hooks and atomic replay-consumption requirements.
- Added Human challenge binding over the exact ActionCommitment and semantic Intent Transition Traces.
- Added machine-readable JSON Schema and executable conformance tests for the new primitives.
- Documented ACP/AP2 concepts explicitly as prior art and compatibility inputs rather than H2A2H inventions.

## 1.0.0 — 2026-09-01

First stable H2A2H protocol release.

### Protocol

- Defined Human-to-Agent-to-Human terminology, Entity roles and responsibility invariants.
- Defined the canonical H2A2H interaction lifecycle and transport-neutral message envelope.
- Integrated OpenIntent as the semantic declaration layer.
- Defined OpenDelegation for bounded, revocable and machine-verifiable delegated authority.
- Defined OpenEntityChannels for declarative transport/channel capabilities.
- Defined Proof-of-Human-Return to distinguish transport delivery from Human presentation and acknowledgement.
- Defined identity, responsibility-chain, security, audit/provenance and protocol-versioning semantics.
- Defined MCP and A2A bridge mappings without implicitly widening H2A2H delegated authority.

### Reference implementation

- Added strict TypeScript H2A2H runtime and SDK.
- Added delegation-session enforcement, replay protection and cryptographic proof primitives.
- Added Human-in-the-Healing-Loop recovery.
- Added append-only digest-chained audit provenance.
- Added in-memory and HTTP adapters plus injectable drivers for WebSocket, SSE, gRPC, QUIC, NATS and MCP profiles.

### Verification

- Added JSON Schema 2020-12 normative artifact schemas.
- Added conformance tests for schemas, lifecycle, delegation, replay protection, audit, channel behavior and versioning.
- Added executable Human→Agent→Agent→Human and multi-Entity E2E scenarios.
- Added a TLA+ model of core lifecycle/delegation/responsibility invariants.
- Added an independent Node ESM Reference Implementation B with no shared runtime code.
- Added bidirectional Reference A↔B interoperability tests over direct JSON and HTTP.
- Added CI, dependency auditing, tag-driven release automation and machine-readable conformance reports.
