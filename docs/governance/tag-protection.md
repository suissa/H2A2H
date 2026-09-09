# Immutable release-tag governance

H2A2H release identities are permanent. The repository must have an active
GitHub tag ruleset with this exact effective policy before any stable release:

| Field | Required value |
| --- | --- |
| Name | `H2A2H immutable release tags` |
| Target | Tag |
| Enforcement | Active |
| Include | `refs/tags/v*` |
| Exclude | none |
| Restrict updates | enabled |
| Restrict deletions | enabled |
| Bypass actors | none |

Tag creation remains available to the audited release workflow. After creation,
the tag cannot be moved or deleted. `scripts/verify-tag-ruleset.mjs` performs a
read-only API inspection and the stable-release workflow fails closed unless
the required policy is present.

## Emergency governance

Changing a published tag is not a normal recovery action. Prefer withdrawing
the GitHub Release metadata, publishing a corrected patch version and retaining
the original tag as evidence.

If a legal or repository-compromise incident makes a tag mutation unavoidable:

1. open a security advisory (or a public incident issue when disclosure is
   safe) identifying the exact tag, reason and evidence;
2. obtain an independent maintainer/security-review approval;
3. record the current ruleset JSON and tag object SHA;
4. temporarily add only the named incident operator as a bypass actor;
5. perform the single approved mutation;
6. remove the bypass immediately and rerun the read-only verifier;
7. attach the before/after SHAs, ruleset history and verifier output to the
   incident record.

Disabling or deleting the ruleset, granting a role-wide bypass, or mutating a
tag without this audit trail invalidates stable-release readiness.
