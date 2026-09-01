# H2A2H Security Profiles

Status: Normative draft for H2A2H v1.0.

H2A2H separates four questions:

1. **Identity authentication** — who/what is this participant?
2. **Transport protection** — is this channel protected against interception/tampering under the selected profile?
3. **Delegated authorization** — is this participant allowed to perform this Intent/action now?
4. **Proof validation** — can a protocol claim be independently verified?

Satisfying one question MUST NOT be treated as satisfying the others.

## Baseline requirements

All non-local-untrusted profiles MUST provide:

- integrity protection;
- freshness/replay defense;
- explicit participant identity binding;
- explicit delegation validation when authority is required;
- key/credential rotation semantics;
- deterministic proof validation failure codes.

Sensitive payloads SHOULD be encrypted in transit and at rest according to deployment policy.

## Profile negotiation

Peers MAY advertise supported security profiles in OpenEntityChannels. Intent policy MAY define a minimum acceptable profile. Runtime negotiation MUST choose a profile satisfying both peers and Intent/runtime policy.

A fallback MUST NOT select a profile weaker than the required minimum.

## `h2a2h.security.local-trusted.v1`

For explicitly trusted same-process/same-runtime channels only. It MAY omit network cryptography, but delegation, lifecycle, audit, idempotency, and responsibility rules remain mandatory.

It MUST NOT be silently used for remote communication.

## `h2a2h.security.signed-ed25519.v1`

Provides message/proof integrity and issuer authentication using Ed25519 signatures over canonical protocol bytes.

Requirements:

- canonical serialization before signing;
- key identifier/version;
- signature bound to protocol version and artifact contents;
- timestamp/expiry validation;
- replay protection using message/proof identity.

## `h2a2h.security.mtls-dpop.v1`

For remote API/RPC channels requiring mutual TLS and sender-constrained application requests.

Requirements:

- mutually authenticated TLS under deployment PKI/trust policy;
- application request bound to a DPoP-style proof/key;
- request URI/method or transport-equivalent binding where relevant;
- nonce/timestamp/replay validation;
- delegation validated separately from mTLS/DPoP authentication.

Possession of the TLS/DPoP key MUST NOT expand delegated scope.

## `h2a2h.security.webauthn-bound.v1`

For a Human authorization/session derived from a WebAuthn/passkey ceremony.

Requirements:

- verified WebAuthn assertion under relying-party policy;
- explicit binding from authenticated Human/session to the OpenDelegation artifact or authorization event;
- session expiration not later than delegation expiration;
- re-authorization for renewal according to delegation policy.

A WebAuthn login by itself does not authorize arbitrary Agent actions.

## Signed protocol artifacts

Signed artifacts SHOULD include or canonically bind:

- protocol + version;
- artifact/message identity;
- issuer/sender identity;
- timestamp and expiry where applicable;
- delegation/result/payload digest as appropriate;
- correlation/interaction identifiers when the claim is interaction-specific.

## Replay protection

A conforming remote profile MUST reject replay when a message/proof identifier has already been accepted within its replay window, unless the Intent explicitly defines safe idempotent replay semantics.

Replay state MAY be local, distributed, or derived from an append-only event store.

## Key rotation

Keys MAY rotate without changing Entity identity when continuity is verifiable. Protocol evidence SHOULD include `key_id` so historical proofs remain verifiable against the correct key version.

Revoked/compromised keys MUST be rejected according to trust policy. Historical proof treatment after compromise MUST be explicitly defined by the deployment profile.

## Data minimization

Security evidence SHOULD disclose only the attributes needed to validate the claim. Human identity, delegation content, and PoHR evidence MAY use selective/pseudonymous references when the selected profile preserves verifiability.

## Deterministic failures

At minimum:

- `security.profile_unsupported`
- `security.profile_downgrade`
- `security.invalid_signature`
- `security.unknown_key`
- `security.expired`
- `security.replay`
- `security.identity_mismatch`
- `security.channel_authentication_failed`
- `security.human_binding_failed`
- `security.canonicalization_failed`

## Reference implementation note

The repository's cryptographic helpers are interoperability/reference primitives, not an independent security audit or production PKI. Deployments remain responsible for trust anchors, key custody, certificate policy, WebAuthn relying-party policy, secret storage, and operational incident response.
