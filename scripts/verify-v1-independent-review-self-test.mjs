import assert from 'node:assert/strict';
import {
  computeScopeDigest,
  validateLocalAttestation,
} from './verify-v1-independent-review.mjs';

const scopeDigest = await computeScopeDigest();
const valid = {
  schema_version: 1,
  scope_id: 'h2a2h-v1-independent-review',
  scope_digest: scopeDigest,
  reviewer: {
    github_login: 'independent-reviewer',
    independence_statement: 'I reviewed this scope independently and disclose no conflicts.',
    conflicts: [],
  },
  reviewed_at: '2026-09-09T15:00:00Z',
  review_pull_request: 999,
  review_commit_sha: 'a'.repeat(40),
  decision: 'approved',
  findings: [],
};

assert.equal((await validateLocalAttestation(valid, 'suissa')).ok, true);
assert.equal((await validateLocalAttestation({
  ...valid,
  reviewer: { ...valid.reviewer, github_login: 'suissa' },
}, 'suissa')).ok, false);
assert.equal((await validateLocalAttestation({ ...valid, decision: 'rejected' }, 'suissa')).ok, false);
assert.equal((await validateLocalAttestation({ ...valid, scope_digest: `sha256-${'0'.repeat(64)}` }, 'suissa')).ok, false);
assert.equal((await validateLocalAttestation({
  ...valid,
  findings: [{
    id: 'H2A2H-REV-001',
    severity: 'high',
    status: 'open',
    title: 'Example blocker',
    evidence: 'spec/example.md:1',
    resolution: '',
    conformance_tests: [],
  }],
}, 'suissa')).ok, false);

console.log(`Independent review verifier self-test passed (${scopeDigest}).`);
