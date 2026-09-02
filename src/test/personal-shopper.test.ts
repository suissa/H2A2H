import assert from 'node:assert/strict';
import test from 'node:test';
import { H2A2HSDK } from '../sdk.js';
import {
  EmployeeAgentContractError,
  EmployeeAgentPolicyError,
  loadEmployeeAgent,
  type EmployeeAgentRuntimeOptions,
  type EmployeeToolExecutor,
} from '../employee-agent.js';
import {
  createPersonalShopperAgent,
  PERSONAL_SHOPPER_CANONICAL_LABEL,
} from '../personal-shopper.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:shopper-owner',
  kind: 'Human',
  canonical_label: 'Human.ShopperOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:personal-shopper',
  kind: 'Agent',
  canonical_label: PERSONAL_SHOPPER_CANONICAL_LABEL,
};

interface PurchaseCounter { count: number }

function toolExecutors(purchaseCounter: PurchaseCounter = { count: 0 }): Record<string, EmployeeToolExecutor> {
  return {
    'commerce.catalog.search': async (input) => ({ matches: [{ sku: 'sku-1', title: 'Example product' }], query: input }),
    'commerce.offer.compare': async (input) => ({ best_offer: 'merchant-a', compared: input }),
    'commerce.cart.prepare': async (input) => ({ cart_id: 'cart-1', prepared: input }),
    'commerce.order.status': async (input) => ({ status: 'created', order: input }),
    'commerce.purchase.request': async (input) => {
      purchaseCounter.count += 1;
      return { purchase_request_id: 'purchase-1', requested: input };
    },
  };
}

function options(purchaseCounter: PurchaseCounter = { count: 0 }): EmployeeAgentRuntimeOptions {
  return {
    toolExecutors: toolExecutors(purchaseCounter),
    humanApproval: {
      resolveRequiredTriggers: async (context) =>
        context.operation.tool === 'commerce.purchase.request' ? ['purchase commitment'] : [],
      verifyEvidence: async (binding) =>
        binding.evidence_ref === 'approval:1' &&
        binding.approved_by === human.entity_id &&
        binding.employee_canonical_label === PERSONAL_SHOPPER_CANONICAL_LABEL &&
        binding.intent_canonical_label === `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` &&
        binding.tool_canonical_label === 'commerce.purchase.request' &&
        binding.delegation_ref === 'delegation:valid' &&
        binding.risk_triggers.length === 1 &&
        binding.risk_triggers[0] === 'purchase commitment',
    },
    validateDelegation: async (context) => {
      const valid = context.input.delegation_ref === 'delegation:valid';
      return {
        valid,
        evidence: ['delegation-proof:1'],
        ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : {}),
        ...(valid ? {} : { reason: 'delegation.invalid' }),
      };
    },
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:shopper-owner',
    }),
    resolveChannel: async () => ({ profile: 'memory', metadata: { source: 'test-open-entity-channels' } }),
    returnToHuman: async (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };
}

function purchaseRequest(humanApproval?: {
  granted: boolean;
  approved_by?: string;
  evidence_ref?: string;
}) {
  return {
    initiating_human: human,
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
    input: {
      delegation_ref: 'delegation:valid',
      request_payload: { goal: 'buy selected product' },
      ...(humanApproval ? { human_approval: humanApproval } : {}),
      operations: [{
        tool: 'commerce.purchase.request',
        input: { sku: 'sku-1', amount: 499 },
        risk_triggers: [],
      }],
    },
  };
}

test('loads Personal Shopper A2A identity and H2A2H employee contract', async () => {
  const employee = await loadEmployeeAgent('employees/personal-services/personal-shopper');
  assert.equal(employee.contract.identity.canonical_label, PERSONAL_SHOPPER_CANONICAL_LABEL);
  assert.equal(employee.agentCard.name, 'Personal Shopper Agent');
  assert.ok(employee.agentCard.supportedInterfaces.some((entry) => entry.protocolBinding === 'HTTP+JSON'));
  assert.ok(employee.contract.tools.some((tool) => tool.name === 'commerce.purchase.request'));
  assert.equal(employee.contract.authority.delegation_required, true);
});

