import assert from 'node:assert/strict';
import test from 'node:test';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef, RuntimeBindings } from '../types.js';

interface Input { delegation_ref?: string }
interface Output { ok: true }

const human: EntityRef = { entity_id: 'human:lease-invalid', kind: 'Human' };
const agent: EntityRef = { entity_id: 'agent:lease-invalid', kind: 'Agent' };

const bindings: RuntimeBindings<Input, Output> = {
  resolveIntent: () => ({
    ref: { canonical_label: 'Resume.InvalidRelease', version: '1.0.0' },
    input_schema: 'schema://resume-invalid/input',
    output_schema: 'schema://resume-invalid/output',
  }),
  validateDelegation: (context) => context.input.delegation_ref === 'delegation:valid'
    ? { valid: true, delegation_id: 'delegation:valid' }
    : { valid: false, reason: 'delegation.missing' },
  resolveParticipants: () => ({ sender: agent, receiver: agent, receiving_human: human }),
  resolveChannel: () => ({ profile: 'in-memory' }),
  execute: () => ({ ok: true }),
  returnToHuman: (context) => ({ proof_ref: `pohr:${context.interaction_id}`, return_state: 'human_presented' }),
  validateHumanAction: (_context, action) => ({
    valid: action.evidence.includes('human-proof:valid'),
    evidence: action.evidence,
    reason: 'human.resume.evidence_invalid',
  }),
};

test('rejected Human action releases lease so a later valid retry can resume', async () => {
  const sdk = new H2A2HSDK(bindings);
  const escalated = await sdk.run({
    initiating_human: human,
    interaction_id: 'interaction:lease-invalid-release',
    correlation_id: 'correlation:lease-invalid-release',
    intent: { canonical_label: 'Resume.InvalidRelease' },
    input: {},
  });

  const rejected = await sdk.resume(escalated.interaction_id, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:forged'],
    },
    input: { delegation_ref: 'delegation:valid' },
  });
  assert.equal(rejected.state, 'HUMAN_ESCALATION_REQUIRED');

  const resumed = await sdk.resume(escalated.interaction_id, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:valid'],
    },
    input: { delegation_ref: 'delegation:valid' },
  });
  assert.equal(resumed.state, 'CLOSED');
});
