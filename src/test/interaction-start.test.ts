import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryInteractionCheckpointStore,
  type InteractionCheckpointStore,
} from '../interaction-checkpoint.js';
import { H2A2HRuntimeError } from '../runtime.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef, RuntimeBindings } from '../types.js';

interface Input { value: string }
interface Output { value: string }

const human: EntityRef = { entity_id: 'human:start-owner', kind: 'Human' };
const agent: EntityRef = { entity_id: 'agent:start-worker', kind: 'Agent' };

function bindings(resolveIntent?: RuntimeBindings<Input, Output>['resolveIntent']): RuntimeBindings<Input, Output> {
  return {
    resolveIntent: resolveIntent ?? (() => ({
      ref: { canonical_label: 'Interaction.Start.Example', version: '1.0.0' },
      input_schema: 'schema://interaction-start/input',
      output_schema: 'schema://interaction-start/output',
    })),
    validateDelegation: () => ({ valid: true, delegation_id: 'delegation:start' }),
    resolveParticipants: () => ({ sender: agent, receiver: agent, receiving_human: human }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    execute: (context) => ({ value: context.input.value }),
    returnToHuman: (context) => ({ proof_ref: `pohr:${context.interaction_id}`, return_state: 'human_presented' }),
  };
}

function request(interactionId?: string) {
  return {
    initiating_human: human,
    ...(interactionId ? { interaction_id: interactionId } : {}),
    intent: { canonical_label: 'Interaction.Start.Example' },
    input: { value: 'accepted' },
  };
}

test('generated interaction and correlation identities remain available when omitted by caller', async () => {
  const sdk = new H2A2HSDK(bindings());
  const result = await sdk.run(request());
  assert.match(result.interaction_id, /^interaction:/);
  assert.match(result.correlation_id, /^correlation:/);
  assert.equal(result.state, 'CLOSED');
});

test('existing canonical interaction cannot be restarted', async () => {
  const sdk = new H2A2HSDK(bindings());
  const first = await sdk.run(request('interaction:start-existing'));
  assert.equal(first.state, 'CLOSED');

  await assert.rejects(
    () => sdk.run(request('interaction:start-existing')),
    (error: unknown) => error instanceof H2A2HRuntimeError && error.code === 'interaction.already_exists',
  );
});

test('wrong start claim cannot unlock the active reservation', () => {
  const store = new InMemoryInteractionCheckpointStore<Input, Output>();
  const first = store.claimStart('interaction:start-lease');
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Expected start claim');

  assert.equal(store.releaseStart('interaction:start-lease', 'start-claim:wrong'), false);
  assert.equal(store.claimStart('interaction:start-lease').status, 'conflict');
  assert.equal(store.releaseStart('interaction:start-lease', first.lease.claim_id), true);
  assert.equal(store.claimStart('interaction:start-lease').status, 'claimed');
});

test('resolveIntent failure before first checkpoint releases start claim and permits retry', async () => {
  let attempts = 0;
  const sdk = new H2A2HSDK(bindings(() => {
    attempts += 1;
    if (attempts === 1) throw new Error('intent.registry.temporarily_unavailable');
    return {
      ref: { canonical_label: 'Interaction.Start.Example', version: '1.0.0' },
      input_schema: 'schema://interaction-start/input',
      output_schema: 'schema://interaction-start/output',
    };
  }));

  await assert.rejects(
    () => sdk.run(request('interaction:start-retry')),
    /intent\.registry\.temporarily_unavailable/,
  );
  assert.equal(await sdk.getInteraction('interaction:start-retry'), undefined);

  const retried = await sdk.run(request('interaction:start-retry'));
  assert.equal(retried.state, 'CLOSED');
  assert.equal(attempts, 2);
});

test('SDK fails closed when checkpoint store lacks atomic start admission', async () => {
  const records = new Map<string, unknown>();
  const legacyStore: InteractionCheckpointStore<Input, Output> = {
    save: (context) => { records.set(context.interaction_id, structuredClone(context)); },
    load: () => undefined,
  };
  const sdk = new H2A2HSDK(bindings(), { checkpoint_store: legacyStore });

  await assert.rejects(
    () => sdk.run(request('interaction:start-unsupported')),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError && error.code === 'interaction.start_claim_unsupported',
  );
  assert.equal(records.size, 0);
});
