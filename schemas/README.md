# H2A2H Schemas

`h2a2h-v1.schema.json` is the normative JSON Schema 2020-12 bundle for H2A2H v1 artifacts.

Individual artifacts are addressable by fragment:

- `#/$defs/entityRef`
- `#/$defs/responsibilityChain`
- `#/$defs/envelope`
- `#/$defs/openIntent`
- `#/$defs/openDelegation`
- `#/$defs/openEntityChannels`
- `#/$defs/proofOfHumanReturn`
- `#/$defs/auditRecord`
- `#/$defs/escalationRecord`

Schema evolution follows the protocol compatibility rules. A breaking semantic or validation change requires a major schema/protocol transition. Optional backwards-compatible fields may be introduced only where the schema and specification explicitly permit extension.

Normative examples and conformance fixtures MUST validate against the matching `$defs` entry, not only against syntactic YAML/JSON parsing.
