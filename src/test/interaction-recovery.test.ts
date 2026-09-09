import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryInteractionCheckpointStore } from '../interaction-checkpoint.js';
import { H2A2HRuntime, H2A2HRuntimeError } from '../runtime.js';
import { H2A2HSDK } from '../sdk.js';
import type {
  InteractionContext,
  LifecycleState,
  RuntimeBindings,
} from '../types.js';

type Input = { value: number };
type Result = { ok: boolean };

const resumableCases: ReadonlyArray<readonly [LifecycleState, string[]]> = [
  ['INTENT_CAPTURED', ['validateDelegation', 'resolveParticipants', 'resolveChannel', 'execute', 'returnToHuman']],
  ['AUTHORITY_VALIDATED', ['resolveParticipants', 'resolveChannel', 'execute', 'returnToHuman']],
  ['PARTICIPANTS_RESOLVED', ['resolveChannel', 'execute', 'returnToHuman']],
  ['CHANNEL_BOUND', ['execute', 'returnToHuman']],
  ['EXECUTING', ['recoverExecution', 'returnToHuman']],
  ['RETURN_PENDING', ['returnToHuman']],
  ['HUMAN_RETURNED', []],
];

function checkpoint(state: LifecycleState, suffix = state.toLowerCase()): InteractionContext<Input, Result> {
  return {
    interaction_id: `interaction:recovery:${suffix}`,
    correlation_id: `correlation:recovery:${suffix}`,
    state,
    initiating_human: { entity_id: 'human:test', kind: 'Human' },
    intent: {
      ref: { canonical_label: 'Test.Intent', version: '0.9.0' },
      input_schema: 'schema:test:input',
      output_schema: 'schema:test:output',
    },
    input: { value: 1 },
    transitions: [],
  };
}

function runtimeBindings(calls: string[]): RuntimeBindings<Input, Result> {
  return {
    resolveIntent: async () => ({
      ref: { canonical_label: 'Test.Intent', version: '0.9.0' },
      input_schema: 'schema:test:input',
      output_schema: 'schema:test:output',
    }),
    validateDelegation: async () => {
      calls.push('validateDelegation');
      return { valid: true, evidence: [] };
    },
    resolveParticipants: async () => {
      calls.push('resolveParticipants');
      return {
        sender: { entity_id: 'agent:sender', kind: 'Agent' },
        receiver: { entity_id: 'agent:receiver', kind: 'Agent' },
        receiving_human: { entity_id: 'human:test', kind: 'Human' },
      };
    },
    resolveChannel: async () => {
      calls.push('resolveChannel');
      return { profile: 'test' };
    },
    execute: async () => {
      calls.push('execute');
      return { ok: true };
    },
    recoverExecution: async () => {
      calls.push('recoverExecution');
      return { ok: true };
    },
    returnToHuman: async () => {
      calls.push('returnToHuman');
      return { proof_ref: 'proof:test', return_state: 'human_presented' };
    },
  };
}

for (const [state, expectedCalls] of resumableCases) {
  test(`runtime recovers canonical ${state} checkpoint without replaying completed stages`, async () => {
    const calls: string[] = [];
    const recovered = await new H2A2HRuntime(runtimeBindings(calls)).recover(checkpoint(state));
    assert.equal(recovered.state, 'CLOSED');
    assert.deepEqual(calls, expectedCalls);
  });
}

test('runtime fails closed at EXECUTING without explicit reconciliation', async () => {
  const bindings = runtimeBindings([]);
  delete bindings.recoverExecution;
  await assert.rejects(
    () => new H2A2HRuntime(bindings).recover(checkpoint('EXECUTING')),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError
      && error.code === 'interaction.recover.execution_reconciliation_required',
  );
});

test('runtime rejects terminal and non-resumable checkpoints deterministically', async () => {
  const runtime = new H2A2HRuntime(runtimeBindings([]));
  for (const state of ['CLOSED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FAILED_TERMINAL'] as const) {
    await assert.rejects(
      () => runtime.recover(checkpoint(state)),
      (error: unknown) =>
        error instanceof H2A2HRuntimeError
        && error.code === 'interaction.recover.terminal_state',
    );
  }
  for (const state of ['CREATED', 'ACKNOWLEDGED', 'HEALING_REQUIRED', 'HUMAN_ESCALATION_REQUIRED', 'SUSPENDED'] as const) {
    await assert.rejects(
      () => runtime.recover(checkpoint(state)),
      (error: unknown) =>
        error instanceof H2A2HRuntimeError
        && error.code === 'interaction.recover.unsupported_checkpoint',
    );
  }
});

test('SDK recovers a non-terminal interaction from its canonical checkpoint', async () => {
  let delegationAttempts = 0;
  const bindings = {
    ...runtimeBindings([]),
    validateDelegation: async () => {
      delegationAttempts += 1;
      if (delegationAttempts === 1) throw new Error('simulated worker crash');
      return { valid: true, evidence: [] };
    },
  };
  const sdk = new H2A2HSDK(bindings as never);
  const request = {
    interaction_id: 'interaction:recovery-test',
    correlation_id: 'correlation:recovery-test',
    initiating_human: { entity_id: 'human:test', kind: 'Human' },
    intent: { canonical_label: 'Test.Intent', version: '0.9.0' },
    input: { value: 1 },
  };
  await assert.rejects(() => sdk.run(request), /simulated worker crash/);
  const checkpoint = await sdk.getInteraction(request.interaction_id);
  assert.equal(checkpoint?.state, 'INTENT_CAPTURED');

  const recovered = await sdk.recover(request.interaction_id);
  assert.equal(recovered.state, 'CLOSED');
});

test('SDK rejects concurrent recovery while another lease owns the checkpoint', async () => {
  const store = new InMemoryInteractionCheckpointStore<Input, Result>();
  const context = checkpoint('INTENT_CAPTURED', 'conflict');
  store.save(context);
  const held = store.claimResume(context.interaction_id);
  assert.equal(held.status, 'claimed');

  const sdk = new H2A2HSDK(runtimeBindings([]), { checkpoint_store: store });
  await assert.rejects(
    () => sdk.recover(context.interaction_id),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError
      && error.code === 'interaction.recovery_conflict',
  );

  if (held.status === 'claimed') {
    assert.equal(store.releaseResume(context.interaction_id, held.lease.lease_id), true);
  }
});
