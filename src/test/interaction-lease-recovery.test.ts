import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryInteractionCheckpointStore,
  InteractionCheckpointError,
  type InteractionCheckpointOwnership,
} from '../interaction-checkpoint.js';
import { H2A2HSDK } from '../sdk.js';
import type {
  EntityRef,
  InteractionContext,
  RuntimeBindings,
} from '../types.js';

interface RecoveryInput {
  delegation_ref?: string;
  payload: string;
}

interface RecoveryOutput {
  accepted: string;
}

const human: EntityRef = {
  entity_id: 'human:interaction-recovery-owner',
  kind: 'Human',
  canonical_label: 'Human.InteractionRecoveryOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:interaction-recovery-worker',
  kind: 'Agent',
  canonical_label: 'Agent.InteractionRecoveryWorker',
};

function checkpoint(
  interactionId: string,
  correlationId = `correlation:${interactionId}`,
): InteractionContext<RecoveryInput, RecoveryOutput> {
  return {
    interaction_id: interactionId,
    correlation_id: correlationId,
    state: 'HUMAN_ESCALATION_REQUIRED',
    initiating_human: human,
    intent: {
      ref: { canonical_label: 'Interaction.Recovery.Example', version: '1.0.0' },
      input_schema: 'schema://interaction-recovery/input',
      output_schema: 'schema://interaction-recovery/output',
    },
    input: { payload: 'canonical' },
    transitions: [],
  };
}

function clockedStore(ttl = 1_000) {
  let now = Date.parse('2026-09-02T11:00:00.000Z');
  const store = new InMemoryInteractionCheckpointStore<RecoveryInput, RecoveryOutput>({
    lease_ttl_ms: ttl,
    now: () => new Date(now),
  });
  return {
    store,
    expire: () => { now += ttl + 1; },
  };
}

function startOwnership(claim: Extract<ReturnType<InMemoryInteractionCheckpointStore<RecoveryInput, RecoveryOutput>['claimStart']>, { status: 'claimed' }>): InteractionCheckpointOwnership {
  return {
    kind: 'start',
    claim_id: claim.lease.claim_id,
    ...(claim.lease.fence !== undefined ? { fence: claim.lease.fence } : {}),
  };
}

function resumeOwnership(claim: Extract<ReturnType<InMemoryInteractionCheckpointStore<RecoveryInput, RecoveryOutput>['claimResume']>, { status: 'claimed' }>): InteractionCheckpointOwnership {
  return {
    kind: 'resume',
    lease_id: claim.lease.lease_id,
    ...(claim.lease.fence !== undefined ? { fence: claim.lease.fence } : {}),
  };
}

test('expired start reservation is reclaimed only before the first canonical checkpoint and stale owner is fenced', async () => {
  const { store, expire } = clockedStore();
  const interactionId = 'interaction:start-lease-recovery';

  const first = store.claimStart(interactionId);
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Expected first start claim');
  assert.equal(first.lease.fence, 1);
  assert.equal(first.lease.recovered, undefined);
  assert.equal(store.claimStart(interactionId).status, 'conflict');

  expire();
  const recovered = store.claimStart(interactionId);
  assert.equal(recovered.status, 'claimed');
  if (recovered.status !== 'claimed') throw new Error('Expected recovered start claim');
  assert.equal(recovered.lease.fence, 2);
  assert.equal(recovered.lease.recovered, true);
  assert.notEqual(recovered.lease.claim_id, first.lease.claim_id);

  const canonical = checkpoint(interactionId);
  assert.equal(store.saveOwned(canonical, startOwnership(first)), false);
  assert.equal(store.saveOwned(canonical, startOwnership(recovered)), true);
  assert.equal(store.releaseStart(interactionId, first.lease.claim_id), false);

  expire();
  assert.equal(store.claimStart(interactionId).status, 'exists');
  assert.equal(store.releaseStart(interactionId, recovered.lease.claim_id), true);
  assert.equal(store.claimStart(interactionId).status, 'exists');
});

test('exactly one start owner wins an expiry reclaim race', async () => {
  const { store, expire } = clockedStore();
  const interactionId = 'interaction:start-reclaim-race';
  assert.equal(store.claimStart(interactionId).status, 'claimed');
  expire();

  const outcomes = await Promise.all([
    Promise.resolve().then(() => store.claimStart(interactionId)),
    Promise.resolve().then(() => store.claimStart(interactionId)),
  ]);
  assert.equal(outcomes.filter((value) => value.status === 'claimed').length, 1);
  assert.equal(outcomes.filter((value) => value.status === 'conflict').length, 1);
  const owner = outcomes.find((value) => value.status === 'claimed');
  assert.equal(owner?.status === 'claimed' ? owner.lease.fence : undefined, 2);
  assert.equal(owner?.status === 'claimed' ? owner.lease.recovered : undefined, true);
});

