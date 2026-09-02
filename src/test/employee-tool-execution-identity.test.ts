import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEmployeeToolExecutionIdentity,
  type EmployeeAgentRuntimeOptions,
  type EmployeeHumanApprovalEvidenceBinding,
  type EmployeeToolCallContext,
  type EmployeeToolExecutor,
} from '../employee-agent.js';
import {
  createPersonalShopperAgent,
  PERSONAL_SHOPPER_CANONICAL_LABEL,
} from '../personal-shopper.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:tool-execution-owner',
  kind: 'Human',
  canonical_label: 'Human.ToolExecutionOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:tool-execution-shopper',
  kind: 'Agent',
  canonical_label: PERSONAL_SHOPPER_CANONICAL_LABEL,
};

function commonOptions(overrides: {
  onToolCall?: (context: EmployeeToolCallContext) => void;
  verifyEvidence?: (binding: EmployeeHumanApprovalEvidenceBinding) => boolean;
} = {}): EmployeeAgentRuntimeOptions {
  const executors: Record<string, EmployeeToolExecutor> = {
    'commerce.catalog.search': async (input) => ({ searched: input }),
    'commerce.offer.compare': async (input) => ({ compared: input }),
    'commerce.cart.prepare': async (input) => ({ prepared: input }),
    'commerce.order.status': async (input) => ({ status: input }),
    'commerce.purchase.request': async (input) => ({ purchased: input }),
  };

  return {
    toolExecutors: executors,
    humanApproval: {
      resolveRequiredTriggers: (context) =>
        context.operation.tool === 'commerce.purchase.request'
          ? ['purchase commitment']
          : [],
      verifyEvidence: (binding) => overrides.verifyEvidence?.(binding) ?? true,
    },
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:execution'
      ? {
          valid: true,
          delegation_id: 'delegation:execution',
          evidence: ['delegation-proof:execution'],
        }
      : { valid: false, reason: 'delegation.invalid' },
    resolveParticipants: () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:tool-execution-owner',
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
    ...(overrides.onToolCall ? { onToolCall: overrides.onToolCall } : {}),
  };
}

test('Tool execution identity is deterministic for canonical input and separated by operation index', () => {
  const base = {
    interaction_id: 'interaction:deterministic-tool',
    intent_canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Analyze`,
    employee_canonical_label: PERSONAL_SHOPPER_CANONICAL_LABEL,
    operation_index: 0,
    tool_canonical_label: 'commerce.catalog.search',
  };
  const first = deriveEmployeeToolExecutionIdentity({
    ...base,
    operation_input: { query: 'camera', filters: { max: 1000, category: 'photo' } },
  });
  const same = deriveEmployeeToolExecutionIdentity({
    ...base,
    operation_input: { filters: { category: 'photo', max: 1000 }, query: 'camera' },
  });
  const secondOperation = deriveEmployeeToolExecutionIdentity({
    ...base,
    operation_index: 1,
    operation_input: { query: 'camera', filters: { max: 1000, category: 'photo' } },
  });

  assert.deepEqual(first, same);
  assert.notEqual(first.execution_id, secondOperation.execution_id);
  assert.notEqual(first.idempotency_key, secondOperation.idempotency_key);
  assert.equal(first.input_digest, secondOperation.input_digest);
  assert.match(first.execution_id, /^tool-execution:/);
  assert.match(first.idempotency_key, /^h2a2h:/);
});

test('runtime assigns distinct execution identities to intentional identical Tool calls', async () => {
  const calls: EmployeeToolCallContext[] = [];
  const runtime = await createPersonalShopperAgent(commonOptions({
    onToolCall: (context) => { calls.push(context); },
  }));
  const sdk = new H2A2HSDK(runtime.bindings());
  const identicalOperation = {
    tool: 'commerce.catalog.search',
    input: { query: 'same camera' },
  };

  const result = await sdk.run({
    initiating_human: human,
    interaction_id: 'interaction:two-identical-tools',
    correlation_id: 'correlation:two-identical-tools',
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Analyze` },
    input: {
      delegation_ref: 'delegation:execution',
      request_payload: { goal: 'compare repeated lookup' },
      operations: [identicalOperation, { ...identicalOperation }],
    },
  });

  assert.equal(result.state, 'CLOSED');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.execution.operation_index, 0);
  assert.equal(calls[1]?.execution.operation_index, 1);
  assert.equal(calls[0]?.execution.input_digest, calls[1]?.execution.input_digest);
  assert.notEqual(calls[0]?.execution.execution_id, calls[1]?.execution.execution_id);
  assert.equal(result.result?.tool_results[0]?.execution_id, calls[0]?.execution.execution_id);
  assert.equal(result.result?.tool_results[1]?.execution_id, calls[1]?.execution.execution_id);
});

test('Human approval evidence is bound to the exact runtime-derived Tool execution identity', async () => {
  let approvalBinding: EmployeeHumanApprovalEvidenceBinding | undefined;
  const runtime = await createPersonalShopperAgent(commonOptions({
    verifyEvidence: (binding) => {
      approvalBinding = binding;
      return binding.evidence_ref === 'approval:execution'
        && binding.approved_by === human.entity_id
        && binding.operation_index === 0
        && binding.tool_canonical_label === 'commerce.purchase.request'
        && binding.execution_id.startsWith('tool-execution:')
        && binding.idempotency_key.startsWith('h2a2h:');
    },
  }));
  const sdk = new H2A2HSDK(runtime.bindings());

  const result = await sdk.run({
    initiating_human: human,
    interaction_id: 'interaction:approved-tool-execution',
    correlation_id: 'correlation:approved-tool-execution',
    intent: { canonical_label: `${PERSONAL_SHOPPER_CANONICAL_LABEL}.Execute` },
    input: {
      delegation_ref: 'delegation:execution',
      request_payload: { goal: 'buy approved product' },
      human_approval: {
        granted: true,
        approved_by: human.entity_id,
        evidence_ref: 'approval:execution',
      },
      operations: [{
        tool: 'commerce.purchase.request',
        input: { sku: 'sku-execution', amount: 750 },
      }],
    },
  });

  assert.equal(result.state, 'CLOSED');
  assert.ok(approvalBinding);
  assert.equal(result.result?.tool_results[0]?.execution_id, approvalBinding?.execution_id);
});
