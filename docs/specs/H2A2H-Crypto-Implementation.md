# H2A2H Crypto Suite v0.1 Implementation Guide

## Production boundary

The TypeScript module `src/crypto-suite.ts` is an executable interoperability
reference. Production deployments SHOULD place Argon2id and private-key
operations behind a provider backed by a reviewed native library, OS keystore,
HSM or isolated cryptographic service. The application-facing provider must
return the exact bytes defined by the suite.

The reference uses Node.js crypto for SHA-256 and Ed25519 and
`@noble/hashes` for Argon2id, BLAKE3 and HKDF. The upstream project states that
its Argon2 and BLAKE3 implementations were outside its 2022 independent audit
scope and warns that JavaScript cannot guarantee constant-time execution. This
is acceptable for reproducible vectors, not evidence of production key-custody
fitness.

## Integration sequence

1. Decode JSON with duplicate-member rejection and external binary values with
   strict unpadded base64url.
2. Validate exact schema and size limits before expensive cryptography.
3. Resolve the declared suite without fallback.
4. Canonicalize the payload and protected header.
5. Verify time and caller expectations.
6. Recompute SHA-256 and verify Ed25519.
7. Resolve trust/revocation and delegated authorization.
8. Atomically accept replay identity before any side effect.
9. Persist the verified canonical envelope and decision evidence.

## Secret handling

- Generate unique salts with a cryptographically secure RNG.
- Never use the committed test-vector keys.
- Prefer mutable byte buffers; wipe secret, Root and child-key buffers in a
  `finally` block where the runtime permits.
- Never serialize Root Identity or child-key material into logs, exceptions,
  traces, events or H2A2H envelopes.
- Apply bounded concurrency around Argon2id to avoid memory-exhaustion attacks.
- Version every child-key context and retain old public keys for historical
  verification according to revocation policy.

## Compatibility

Do not substitute similarly named algorithms. Argon2i/d, padded base64, BLAKE2,
raw BLAKE3 mode, SHA-512, pre-hashed Ed25519 variants and locale-dependent JSON
are not v0.1-compatible.

The legacy `h2a2h.security.signed-ed25519.v1` helper now signs its profile,
key ID, algorithm, creation time, payload digest and payload together. Evidence
created by the older payload-only implementation must be treated as pre-v0.1
legacy evidence and reissued or verified only under an explicit migration
policy; it MUST NOT pass the v0.1 crypto-envelope verifier.

## Verification commands

```sh
npm ci
npm run typecheck
npm run conformance
npm run crypto:vectors
npm audit --audit-level=high
```

`crypto:vectors` prints the deterministic vector candidate. Reviewers compare
it byte-for-byte with the committed JSON; the conformance test performs the
same comparison and mutation rejection automatically.