test('expired resume lease is reclaimed from canonical snapshot with monotonic fencing and stale writes rejected', async () => {
  const { store, expire } = clockedStore();
  const interactionId = 'interaction:resume-lease-recovery';
  const original = checkpoint(interactionId, 'correlation:canonical');
  store.save(original);

  const first = store.claimResume(interactionId);
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Expected first resume lease');
  assert.equal(first.lease.fence, 1);
  first.lease.context.correlation_id = 'correlation:caller-mutated-copy';
  assert.equal(store.load(interactionId)?.correlation_id, 'correlation:canonical');
  assert.equal(store.claimResume(interactionId).status, 'conflict');

  expire();
  const outcomes = await Promise.all([
    Promise.resolve().then(() => store.claimResume(interactionId)),
    Promise.resolve().then(() => store.claimResume(interactionId)),
  ]);
  assert.equal(outcomes.filter((value) => value.status === 'claimed').length, 1);
  assert.equal(outcomes.filter((value) => value.status === 'conflict').length, 1);
  const recovered = outcomes.find((value) => value.status === 'claimed');
  if (!recovered || recovered.status !== 'claimed') throw new Error('Expected recovered resume lease');
  assert.equal(recovered.lease.fence, 2);
  assert.equal(recovered.lease.recovered, true);
  assert.equal(recovered.lease.context.correlation_id, 'correlation:canonical');

  const staleContext = checkpoint(interactionId, 'correlation:stale-worker');
  assert.equal(store.saveOwned(staleContext, resumeOwnership(first)), false);
  const recoveredContext = structuredClone(recovered.lease.context);
  recoveredContext.correlation_id = 'correlation:recovered-owner';
  assert.equal(store.saveOwned(recoveredContext, resumeOwnership(recovered)), true);
  assert.equal(store.load(interactionId)?.correlation_id, 'correlation:recovered-owner');
  assert.equal(store.releaseResume(interactionId, first.lease.lease_id), false);
  assert.equal(store.releaseResume(interactionId, recovered.lease.lease_id), true);

  const nextLegitimate = store.claimResume(interactionId);
  assert.equal(nextLegitimate.status, 'claimed');
  assert.equal(nextLegitimate.status === 'claimed' ? nextLegitimate.lease.fence : undefined, 3);
  assert.equal(nextLegitimate.status === 'claimed' ? nextLegitimate.lease.recovered : undefined, undefined);
});

test('invalid Interaction lease TTL fails closed before use', () => {
  assert.throws(
    () => new InMemoryInteractionCheckpointStore({ lease_ttl_ms: 0 }),
    (error: unknown) =>
      error instanceof InteractionCheckpointError
      && error.code === 'interaction.lease_ttl_invalid',
  );
  assert.throws(
    () => new InMemoryInteractionCheckpointStore({ lease_ttl_ms: Number.POSITIVE_INFINITY }),
    (error: unknown) =>
      error instanceof InteractionCheckpointError
      && error.code === 'interaction.lease_ttl_invalid',
  );
});

