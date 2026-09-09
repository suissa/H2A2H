import assert from 'node:assert/strict';
import test from 'node:test';
import { H2A2HSDK } from '../sdk.js';

const bindings = {
  resolveIntent: async () => ({ canonical_label: 'Test.Intent', version: '1.0.0' }),
  validateDelegation: async () => { throw new Error('simulated worker crash'); },
  resolveParticipants: async () => ({ participants: [] }),
  resolveChannel: async () => ({ profile: 'test' }),
  execute: async () => ({ ok: true }),
  returnToHuman: async () => ({ proof_ref: 'proof:test', return_state: 'human_presented' }),
};

test('SDK recovers a non-terminal interaction from its canonical checkpoint', async () => {
  const sdk = new H2A2HSDK(bindings as never);
  const request = {
    interaction_id: 'interaction:recovery-test',
    correlation_id: 'correlation:recovery-test',
    initiating_human: { entity_id: 'human:test', kind: 'Human' },
    intent: { canonical_label: 'Test.Intent', version: '1.0.0' },
    input: { value: 1 },
  };
  await assert.rejects(() => sdk.run(request), /simulated worker crash/);
  const checkpoint = await sdk.getInteraction(request.interaction_id);
  assert.equal(checkpoint?.state, 'INTENT_CAPTURED');

  const recovered = await sdk.recover(request.interaction_id);
  assert.equal(recovered.state, 'CLOSED');
});
