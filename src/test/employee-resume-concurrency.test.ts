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
  entity_id: 'human:concurrent-shopper-owner',
  kind: 'Human',
  canonical_label: 'Human.ConcurrentShopperOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:concurrent-personal-shopper',
  kind: 'Agent',
  canonical_label: PERSONAL_SHOPPER_CANONICAL_LABEL,
};

interface ResumeMetadata {
  proposed_input?: EmployeeAgentInput;
}

test('two concurrent valid approval resumes execute the Personal Shopper provider exactly once', async () => {
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
      return { purchase_request_id: 'purchase:single-resumer', requested: input };
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
        binding.evidence_ref === 'approval:concurrent'
        && binding.approved_by === human.entity_id
        && binding.employee_canonical_label === PERSONAL_SHOPPER_CANONICAL_LABEL
        && binding.intent_canonical_label === `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute`
        && binding.tool_canonical_label === 'commerce.purchase.request'
        && binding.delegation_ref === 'delegation:concurrent'
        && binding.interaction_id === 'interaction:employee-concurrent-resume'
        && binding.correlation_id === 'correlation:employee-concurrent-resume'
        && binding.risk_triggers.includes('purchase commitment'),
    },
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:concurrent'
      ? {
          valid: true,
          delegation_id: 'delegation:concurrent',
          evidence: ['delegation-proof:concurrent'],
        }
      : { valid: false, reason: 'delegation.invalid' },
    resolveParticipants: () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:concurrent-shopper-owner',
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };

  const employeeRuntime = await createPersonalShopperAgent(options);
  const sdk = new H2A2HSDK({
    ...employeeRuntime.bindings(),
    validateHumanAction: (_context, action, expected) => {
      const resume = action.metadata?.h2a2h_resume as ResumeMetadata | undefined;
      return {
        valid:
          action.actor.entity_id === human.entity_id
          && action.canonical_label === expected.canonical_label
          && action.evidence.includes('human-action-proof:valid')
          && resume?.proposed_input?.human_approval?.evidence_ref === 'approval:concurrent',
        evidence: action.evidence,
        reason: 'human.resume.evidence_invalid',
      };
    },
  });

  const input: EmployeeAgentInput = {
    delegation_ref: 'delegation:concurrent',
    request_payload: { goal: 'buy selected product once' },
    operations: [{
      tool: 'commerce.purchase.request',
      input: { sku: 'sku-race', amount: 899 },
    }],
  };

  const escalated = await sdk.run({
    initiating_human: human,
    interaction_id: 'interaction:employee-concurrent-resume',
    correlation_id: 'correlation:employee-concurrent-resume',
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
    input,
  });
  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(purchaseCounter.count, 0);

  const resumeRequest = {
    human_action: {
      canonical_label: 'Human.Approval.Provide',
      actor: human,
      evidence: ['human-action-proof:valid'],
    },
    input: {
      ...input,
      human_approval: {
        granted: true,
        approved_by: human.entity_id,
        evidence_ref: 'approval:concurrent',
      },
    },
  };

  const firstResume = sdk.resume(escalated.interaction_id, resumeRequest);
  await providerStarted;
  const secondResume = sdk.resume(escalated.interaction_id, resumeRequest);
  const outcomesPromise = Promise.allSettled([firstResume, secondResume]);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  providerReleaseResolve();

  const outcomes = await outcomesPromise;
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(purchaseCounter.count, 1);
  assert.equal(fulfilled[0]?.status === 'fulfilled' ? fulfilled[0].value.state : undefined, 'CLOSED');
  assert.ok(
    rejected[0]?.status === 'rejected'
    && rejected[0].reason instanceof H2A2HRuntimeError
    && rejected[0].reason.code === 'interaction.resume_conflict',
  );

  const stored = await sdk.getInteraction(escalated.interaction_id);
  assert.equal(stored?.state, 'CLOSED');
  assert.equal(stored?.transitions.filter((transition) => transition.event === 'h2a2h.lifecycle.resumed').length, 1);
  assert.equal(sdk.verifyAudit().valid, true);

  await assert.rejects(
    () => sdk.resume(escalated.interaction_id, resumeRequest),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError && error.code === 'human.resume.not_escalated',
  );
});
