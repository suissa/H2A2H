import assert from 'node:assert/strict';
import test from 'node:test';
import { H2A2HSDK } from '../sdk.js';
import {
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

function toolExecutors(): Record<string, EmployeeToolExecutor> {
  return {
    'commerce.catalog.search': async (input) => ({ matches: [{ sku: 'sku-1', title: 'Example product' }], query: input }),
    'commerce.offer.compare': async (input) => ({ best_offer: 'merchant-a', compared: input }),
    'commerce.cart.prepare': async (input) => ({ cart_id: 'cart-1', prepared: input }),
    'commerce.order.status': async (input) => ({ status: 'created', order: input }),
    'commerce.purchase.request': async (input) => ({ purchase_request_id: 'purchase-1', requested: input }),
  };
}

function options(): EmployeeAgentRuntimeOptions {
  return {
    toolExecutors: toolExecutors(),
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

test('loads Personal Shopper A2A identity and H2A2H employee contract', async () => {
  const employee = await loadEmployeeAgent('employees/personal-services/personal-shopper');
  assert.equal(employee.contract.identity.canonical_label, PERSONAL_SHOPPER_CANONICAL_LABEL);
  assert.equal(employee.agentCard.name, 'Personal Shopper Agent');
  assert.ok(employee.agentCard.supportedInterfaces.some((entry) => entry.protocolBinding === 'HTTP+JSON'));
  assert.ok(employee.contract.tools.some((tool) => tool.name === 'commerce.purchase.request'));
  assert.equal(employee.contract.authority.delegation_required, true);
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

test('fails closed when Personal Shopper purchase needs Human approval', async () => {
  const employeeRuntime = await createPersonalShopperAgent(options());
  const sdk = new H2A2HSDK(employeeRuntime.bindings());

  await assert.rejects(
    sdk.run({
      initiating_human: human,
      intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
      input: {
        delegation_ref: 'delegation:valid',
        request_payload: { goal: 'buy selected product' },
        operations: [
          {
            tool: 'commerce.purchase.request',
            input: { sku: 'sku-1', amount: 499 },
            risk_triggers: ['purchase commitment'],
          },
        ],
      },
    }),
    (error: unknown) => error instanceof EmployeeAgentPolicyError && error.code === 'human.approval_required',
  );
});

test('executes approved Personal Shopper purchase and returns PoHR evidence', async () => {
  const employeeRuntime = await createPersonalShopperAgent(options());
  const sdk = new H2A2HSDK(employeeRuntime.bindings());
  const result = await sdk.run({
    initiating_human: human,
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
    input: {
      delegation_ref: 'delegation:valid',
      request_payload: { goal: 'buy selected product' },
      human_approval: {
        granted: true,
        approved_by: human.entity_id,
        evidence_ref: 'approval:1',
      },
      operations: [
        {
          tool: 'commerce.purchase.request',
          input: { sku: 'sku-1', amount: 499 },
          risk_triggers: ['purchase commitment'],
        },
      ],
    },
  });

  assert.equal(result.state, 'CLOSED');
  assert.equal(result.result?.tool_results[0]?.tool, 'commerce.purchase.request');
  assert.match(result.human_return?.proof_ref ?? '', /^pohr:/);
});
