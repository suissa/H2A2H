import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  EmployeeAgentInput,
  EmployeeAgentRuntimeOptions,
  EmployeeToolExecutor,
} from '../employee-agent.js';
import {
  createPersonalShopperAgent,
  PERSONAL_SHOPPER_CANONICAL_LABEL,
} from '../personal-shopper.js';
import { H2A2HRuntimeError } from '../runtime.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:start-concurrent-shopper',
  kind: 'Human',
};

const agent: EntityRef = {
  entity_id: 'agent:start-concurrent-shopper',
  kind: 'Agent',
  canonical_label: PERSONAL_SHOPPER_CANONICAL_LABEL,
};

test('two concurrent initial runs with one interaction_id execute Employee side effect exactly once', async () => {
  const purchaseCounter = { count: 0 };
  let providerStartedResolve!: () => void;
  let providerReleaseResolve!: () => void;
  const providerStarted = new Promise<void>((resolve) => { providerStartedResolve = resolve; });
  const providerRelease = new Promise<void>((resolve) => { providerReleaseResolve = resolve; });

  const executors: Record<string, EmployeeToolExecutor> = {
    'commerce.catalog.search': async (input) => ({ matches: [], query: input }),
    'commerce.offer.compare': async (input) => ({ compared: input }),
    'commerce.cart.prepare': async (input) => ({ prepared: input }),
    'commerce.order.status': async (input) => ({ status: 'created', order: input }),
    'commerce.purchase.request': async (input) => {
      purchaseCounter.count += 1;
      providerStartedResolve();
      await providerRelease;
      return { purchase_request_id: 'purchase:start-single-admission', requested: input };
    },
  };

  const options: EmployeeAgentRuntimeOptions = {
    toolExecutors: executors,
    humanApproval: {
      resolveRequiredTriggers: (context) =>
        context.operation.tool === 'commerce.purchase.request'
          ? ['purchase commitment']
          : [],
      verifyEvidence: (binding) =>
        binding.evidence_ref === 'approval:start-concurrent'
        && binding.approved_by === human.entity_id
        && binding.delegation_ref === 'delegation:start-concurrent'
        && binding.interaction_id === 'interaction:employee-start-concurrent',
    },
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:start-concurrent'
      ? {
          valid: true,
          delegation_id: 'delegation:start-concurrent',
          evidence: ['delegation-proof:start-concurrent'],
        }
      : { valid: false, reason: 'delegation.invalid' },
    resolveParticipants: () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };

  const employeeRuntime = await createPersonalShopperAgent(options);
  const sdk = new H2A2HSDK(employeeRuntime.bindings());
  const input: EmployeeAgentInput = {
    delegation_ref: 'delegation:start-concurrent',
    request_payload: { goal: 'buy once' },
    human_approval: {
      granted: true,
      approved_by: human.entity_id,
      evidence_ref: 'approval:start-concurrent',
    },
    operations: [{
      tool: 'commerce.purchase.request',
      input: { sku: 'sku-start-race', amount: 1200 },
    }],
  };

  const runRequest = {
    initiating_human: human,
    interaction_id: 'interaction:employee-start-concurrent',
    correlation_id: 'correlation:employee-start-concurrent',
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
    input,
  };

  const firstRun = sdk.run(runRequest);
  await providerStarted;
  const secondRun = sdk.run(runRequest);
  const outcomesPromise = Promise.allSettled([firstRun, secondRun]);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  providerReleaseResolve();
  const outcomes = await outcomesPromise;

  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(purchaseCounter.count, 1);
  assert.ok(
    rejected[0]?.status === 'rejected'
    && rejected[0].reason instanceof H2A2HRuntimeError
    && rejected[0].reason.code === 'interaction.start_conflict',
  );

  const stored = await sdk.getInteraction(runRequest.interaction_id);
  assert.equal(stored?.state, 'CLOSED');
  assert.equal(stored?.transitions.filter((transition) => transition.to === 'CREATED').length, 1);
  assert.equal(sdk.verifyAudit().valid, true);

  await assert.rejects(
    () => sdk.run(runRequest),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError && error.code === 'interaction.already_exists',
  );
});
