import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryInteractionCheckpointStore } from '../interaction-checkpoint.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef, RuntimeBindings } from '../types.js';

interface Input {
  delegation_ref?: string;
}

const human: EntityRef = { entity_id: 'human:lease-error', kind: 'Human' };
const agent: EntityRef = { entity_id: 'agent:lease-error', kind: 'Agent' };

const bindings: RuntimeBindings<Input, never> = {
  resolveIntent: () => ({
    ref: { canonical_label: 'Resume.ErrorRelease', version: '1.0.0' },
    input_schema: 'schema://resume-error/input',
    output_schema: 'schema://resume-error/output',
  }),
  validateDelegation: (context) => context.input.delegation_ref === 'delegation:valid'
    ? { valid: true, delegation_id: 'delegation:valid' }
    : { valid: false, reason: 'delegation.missing' },
  resolveParticipants: () => ({ sender: agent, receiver: agent, receiving_human: human }),
  resolveChannel: () => ({ profile: 'in-memory' }),
  execute: () => { throw new Error('provider.failed'); },
  returnToHuman: () => { throw new Error('unreachable'); },
  validateHumanAction: () => ({ valid: true, evidence: ['human-proof:valid'] }),
};

test('runtime failure releases the active resume lease', async () => {
  const store = new InMemoryInteractionCheckpointStore<Input, never>();
  const sdk = new H2A2HSDK(bindings, { checkpoint_store: store });
  const escalated = await sdk.run({
    initiating_human: human,
    interaction_id: 'interaction:lease-error-release',
    correlation_id: 'correlation:lease-error-release',
    intent: { canonical_label: 'Resume.ErrorRelease' },
    input: {},
  });

  await assert.rejects(() => sdk.resume(escalated.interaction_id, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:valid'],
    },
    input: { delegation_ref: 'delegation:valid' },
  }), /provider\.failed/);

  const claim = store.claimResume(escalated.interaction_id);
  assert.equal(claim.status, 'claimed');
  if (claim.status !== 'claimed') throw new Error('Expected lease to be released after failure');
  assert.equal(store.releaseResume(escalated.interaction_id, claim.lease.lease_id), true);
});
