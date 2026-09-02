import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryInteractionCheckpointStore,
  type InteractionCheckpointStore,
} from '../interaction-checkpoint.js';
import { H2A2HRuntimeError } from '../runtime.js';
import { H2A2HSDK } from '../sdk.js';
import type {
  EntityRef,
  InteractionContext,
  RuntimeBindings,
} from '../types.js';

interface LeaseInput {
  delegation_ref?: string;
  payload: string;
}

interface LeaseOutput {
  accepted: string;
}

const human: EntityRef = {
  entity_id: 'human:resume-lease-owner',
  kind: 'Human',
  canonical_label: 'Human.ResumeLeaseOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:resume-lease-worker',
  kind: 'Agent',
  canonical_label: 'Agent.ResumeLeaseWorker',
};

function leaseBindings(): RuntimeBindings<LeaseInput, LeaseOutput> {
  return {
    resolveIntent: () => ({
      ref: { canonical_label: 'Resume.Lease.Example', version: '1.0.0' },
      input_schema: 'schema://resume-lease/input',
      output_schema: 'schema://resume-lease/output',
    }),
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:valid'
      ? { valid: true, delegation_id: 'delegation:valid', evidence: ['delegation-proof:valid'] }
      : { valid: false, reason: 'delegation.missing' },
    resolveParticipants: () => ({
      sender: agent,
      receiver: agent,
      receiving_human: human,
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    execute: (context) => ({ accepted: context.input.payload }),
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
    validateHumanAction: (_context, action, expected) => ({
      valid:
        action.actor.entity_id === human.entity_id
        && action.canonical_label === expected.canonical_label
        && action.evidence.includes('human-proof:valid'),
      evidence: action.evidence,
      reason: 'human.resume.evidence_invalid',
    }),
  };
}

function request(interactionId: string) {
  return {
    initiating_human: human,
    interaction_id: interactionId,
    correlation_id: `correlation:${interactionId}`,
    intent: { canonical_label: 'Resume.Lease.Example', version: '1.0.0' },
    input: { payload: 'lease me' },
  };
}

test('wrong resume lease cannot unlock an active claim', async () => {
  const store = new InMemoryInteractionCheckpointStore<LeaseInput, LeaseOutput>();
  const sdk = new H2A2HSDK(leaseBindings(), { checkpoint_store: store });
  const escalated = await sdk.run(request('interaction:lease-ownership'));
  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');

  const first = store.claimResume(escalated.interaction_id);
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Expected claimed lease');

  assert.equal(store.releaseResume(escalated.interaction_id, 'resume-lease:wrong'), false);
  assert.equal(store.claimResume(escalated.interaction_id).status, 'conflict');
  assert.equal(store.releaseResume(escalated.interaction_id, first.lease.lease_id), true);

  const retry = store.claimResume(escalated.interaction_id);
  assert.equal(retry.status, 'claimed');
  if (retry.status !== 'claimed') throw new Error('Expected retry claim');
  assert.equal(store.releaseResume(escalated.interaction_id, retry.lease.lease_id), true);
});

test('SDK fails closed when a custom checkpoint store has no atomic resume claim', async () => {
  const records = new Map<string, InteractionContext<LeaseInput, LeaseOutput>>();
  const legacyStore: InteractionCheckpointStore<LeaseInput, LeaseOutput> = {
    save: (context) => {
      records.set(context.interaction_id, structuredClone(context));
    },
    load: (interactionId) => {
      const context = records.get(interactionId);
      return context ? structuredClone(context) : undefined;
    },
  };

  const sdk = new H2A2HSDK(leaseBindings(), { checkpoint_store: legacyStore });
  const escalated = await sdk.run(request('interaction:lease-unsupported'));

  await assert.rejects(
    () => sdk.resume(escalated.interaction_id, {
      human_action: {
        canonical_label: 'Human.Delegation.Provide',
        actor: human,
        evidence: ['human-proof:valid'],
      },
      input: {
        delegation_ref: 'delegation:valid',
        payload: 'should not resume',
      },
    }),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError
      && error.code === 'interaction.resume_claim_unsupported',
  );

  assert.equal((await legacyStore.load(escalated.interaction_id))?.state, 'HUMAN_ESCALATION_REQUIRED');
});
