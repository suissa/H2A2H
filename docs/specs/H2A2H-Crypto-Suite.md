# H2A2H Crypto Suite v0.1

Status: Stable profile v0.1 for the pre-1.0 protocol line. It remains subject
to the independent H2A2H v1 security review.

## 1. Scope

This profile defines language-neutral bytes, algorithm identifiers, domain
separation and verification rules for H2A2H DAGs. It does not define PKI,
hardware key custody, transport TLS, authorization policy or a post-quantum
signature profile.

The suite identifier is `h2a2h.crypto-suite.v0.1`. Implementations MUST reject
unknown suite identifiers; they MUST NOT silently negotiate a weaker suite.

## 2. Binary and text encoding

- Text is UTF-8 without a byte-order mark.
- Binary values in JSON use unpadded base64url from RFC 4648 section 5.
- Integers used by this document are non-negative safe JSON integers.
- Secret inputs SHOULD be mutable byte buffers so implementations can wipe
  caller-owned memory after use.
- A JSON string containing a secret MUST NOT be used where a byte input is
  available.

## 3. Canonical JSON

`h2a2h.canonical-json.v1` accepts the I-JSON-compatible value domain: null,
booleans, strings, finite JSON numbers, dense arrays and plain objects.
Implementations MUST reject undefined values, non-finite numbers, sparse or
decorated arrays, accessors, hidden/symbol properties, cycles, unpaired Unicode
surrogates and host-language objects. Negative zero serializes as `0`; object
keys sort lexicographically by UTF-16 code units; serialization then uses the
ECMAScript JSON representation. JSON decoders MUST reject duplicate member
names before constructing the value passed to canonicalization.

All digest and signature inputs below are the UTF-8 bytes of this canonical
serialization. No transport formatting, whitespace or object insertion order
may affect the result. This profile follows the interoperable constraints of
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), while deliberately failing
closed on non-plain host-language values.

## 4. Root Identity material

Root Identity secret material is derived with Argon2id version `0x13` using the
second recommended profile in RFC 9106:

| Parameter | Value |
| --- | ---: |
| Memory | 65,536 KiB |
| Iterations | 3 |
| Parallelism | 4 |
| Salt | at least 16 bytes; unique per Root Identity |
| Output | 32 bytes |

The secret input MUST contain at least 16 bytes and SHOULD contain at least 32
bytes of high-entropy material. Human-memorable input requires an explicit
recovery and rate-limiting policy; Argon2id does not turn a weak password into a
high-entropy identity.

The 32-byte output is secret Root Identity material, not a public identifier.
It MUST NOT be logged, transported as identity metadata or used directly for
multiple algorithms. Child keys are derived through section 5. A public Entity
identity SHOULD bind to the resulting public key or credential under the
deployment identity profile.

## 5. Child-key derivation

Child keys use HKDF-SHA-256 from RFC 5869. The input key material is the Root
Identity material. Salt is at least 16 bytes. Output is 16–64 bytes. `info` is
the UTF-8 canonical JSON encoding of:

```json
{
  "context": "<deployment-specific stable context>",
  "purpose": "<signing|encryption|proof|other registered purpose>",
  "suite": "h2a2h.crypto-suite.v0.1"
}
```

Purpose and context MUST be non-empty and MUST distinguish algorithm, Entity,
key generation/version and operational use. One derived key MUST NOT be reused
for a different purpose.

## 6. DAG identities

Artifact and branch identities use BLAKE3 with 32-byte output and BLAKE3 derive
key mode.

Artifact input is canonical JSON of:

```json
{"artifact":"<value>","domain":"h2a2h.crypto.artifact.v0.1"}
```

with context `H2A2H 2026-09-09 artifact-id v0.1`. Its external form is:

`h2a2h:artifact:blake3-256:<base64url digest>`

Branch input is canonical JSON containing `domain`, `parent_id`,
`canonical_label`, `ordinal` and `state`, with domain
`h2a2h.crypto.branch.v0.1` and context
`H2A2H 2026-09-09 branch-id v0.1`. Its external form is:

`h2a2h:branch:blake3-256:<base64url digest>`

Changing any parent, semantic label, ordinal or state MUST produce a different
branch identity. BLAKE3 identities are not signatures and confer no authority.

## 7. SHA-256 interoperability

SHA-256 is the mandatory digest inside the signed crypto envelope because it is
widely available in HSMs, WebCrypto and protocol stacks. The identifier is
`sha-256`, output is 32 bytes and JSON representation is unpadded base64url.

BLAKE3-derived IDs and SHA-256 payload digests are intentionally distinct. An
implementation MUST NOT accept one algorithm's output under the other's
identifier.

## 8. Signed crypto envelope

The envelope contains exactly `protected`, `payload_digest`, `signature` and
`payload`. The protected header contains exactly:

- suite and canonical serialization identifiers;
- digest and signature algorithm identifiers;
- `key_id`, `issuer`, `artifact_id` and semantic `purpose`;
- canonical `created_at` and nullable `expires_at` instants.

`payload_digest` is SHA-256 over canonical payload bytes. The Ed25519 signature
is calculated over canonical JSON of:

```json
{"payload_digest":{"algorithm":"sha-256","value":"..."},"protected":{"...":"..."}}
```

The payload itself is verified against `payload_digest`. This two-step binding
protects all authority-critical metadata and avoids signing transport-specific
representations. Unknown or extra fields fail validation.

A verifier MUST validate structure and exact algorithms, canonical time,
expiry, expected issuer/key/artifact/purpose, payload digest and signature. It
MUST then apply trust-anchor, revocation, authorization and replay policy. A
valid signature alone grants no authority.

## 9. Algorithm agility and post-quantum transition

Ed25519 is mandatory in v0.1. Hybrid post-quantum signatures are reserved for a
future suite identifier and MUST bind the same protected signing input. A
future suite cannot reinterpret v0.1 algorithm identifiers or downgrade to one
component after negotiating a hybrid profile.

## 10. Conformance

Conforming implementations MUST reproduce
[`test-vectors/h2a2h-crypto-suite-v0.1.json`](../../test-vectors/h2a2h-crypto-suite-v0.1.json),
validate envelopes against the published JSON Schema, and reject every
protected-header, payload, digest, signature, time and extra-field mutation in
the conformance suite.

Normative references: [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648),
[RFC 5869](https://www.rfc-editor.org/rfc/rfc5869),
[RFC 8032](https://www.rfc-editor.org/rfc/rfc8032),
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), and
[RFC 9106](https://www.rfc-editor.org/rfc/rfc9106).
