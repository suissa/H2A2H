import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  EmployeeAgentRuntimeOptions,
  EmployeeToolExecutor,
} from '../employee-agent.js';
import {
  createPersonalShopperAgent,
  PERSONAL_SHOPPER_CANONICAL_LABEL,
} from '../personal-shopper.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:resume-shopper-owner',
  kind: 'Human',
  canonical_label: 'Human.ResumeShopperOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:resume-personal-shopper',
  kind: 'Agent',
  canonical_label: PERSONAL_SHOPPER_CANONICAL_LABEL,
};

function employeeOptions(purchaseCounter: { count: number }): EmployeeAgentRuntimeOptions {
  const executors: Record<string, EmployeeToolExecutor> = {
    'commerce.catalog.search': async (input) => ({ matches: [], query: input }),
    'commerce.offer.compare': async (input) => ({ compared: input }),
    'commerce.cart.prepare': async (input) => ({ prepared: input }),
    'commerce.order.status': async (input) => ({ status: 'created', order: input }),
    'commerce.purchase.request': async (input) => {
      purchaseCounter.count += 1;
      return { purchase_request_id: 'purchase:resumed', requested: input };
    },
  };

  return {
    toolExecutors: executors,
    humanApproval: {
      resolveRequiredTriggers: (context) =>
        context.operation.tool === 'commerce.purchase.request'
          ? ['purchase commitment']
          : [],
      verifyEvidence: (binding) =>
        binding.evidence_ref === 'approval:resume'
        && binding.approved_by === human.entity_id
        && binding.employee_canonical_label === PERSONAL_SHOPPER_CANONICAL_LABEL
        && binding.intent_canonical_label === `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute`
        && binding.tool_canonical_label === 'commerce.purchase.request'
        && binding.delegation_ref === 'delegation:resume'
        && binding.interaction_id === 'interaction:employee-resume'
        && binding.correlation_id === 'correlation:employee-resume'
        && binding.risk_triggers.includes('purchase commitment'),
    },
    validateDelegation: (context) => ({
      valid: context.input.delegation_ref === 'delegation:resume',
      delegation_id: context.input.delegation_ref,
      evidence: ['delegation-proof:resume'],
      ...(context.input.delegation_ref === 'delegation:resume'
        ? {}
        : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:resume-shopper-owner',
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };
}

test('Employee approval resumes EXECUTING only after core Human action validation and Employee evidence validation', async () => {
  const purchaseCounter = { count: 0 };
  const employeeRuntime = await createPersonalShopperAgent(employeeOptions(purchaseCounter));
  const sdk = new H2A2HSDK({
    ...employeeRuntime.bindings(),
    validateHumanAction: (_context, action, expected) => ({
      valid:
        action.actor.entity_id === human.entity_id
        && action.actor.kind === 'Human'
        && action.canonical_label === expected.canonical_label
        && action.evidence.includes('human-action-proof:valid'),
      evidence: action.evidence,
      reason: 'human.resume.evidence_invalid',
    }),
  });

  const request = {
    initiating_human: human,
    interaction_id: 'interaction:employee-resume',
    correlation_id: 'correlation:employee-resume',
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
    input: {
      delegation_ref: 'delegation:resume',
      request_payload: { goal: 'buy selected product' },
      operations: [{
        tool: 'commerce.purchase.request',
        input: { sku: 'sku-1', amount: 499 },
      }],
    },
  };

  const escalated = await sdk.run(request);
  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(escalated.human_escalation?.code, 'human.approval_required');
  assert.equal(escalated.human_escalation?.resume_state, 'EXECUTING');
  assert.equal(escalated.human_escalation?.human_action.canonical_label, 'Human.Approval.Provide');
  assert.equal(purchaseCounter.count, 0);

  const invalidCoreEvidence = await sdk.resume(escalated, {
    human_action: {
      canonical_label: 'Human.Approval.Provide',
      actor: human,
      evidence: ['human-action-proof:forged'],
    },
  });
  assert.equal(invalidCoreEvidence.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(purchaseCounter.count, 0);

  const resumed = await sdk.resume(invalidCoreEvidence, {
    human_action: {
      canonical_label: 'Human.Approval.Provide',
      actor: human,
      evidence: ['human-action-proof:valid'],
    },
    input: {
      ...request.input,
      human_approval: {
        granted: true,
        approved_by: human.entity_id,
        evidence_ref: 'approval:resume',
      },
    },
  });

  assert.equal(resumed.state, 'CLOSED');
  assert.equal(resumed.interaction_id, request.interaction_id);
  assert.equal(resumed.correlation_id, request.correlation_id);
  assert.equal(purchaseCounter.count, 1);
  assert.equal(resumed.result?.tool_results[0]?.tool, 'commerce.purchase.request');
  assert.equal(resumed.transitions.filter((transition) => transition.to === 'CREATED').length, 1);
  assert.ok(resumed.transitions.some((transition) =>
    transition.from === 'HUMAN_ESCALATION_REQUIRED'
    && transition.to === 'EXECUTING'
    && transition.event === 'h2a2h.lifecycle.resumed'
    && transition.actor?.entity_id === human.entity_id,
  ));
  assert.equal(sdk.verifyAudit().valid, true);
});
