# H2A2H Schemas

The standalone [`h2a2h-crypto-suite-v0.1.schema.json`](./h2a2h-crypto-suite-v0.1.schema.json) defines the exact signed crypto-envelope field set and algorithm identifiers.

`h2a2h-v1.schema.json` is the normative JSON Schema 2020-12 bundle for the original H2A2H v1 core artifacts.

Individual core artifacts are addressable by fragment, including:

- `#/$defs/entityRef`
- `#/$defs/responsibilityChain` — compatibility/linear projection; see `spec/identity-responsibility.md` for the canonical responsibility DAG semantics
- `#/$defs/envelope`
- `#/$defs/openIntent`
- `#/$defs/openDelegation`
- `#/$defs/openEntityChannels`
- `#/$defs/proofOfHumanReturn`
- `#/$defs/auditRecord`
- `#/$defs/escalationRecord`

## External Agent and causal-responsibility extension

[`h2a2h-external-agent-api-v1.schema.json`](./h2a2h-external-agent-api-v1.schema.json) is the normative extension schema for:

- external Agent Capability artifacts;
- `IntentProposal`;
- receiver-local `IntentDecision`;
- semantic `causal_events[]` references;
- `ResponsibilityEnvelope`.

The extension schema intentionally separates semantic causal references from Capability/delegation provider ancestry.

Schema evolution follows the protocol compatibility rules. A breaking semantic or validation change requires a major schema/protocol transition. Optional backwards-compatible fields may be introduced only where the schema and specification explicitly permit extension.

Normative examples and conformance fixtures MUST validate against the matching schema or `$defs` entry, not only against syntactic YAML/JSON parsing.
