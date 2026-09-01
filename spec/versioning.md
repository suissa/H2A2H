# Protocol Versioning and Compatibility

Status: Normative draft for H2A2H v1.0.

H2A2H uses explicit semantic versions for protocol, schema, Intent, channel, security, and proof artifacts. Implementations MUST NOT infer compatibility from deployment date or implementation version.

## Version form

Normative versions use `MAJOR.MINOR.PATCH`.

- MAJOR: incompatible semantic/protocol change;
- MINOR: backwards-compatible capability/optional extension;
- PATCH: backwards-compatible correction that does not change normative meaning.

## Protocol compatibility

Peers with the same MAJOR version MAY interoperate when the required features/extensions are supported. Different MAJOR versions MUST NOT be assumed compatible and require an explicit bridge/profile.

Minor-version capability differences are resolved through capability negotiation, not by silently ignoring required semantics.

## Schema compatibility

A schema change is backwards-compatible only if artifacts valid under the previous supported contract continue to preserve the same required semantics. Tightening a formerly valid required field/value or changing field meaning is breaking unless introduced under a new major/versioned schema reference.

## Extensions

Extensions MUST be namespaced and classified as:

- optional/non-critical: may be ignored by implementations that do not understand them;
- critical: MUST be understood or the artifact/interaction is rejected with `version.extension_unsupported`.

An optional extension MUST NOT change the meaning of core required fields.

## Deprecation

Deprecation SHOULD include:

- first deprecated version;
- replacement/migration path;
- earliest removal major version;
- conformance fixture covering deprecated behavior while still supported.

## Negotiation

A peer/channel advertisement MAY expose exact versions or ranges such as `1.x`. Runtime negotiation MUST select a concrete mutually supported version before semantic processing across a remote boundary.

Negotiation failures are protocol outcomes, not opaque transport failures.

## Deterministic errors

- `version.invalid`
- `version.major_incompatible`
- `version.no_common_version`
- `version.extension_unsupported`
- `version.feature_required`
- `version.schema_incompatible`

## Invariants

1. Breaking semantics require a major transition or explicit bridge.
2. Unknown optional extensions cannot redefine core semantics.
3. Unknown critical extensions cause rejection.
4. Negotiated version is recorded in audit/provenance.
5. Intent/schema/channel versions remain explicit even when their numbers match the H2A2H protocol version.
