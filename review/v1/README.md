# H2A2H v1 independent review packet

This directory defines the reproducible review boundary required by issue #255.
It does not contain a completed attestation. Only a reviewer independent of the
repository owner may provide `attestation.json` and approve its review pull
request.

## Reviewer procedure

1. Review every path in `scope.json`, including normative prose, schemas, formal
   model, Crypto Suite and deterministic vectors.
2. Run `npm ci`, `npm run conformance`, `npm run release:gate` and any additional
   adversarial checks.
3. Record every finding in `attestation.json` with severity, concrete evidence,
   disposition and conformance tests for semantic corrections.
4. Keep the decision `rejected` while any critical/high finding is unresolved.
5. Submit the attestation and all required corrections in a pull request.
6. Reviewers other than the repository owner approve the exact PR head after
   its final change.
7. After merge, run `npm run release:independent-review`; it recomputes the
   scoped digest and verifies the named GitHub approval through the API.

Removing a draft marker is a reviewed semantic promotion. It must occur in the
review PR, never before the reviewer has accepted that artifact. Any later
change to a scoped artifact changes the digest and invalidates the attestation.

## Evidence contract

The final `attestation.json` must validate against
`schemas/h2a2h-v1-review-attestation.schema.json`. The repository owner cannot
self-attest. Critical/high findings must be resolved, and every such semantic
correction must name its executable conformance coverage.

The live verifier additionally requires an `APPROVED` GitHub review authored by
the declared reviewer on the declared pull request and commit. A JSON file alone
is therefore not sufficient evidence of independence.
