# H2A2H

**Human-to-Agent-to-Human** is a protocol model for digital interactions in which agents do not exist in isolation: every delegated action remains inside an explicit chain of authority, responsibility, provenance and eventual Human return.

**Current status:** pre-1.0 (`0.9.x`) · [Readiness status and evidence](./release/STATUS.md)

H2A2H is targeting v1.0. The normative documents remain drafts until every
known release task is closed and the final readiness gate passes.

## Draft v1.0 normative artifacts

- [Normative Specification](./SPECIFICATION.md)
- [Normative JSON Schema bundle](./schemas/h2a2h-v1.schema.json)
- [Terminology and invariants](./spec/terminology.md)
- [Canonical lifecycle](./spec/lifecycle.md)
- [OpenIntent integration](./spec/openintent-integration.md)
- [OpenDelegation Protocol](./spec/opendelegation.md)
- [OpenEntityChannels](./spec/openentitychannels.md)
- [Proof-of-Human-Return](./spec/proof-of-human-return.md)
- [Identity and responsibility chain](./spec/identity-responsibility.md)
- [Canonical message envelope](./spec/envelope.md)
- [Security profiles](./spec/security.md)
- [Audit and provenance](./spec/audit-provenance.md)
- [MCP/A2A interoperability](./spec/interop-mcp-a2a.md)
- [Versioning and compatibility](./spec/versioning.md)
- [Formal model](./formal/H2A2H.tla)

## Agentic generalization profile

The repository also contains a domain-independent generalization of reusable ACP/AP2 architectural patterns:

- [H2A2H Agentic Generalization Profile](./spec/agentic-generalization-profile.md)
- [Verifiable Action Authorization Layer (VAAL)](./spec/verifiable-action-authorization.md)
- [Machine-readable Agentic Generalization schema](./schemas/h2a2h-agentic-generalization-v1.schema.json)

The profile adds Entity Discovery, semantic Capability Negotiation, Semantic Extensions, Capability/Action Handlers, ActionCommitments, bounded ActionMandates, ALLOW/DENY/CHALLENGE authorization decisions, ActionReceipts, and Intent Transition Traces. The shared semantic identity across these artifacts is the Action/capability `canonical_label`.

ACP/AP2 concepts are treated as prior art and compatibility inputs rather than renamed H2A2H inventions. H2A2H generalizes the patterns from commerce-specific participants and checkout/payment state to arbitrary Entities and consequential state transitions.

## Implementations

The repository intentionally contains two implementations.

### Reference Implementation A

The TypeScript implementation under [`src/`](./src) provides the canonical reference SDK/runtime, including lifecycle execution, delegation sessions, security primitives, Human-in-the-Healing-Loop, audit provenance, protocol registry, SDK facade, transport/channel forger, semantic capability negotiation and VAAL authorization primitives.

### Independent Reference Implementation B

[`independent/reference-b`](./independent/reference-b) is deliberately implemented without importing the runtime under `src/`. It exists to prove that H2A2H interoperability follows from the specification and schemas rather than shared implementation internals.

The interoperability suite exercises A→B and B→A over direct serialized H2A2H JSON and HTTP request/reply.

## Protocol composition

A complete interaction composes independent concerns:

1. **OpenIntent** declares what is intended, its semantic identity, schemas, roles and communication requirements.
2. **OpenDelegation** declares what authority was granted, by whom, to whom, for what scope and for how long.
3. **OpenEntityChannels** declares how participating Entities can communicate. Agents do not choose transports procedurally inside domain behavior.
4. **Capability Negotiation** establishes the mutually supported, context-valid capability/security set and binds it with a deterministic negotiation hash.
5. **VAAL** proves whether one exact consequential Action may cross the execution boundary and produces `ALLOW`, `DENY`, or `CHALLENGE`.
6. **Proof-of-Human-Return (PoHR)** proves that the interaction reached the intended Human boundary and distinguishes transport delivery from Human presentation/acknowledgement.

The H2A2H envelope carries correlation, causation, identity, delegation and responsibility references across those layers. Consequential executions may additionally bind an `ActionCommitment`, `ActionMandate`, `ActionReceipt`, and semantic `IntentTrace` into the audit chain.

## Conformance

Requirements: Node.js 22 or newer.

```sh
npm ci
npm run typecheck
npm run conformance
npm run release:gate
```

`npm run conformance` builds the reference implementation and runs:

- normative schema fixtures;
- lifecycle transition tests;
- delegation expiration/revocation tests;
- replay protection;
- audit-chain verification;
- channel behavior;
- semantic capability negotiation;
- VAAL ActionCommitment/ActionMandate verification and replay tests;
- basic Human→Agent→Agent→Human E2E;
- Organization, Service, Device and Government Entity scenarios;
- protocol-version negotiation;
- independent Reference A↔B interoperability.

After the H2A2H Conformance CI succeeds on `main`, the release workflow checks
whether the package version already has an immutable Git tag. Pre-1.0 versions
are published as prereleases. A stable version is additionally blocked while
the repository has open issues or pull requests, unchecked release criteria, or
normative documents still marked as drafts.

## Examples

Normative protocol examples are under [`examples/`](./examples). Executable H2A2H scenarios are under [`src/examples/`](./src/examples).

## v1 stable release criteria

The first valid v1 stable release is emitted only when no known work remains:
all normative drafts are promoted, every checklist item is complete, no issue
or pull request is open, the two implementations and interoperability profiles
pass, and the reproducible release gate is green. See
[`release/v1.0.0.md`](./release/v1.0.0.md).

The historical `v1.0.0` identity is withdrawn and will not be reused; the first
valid stable release will be `v1.0.1` or later.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
