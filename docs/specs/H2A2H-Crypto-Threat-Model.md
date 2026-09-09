# H2A2H Crypto Suite v0.1 Threat Model

## Protected assets

- Root Identity and child-key material;
- semantic artifact and DAG branch integrity;
- issuer, key, purpose, time and artifact bindings;
- canonical payload integrity and historical verification evidence.

## Adversaries

The profile assumes attackers may read or modify storage and network traffic,
replay valid messages, reorder JSON properties, substitute transport metadata,
inject additional fields, choose weak inputs, exhaust KDF resources, compromise
an adapter, or obtain a revoked key. It also assumes a malicious participant may
present a cryptographically valid request outside delegated authority.

## Required mitigations

| Threat | Required control |
| --- | --- |
| JSON ambiguity | Fail-closed canonical JSON and exact field sets |
| Payload/metadata substitution | Ed25519 over protected header plus SHA-256 digest |
| Cross-protocol/key reuse | Fixed suite IDs and domain-separated HKDF/BLAKE3 contexts |
| Offline Root secret guessing | Argon2id 64 MiB, three passes, unique 128-bit salt, rate limits |
| Replay | Durable atomic replay state keyed by artifact/message identity |
| Expired evidence | Canonical time validation and expiry policy |
| Unknown/revoked key | External trust resolver and revocation state |
| Adapter mutation | Verify the canonical envelope after transport decoding |
| KDF denial of service | Fixed/capped parameters and admission limits before derivation |
| Downgrade | Exact algorithm identifiers and negotiated minimum suite |

## Security boundaries

The suite proves integrity and possession of an Ed25519 private key. It does
not prove that the key belongs to a trusted Entity, that delegation is valid,
that a Human approved an Action, that a side effect is idempotent, or that a
transport is confidential. H2A2H trust, delegation, VAAL, replay, channel and
PoHR checks remain separate mandatory boundaries.

## Compromise consequences

- Root material compromise exposes all child keys derived from that root and
  context set; rotate the Root Identity and revoke descendants.
- Child-key compromise is limited by correct domain separation but still
  requires revocation and replacement of that purpose/version.
- Endpoint compromise can sign malicious artifacts; audit and delegated
  authorization are still required.
- Historical signatures after key compromise require deployment-specific
  trusted timestamps and compromise-window policy.

## Out of scope

This profile does not claim resistance to a fully compromised host, physical
side channels, malicious entropy sources, broken HSM firmware, traffic
analysis, availability attacks, or quantum attacks against Ed25519. A future
hybrid post-quantum suite must be separately specified and reviewed.