function recoveryBindings(options: {
  executeStarted?: () => void;
  executeRelease?: Promise<void>;
  executeCounter?: { count: number };
  observeResumeMetadata?: (metadata: Record<string, unknown>) => void;
} = {}): RuntimeBindings<RecoveryInput, RecoveryOutput> {
  const executeCounter = options.executeCounter ?? { count: 0 };
  return {
    resolveIntent: () => ({
      ref: { canonical_label: 'Interaction.Recovery.Example', version: '1.0.0' },
      input_schema: 'schema://interaction-recovery/input',
      output_schema: 'schema://interaction-recovery/output',
    }),
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:recovered'
      ? {
          valid: true,
          delegation_id: 'delegation:recovered',
          evidence: ['delegation-proof:recovered'],
        }
      : { valid: false, reason: 'delegation.missing' },
    resolveParticipants: () => ({
      sender: agent,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:interaction-recovery-owner',
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    execute: async (context) => {
      executeCounter.count += 1;
      options.executeStarted?.();
      await options.executeRelease;
      return { accepted: context.input.payload };
    },
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
    validateHumanAction: (_context, action, expected) => {
      const metadata = action.metadata?.h2a2h_resume as Record<string, unknown> | undefined;
      if (metadata) options.observeResumeMetadata?.(metadata);
      const proposedInput = metadata?.proposed_input as RecoveryInput | undefined;
      return {
        valid:
          action.actor.entity_id === human.entity_id
          && action.canonical_label === expected.canonical_label
          && action.evidence.includes('human-proof:recovered')
          && proposedInput?.delegation_ref === 'delegation:recovered',
        evidence: action.evidence,
        reason: 'human.resume.evidence_invalid',
      };
    },
  };
}

test('SDK reclaims orphaned start reservation and persists only under the recovered fence', async () => {
  const { store, expire } = clockedStore();
  const interactionId = 'interaction:sdk-start-recovery';
  const orphan = store.claimStart(interactionId);
  assert.equal(orphan.status, 'claimed');
  if (orphan.status !== 'claimed') throw new Error('Expected orphaned start claim');
  expire();

  const sdk = new H2A2HSDK(recoveryBindings(), { checkpoint_store: store });
  const result = await sdk.run({
    initiating_human: human,
    interaction_id: interactionId,
    correlation_id: 'correlation:sdk-start-recovery',
    intent: { canonical_label: 'Interaction.Recovery.Example', version: '1.0.0' },
    input: {
      delegation_ref: 'delegation:recovered',
      payload: 'start recovered',
    },
  });

  assert.equal(result.state, 'CLOSED');
  assert.equal(result.interaction_id, interactionId);
  assert.equal(result.correlation_id, 'correlation:sdk-start-recovery');
  assert.equal(store.releaseStart(interactionId, orphan.lease.claim_id), false);
  assert.equal(store.claimStart(interactionId).status, 'exists');
  assert.equal(sdk.verifyAudit().valid, true);
});

test('SDK recovered resume uses canonical checkpoint, exposes recovery metadata, and fences stale worker writes', async () => {
  const { store, expire } = clockedStore();
  const executeCounter = { count: 0 };
  let executeStartedResolve!: () => void;
  let executeReleaseResolve!: () => void;
  const executeStarted = new Promise<void>((resolve) => { executeStartedResolve = resolve; });
  const executeRelease = new Promise<void>((resolve) => { executeReleaseResolve = resolve; });
  let observedMetadata: Record<string, unknown> | undefined;

  const sdk = new H2A2HSDK(recoveryBindings({
    executeCounter,
    executeStarted: executeStartedResolve,
    executeRelease,
    observeResumeMetadata: (metadata) => { observedMetadata = metadata; },
  }), { checkpoint_store: store });

  const escalated = await sdk.run({
    initiating_human: human,
    interaction_id: 'interaction:sdk-resume-recovery',
    correlation_id: 'correlation:sdk-resume-recovery',
    intent: { canonical_label: 'Interaction.Recovery.Example', version: '1.0.0' },
    input: { payload: 'needs delegation' },
  });
  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');

  const orphan = store.claimResume(escalated.interaction_id);
  assert.equal(orphan.status, 'claimed');
  if (orphan.status !== 'claimed') throw new Error('Expected orphaned resume lease');
  orphan.lease.context.correlation_id = 'correlation:forged-orphan-copy';
  expire();

  const resumedPromise = sdk.resume(escalated.interaction_id, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:recovered'],
    },
    input: {
      delegation_ref: 'delegation:recovered',
      payload: 'resume recovered',
    },
  });

  await executeStarted;
  assert.equal(executeCounter.count, 1);
  assert.equal(observedMetadata?.lease_recovered, true);
  assert.equal(observedMetadata?.lease_fence, 2);
  assert.equal((observedMetadata?.proposed_input as RecoveryInput | undefined)?.payload, 'resume recovered');

  const stale = structuredClone(orphan.lease.context);
  stale.correlation_id = 'correlation:stale-worker-write';
  assert.equal(store.saveOwned(stale, resumeOwnership(orphan)), false);
  assert.equal(store.load(escalated.interaction_id)?.correlation_id, 'correlation:sdk-resume-recovery');
  assert.equal(store.claimResume(escalated.interaction_id).status, 'conflict');

  executeReleaseResolve();
  const resumed = await resumedPromise;
  assert.equal(resumed.state, 'CLOSED');
  assert.equal(resumed.interaction_id, escalated.interaction_id);
  assert.equal(resumed.correlation_id, 'correlation:sdk-resume-recovery');
  assert.equal(resumed.result?.accepted, 'resume recovered');
  assert.equal(executeCounter.count, 1);
  assert.equal(store.releaseResume(escalated.interaction_id, orphan.lease.lease_id), false);
  assert.equal((await sdk.getInteraction(escalated.interaction_id))?.state, 'CLOSED');
  assert.equal(sdk.verifyAudit().valid, true);
});
