import test from 'node:test';
import assert from 'node:assert/strict';
import { runBasicH2A2HScenario } from '../examples/basic-e2e.js';

 test('Human -> Agent -> Agent -> Human scenario closes with PoHR and valid audit', async () => {
  const result = await runBasicH2A2HScenario();
  assert.equal(result.context.state, 'CLOSED');
  assert.equal(result.pohr.return_state, 'human_acknowledged');
  assert.equal(result.pohr.target_human.entity_id, 'human:bob');
  assert.deepEqual(result.audit_verification, { valid: true });
  assert.ok(result.audit.some((record) => record.event === 'h2a2h.lifecycle.authority_validated'));
  assert.ok(result.audit.some((record) => record.event === 'h2a2h.lifecycle.human_returned'));
  assert.ok(result.audit.some((record) => record.event === 'h2a2h.lifecycle.closed'));
});

test('revoked Human delegation prevents the same scenario from executing', async () => {
  await assert.rejects(
    () => runBasicH2A2HScenario({ revoke_before_run: true }),
    /Delegated authority could not be validated/,
  );
});
