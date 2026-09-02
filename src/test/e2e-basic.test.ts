import test from 'node:test';
import assert from 'node:assert/strict';
import { runBasicH2A2HScenario } from '../examples/basic-e2e.js';

test('Human -> Agent -> Agent -> Human scenario closes with PoHR and valid audit', async () => {
  const result = await runBasicH2A2HScenario();
  assert.equal(result.context.state, 'CLOSED');
  assert.ok(result.pohr);
  assert.equal(result.pohr.return_state, 'human_acknowledged');
  assert.equal(result.pohr.target_human.entity_id, 'human:bob');
  assert.deepEqual(result.audit_verification, { valid: true });
  assert.ok(result.audit.some((record) => record.event === 'h2a2h.lifecycle.authority_validated'));
  assert.ok(result.audit.some((record) => record.event === 'h2a2h.lifecycle.human_returned'));
  assert.ok(result.audit.some((record) => record.event === 'h2a2h.lifecycle.closed'));
});

test('revoked Human delegation becomes a semantic HumanRequired interaction without execution or PoHR', async () => {
  const result = await runBasicH2A2HScenario({ revoke_before_run: true });
  assert.equal(result.context.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(result.context.human_escalation?.code, 'delegation.revoked');
  assert.equal(result.context.human_escalation?.resume_state, 'INTENT_CAPTURED');
  assert.equal(result.context.human_escalation?.human_action.canonical_label, 'Human.Delegation.Provide');
  assert.equal(result.context.result, undefined);
  assert.equal(result.context.human_return, undefined);
  assert.equal(result.pohr, undefined);
  assert.deepEqual(result.audit_verification, { valid: true });
});
