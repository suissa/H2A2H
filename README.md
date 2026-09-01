# H2A2H

**Human-to-Agent-to-Human** is a protocol model for digital interactions in which agents do not exist in isolation: every delegated action remains inside an explicit chain of authority, responsibility, provenance and eventual Human return.

H2A2H v1.0 separates semantic intent, delegated authority, transport declaration and Human-return proof so an Agent can participate without embedding hidden transport or authorization logic in domain behavior.

## v1.0 normative artifacts

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

## Implementations

The repository intentionally contains two implementations.

### Reference Implementation A

The TypeScript implementation under [`src/`](./src) provides the canonical reference SDK/runtime, including lifecycle execution, delegation sessions, security primitives, Human-in-the-Healing-Loop, audit provenance, protocol registry, SDK facade and transport/channel forger.

### Independent Reference Implementation B

[`independent/reference-b`](./independent/reference-b) is deliberately implemented without importing the runtime under `src/`. It exists to prove that H2A2H interoperability follows from the specification and schemas rather than shared implementation internals.

The interoperability suite exercises A→B and B→A over direct serialized H2A2H JSON and HTTP request/reply.

## Protocol composition

A complete interaction composes four independent concerns:

1. **OpenIntent** declares what is intended, its semantic identity, schemas, roles and communication requirements.
2. **OpenDelegation** declares what authority was granted, by whom, to whom, for what scope and for how long.
3. **OpenEntityChannels** declares how participating Entities can communicate. Agents do not choose transports procedurally inside domain behavior.
4. **Proof-of-Human-Return (PoHR)** proves that the interaction reached the intended Human boundary and distinguishes transport delivery from Human presentation/acknowledgement.

The H2A2H envelope carries correlation, causation, identity, delegation and responsibility references across those layers.

## Conformance

Requirements: Node.js 22 or newer.

```sh
npm install
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
- basic Human→Agent→Agent→Human E2E;
- Organization, Service, Device and Government Entity scenarios;
- protocol-version negotiation;
- independent Reference A↔B interoperability.

After the H2A2H Conformance CI succeeds on `main`, the release workflow checks whether the package version already has an immutable Git tag. For a new version it reruns the release gate, typecheck, build, conformance suite and dependency audit, creates `v<version>` at the validated commit, generates a machine-readable conformance report and publishes the GitHub Release with that report attached.

## Examples

Normative protocol examples are under [`examples/`](./examples). Executable H2A2H scenarios are under [`src/examples/`](./src/examples).

## v1.0 release criteria

v1.0 requires a complete normative specification and schemas, passing reference and independent implementations, bidirectional interoperability, PoHR, responsibility-chain preservation, security/audit semantics, E2E scenarios and green CI/release gates. See [`release/v1.0.0.md`](./release/v1.0.0.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
