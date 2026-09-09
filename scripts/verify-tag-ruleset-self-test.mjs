import assert from 'node:assert/strict';
import { evaluateTagProtection } from './verify-tag-ruleset.mjs';

const valid = {
  id: 254,
  name: 'H2A2H immutable release tags',
  target: 'tag',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
  rules: [{ type: 'deletion' }, { type: 'update' }],
};

assert.equal(evaluateTagProtection([valid]).ok, true);
assert.equal(evaluateTagProtection([{ ...valid, enforcement: 'evaluate' }]).ok, false);
assert.equal(evaluateTagProtection([{
  ...valid,
  conditions: { ref_name: { include: ['refs/tags/release-*'], exclude: [] } },
}]).ok, false);
assert.equal(evaluateTagProtection([{ ...valid, rules: [{ type: 'deletion' }] }]).ok, false);
assert.equal(evaluateTagProtection([{ ...valid, bypass_actors: [{ actor_type: 'RepositoryRole' }] }]).ok, false);
assert.equal(evaluateTagProtection([{
  ...valid,
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: ['refs/tags/v1.0.0'] } },
}]).ok, false);

console.log('Tag ruleset verifier self-test passed.');