test('Employee runtime fails closed when Human approval governance is unavailable', async () => {
  const { humanApproval: removedGovernance, ...insecure } = options();
  void removedGovernance;
  await assert.rejects(
    createPersonalShopperAgent(insecure as EmployeeAgentRuntimeOptions),
    (error: unknown) =>
      error instanceof EmployeeAgentContractError &&
      error.code === 'employee.human_approval.governance_missing',
  );
});

test('executes a delegated Personal Shopper read-only Intent through declared tools', async () => {
  const employeeRuntime = await createPersonalShopperAgent(options());
  const sdk = new H2A2HSDK(employeeRuntime.bindings());
  const result = await sdk.run({
    initiating_human: human,
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Analyze` },
    input: {
      delegation_ref: 'delegation:valid',
      request_payload: { goal: 'find a suitable product' },
      operations: [
        { tool: 'commerce.catalog.search', input: { query: 'noise cancelling headphones' } },
        { tool: 'commerce.offer.compare', input: { sku: 'sku-1' } },
      ],
    },
  });

  assert.equal(result.state, 'CLOSED');
  assert.equal(result.result?.status, 'Ok');
  assert.equal(result.result?.tool_results.length, 2);
  assert.equal(result.channel?.profile, 'memory');
  assert.match(result.human_return?.proof_ref ?? '', /^pohr:/);
  assert.ok(sdk.verifyAudit().valid);
});

test('purchase approval requirement is external and cannot be suppressed by omitted/empty request risk_triggers', async () => {
  const purchaseCounter = { count: 0 };
  const employeeRuntime = await createPersonalShopperAgent(options(purchaseCounter));
  const sdk = new H2A2HSDK(employeeRuntime.bindings());

  await assert.rejects(
    sdk.run(purchaseRequest()),
    (error: unknown) => error instanceof EmployeeAgentPolicyError && error.code === 'human.approval_required',
  );
  assert.equal(purchaseCounter.count, 0);
});

test('forged or incomplete Human approval never reaches the purchase executor', async () => {
  const invalidClaims = [
    {
      claim: { granted: false, approved_by: human.entity_id, evidence_ref: 'approval:1' },
      code: 'human.approval_required',
    },
    {
      claim: { granted: true, approved_by: 'human:attacker', evidence_ref: 'approval:1' },
      code: 'human.approval.evidence_invalid',
    },
    {
      claim: { granted: true, approved_by: human.entity_id, evidence_ref: 'approval:forged' },
      code: 'human.approval.evidence_invalid',
    },
    {
      claim: { granted: true, approved_by: human.entity_id },
      code: 'human.approval.evidence_missing',
    },
  ];

  for (const { claim, code } of invalidClaims) {
    const purchaseCounter = { count: 0 };
    const employeeRuntime = await createPersonalShopperAgent(options(purchaseCounter));
    const sdk = new H2A2HSDK(employeeRuntime.bindings());
    await assert.rejects(
      sdk.run(purchaseRequest(claim)),
      (error: unknown) => error instanceof EmployeeAgentPolicyError && error.code === code,
    );
    assert.equal(purchaseCounter.count, 0, `purchase executor must not run for ${code}`);
  }
});

test('executes approved Personal Shopper purchase only after external evidence validation and returns PoHR evidence', async () => {
  const purchaseCounter = { count: 0 };
  const employeeRuntime = await createPersonalShopperAgent(options(purchaseCounter));
  const sdk = new H2A2HSDK(employeeRuntime.bindings());
  const result = await sdk.run(purchaseRequest({
    granted: true,
    approved_by: human.entity_id,
    evidence_ref: 'approval:1',
  }));

  assert.equal(result.state, 'CLOSED');
  assert.equal(result.result?.tool_results[0]?.tool, 'commerce.purchase.request');
  assert.equal(purchaseCounter.count, 1);
  assert.match(result.human_return?.proof_ref ?? '', /^pohr:/);
});
