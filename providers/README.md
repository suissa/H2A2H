# Employee Provider Packs

Provider Packs connect reusable H2A2H Employee Tool capabilities to concrete provider implementations.

They are deliberately below the Employee Agent and capability layers:

```text
Employee Agent contract
        ↓ selects
Semantic capability
        ↓ resolved by
EmployeeToolRegistry
        ↓ implemented by
Provider Pack
        ↓ invokes
Enterprise system / service
```

A Provider Pack does **not** grant authority. It cannot extend OpenDelegation, approve an action, add capabilities to an Employee Agent, or select transport on behalf of role code. It only supplies implementations for already-declared capabilities.

## Manifest

Each pack exposes a machine-readable `manifest.json` with:

- `canonical_label`: stable Provider Pack identity;
- `version`: semantic version;
- `domain`: capability domain such as `finance`, `engineering`, or `commerce`;
- `provider_kind`: `in-memory`, `http-json`, `mcp`, or `injected`;
- `capabilities`: exact canonical capability identities implemented by the pack;
- `config_schema`: non-secret runtime configuration contract;
- `secrets`: declared secret names and whether each is required;
- `runtime`: network and protocol requirements.

## Runtime invariants

1. Every capability in a pack must already exist in `EmployeeToolRegistry`.
2. Every capability must belong to the pack's declared domain.
3. The capability must permit the pack's provider kind.
4. Configuration and secrets fail closed when missing, undeclared, or incorrectly typed.
5. Only one active pack may own a capability at a time unless an explicit future routing policy defines otherwise.
6. Provider binding never changes delegation, Human approval, audit/provenance, responsibility-chain, or PoHR rules.
7. Employee role code never branches on vendor or provider implementation.

`providers/reference-commerce/manifest.json` is the reference pack used by conformance tests for the five Personal Shopper `commerce.*` capabilities.
