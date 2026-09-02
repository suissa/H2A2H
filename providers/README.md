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
Provider Pack manifest
        ↓ interpreted by generic provider driver
Enterprise system / service
```

A Provider Pack does **not** grant authority. It cannot extend OpenDelegation, approve an action, add capabilities to an Employee Agent, or select transport on behalf of role code. It only supplies implementations for already-declared capabilities.

## Manifest

Each pack exposes a machine-readable `manifest.json` with:

- `canonical_label`: stable Provider Pack identity;
- `version`: semantic version;
- `domain`: the pack's organizational/integration domain, such as `finance`, `engineering-it`, or `commerce`;
- `capability_domains`: optional explicit semantic namespaces implemented by a cross-domain pack. When omitted, it defaults to `[domain]`;
- `provider_kind`: `in-memory`, `http-json`, `mcp`, or `injected`;
- `capabilities`: exact canonical capability identities implemented by the pack;
- `binding`: provider binding metadata when the provider kind is declarative;
- `recovery`: provider-side recovery guarantee used only after a fenced Tool execution is reclaimed;
- `config_schema`: non-secret runtime configuration contract;
- `secrets`: declared secret names and whether each is required;
- `runtime`: network and protocol requirements.

The distinction between `domain` and `capability_domains` is intentional. A real organizational integration may span multiple truthful semantic namespaces. For example, the Engineering/IT pack owns the organizational domain `engineering-it` while implementing both `engineering.*` and `observability.*`. The protocol does not rename `observability.query` merely to fit the integration boundary.

## Recovery contract

Recovery safety is semantic configuration, not a constructor flag hidden in deployment code:

```json
{
  "recovery": {
    "mode": "provider-idempotency",
    "profile": "h2a2h://recovery/provider-idempotency/acme-commerce/v1"
  }
}
```

Supported modes are:

- `none`: the provider makes no claim that a recovered side effect can be invoked again safely. A missing `recovery` field normalizes to `none` for compatibility;
- `provider-idempotency`: the provider contract guarantees deduplication for the stable H2A2H `idempotency_key` and MUST declare a semantic `profile` describing that mechanism;
- `reconciliation`: the provider can reconcile an uncertain previous side effect before/while recovering and MUST declare a semantic `profile` identifying that reconciliation contract.

The mere presence of an HTTP `Idempotency-Key` header is **not** a recovery guarantee. H2A2H only retries a reclaimed side effect when the active Provider Pack explicitly declares `provider-idempotency` or `reconciliation`. Read-only capabilities may be retried after lease recovery without such a guarantee.

All official external/reference packs explicitly declare their truthful recovery mode. Packs without a proven provider guarantee use `mode: none`.

## Declarative HTTP+JSON binding

For `provider_kind: http-json`, `binding` is the runtime source of truth:

```json
{
  "binding": {
    "routes": {
      "finance.erp.read": "/v1/finance/erp/read"
    },
    "authorization": {
      "type": "bearer",
      "secret": "api_token"
    },
    "config_headers": {
      "tenant_id": "x-h2a2h-tenant-id"
    }
  }
}
```

`routes` must match the pack's capability list exactly. Authorization must reference a secret declared by the same manifest. `config_headers` may only reference declared non-secret configuration properties. The generic HTTP provider derives routing, authorization, extra headers and recovery mode exclusively from this manifest.

The HTTP adapter also propagates runtime-derived execution metadata (`execution_id`, `idempotency_key`, recovery/fencing metadata) without allowing the caller or role code to manufacture those identities.

This means a new HTTP Provider Pack does not require a new runtime adapter or a switch/case. A domain-specific TypeScript export, when retained for compatibility, is only an alias for the generic declarative factory and contains no provider behavior.

## Runtime invariants

1. Every capability in a pack must already exist in `EmployeeToolRegistry`.
2. Every capability must belong to one of the pack's declared `capability_domains` (or `domain` when the list is omitted).
3. The capability must permit the pack's provider kind.
4. HTTP routes must exactly cover the declared capabilities.
5. HTTP authorization may reference only a declared secret.
6. HTTP config-to-header mappings may reference only declared config properties.
7. Configuration and secrets fail closed when missing, undeclared, or incorrectly typed.
8. `provider-idempotency` and `reconciliation` require an explicit semantic recovery profile; `none` may not claim one.
9. The provider created by a factory must expose the same recovery mode declared by the manifest.
10. Recovered side effects fail closed unless the provider declares `provider-idempotency` or `reconciliation`.
11. Only one active pack may own a capability at a time unless an explicit future routing policy defines otherwise.
12. Provider binding never changes delegation, Human approval, audit/provenance, responsibility-chain, or PoHR rules.
13. Employee role code never branches on vendor or provider implementation.

Reference manifests:

- `providers/reference-commerce/manifest.json`: in-memory pack with no recovery guarantee;
- `providers/reference-commerce-idempotent-http-json/manifest.json`: explicit provider-idempotency contract example;
- `providers/reference-commerce-reconciliation-mcp/manifest.json`: explicit reconciliation contract example.
