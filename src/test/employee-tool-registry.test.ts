import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { H2A2HSDK } from '../sdk.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  createCapabilityBackedOptionsFactory,
  type EmployeeLifecycleBindings,
} from '../employee-tool-binding.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
  HttpJsonEmployeeToolProvider,
  InMemoryEmployeeToolProvider,
  McpEmployeeToolProvider,
} from '../employee-tool-registry.js';
import {
  deriveEmployeeToolExecutionIdentity,
  type EmployeeAgentDefinition,
} from '../employee-agent.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:employee-owner',
  kind: 'Human',
  canonical_label: 'Human.EmployeeOwner',
};

function lifecycleOptions(employee: EmployeeAgentDefinition): EmployeeLifecycleBindings {
  const agent: EntityRef = {
    entity_id: `agent:${employee.contract.identity.canonical_label}`,
    kind: 'Agent',
    canonical_label: employee.contract.identity.canonical_label,
  };
  return {
    humanApproval: {
      resolveRequiredTriggers: async (context) => {
        const tool = employee.contract.tools.find((candidate) => candidate.name === context.operation.tool);
        if (!tool?.side_effect) return [];
        const trigger = employee.contract.risk.human_approval_required_for[0];
        return trigger ? [trigger] : [];
      },
      verifyEvidence: async (binding) =>
        binding.approved_by === human.entity_id && binding.evidence_ref.startsWith('approval:'),
    },
    validateDelegation: async (context) => ({
      valid: context.input.delegation_ref === 'delegation:valid',
      ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : {}),
      ...(context.input.delegation_ref === 'delegation:valid' ? {} : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:employee-owner',
    }),
    resolveChannel: async () => ({ profile: 'memory' }),
    returnToHuman: async (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };
}

const personalShopperTools = [
  'commerce.catalog.search',
  'commerce.offer.compare',
  'commerce.cart.prepare',
  'commerce.order.status',
  'commerce.purchase.request',
];

test('Employee Tool catalog resolves 65 business capabilities plus 4 H2A2H protocol capabilities', async () => {
  const registry = await EmployeeToolRegistry.load();
  assert.equal(registry.list().length, 69);
  assert.equal(registry.listByDomain('h2a2h').length, 4);
  assert.equal(registry.list().filter((capability) => capability.provider_required).length, 65);
  assert.equal(registry.get('finance.erp.write').side_effect, true);
  assert.equal(registry.get('finance.ledger.query').effect, 'read-only');
});

test('all 105 Employee Agent contracts reference registered capability contracts with matching effects', async () => {
  const tools = await EmployeeToolRegistry.load();
  const employees = await EmployeeAgentRegistry.fromCatalog();
  assert.equal(employees.entries.length, 105);
  for (const entry of employees.entries) {
    tools.validateEmployeeCoverage(await employees.load(entry.canonical_label));
  }
});

test('Employee Agent fails closed before startup when a required business capability has no provider', async () => {
  const tools = await EmployeeToolRegistry.load();
  const employees = await EmployeeAgentRegistry.fromCatalog();
  const employee = await employees.load('Enterprise.Employee.PersonalShopperAgent');
  assert.throws(
    () => tools.assertEmployeeReady(employee),
    (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'tool.provider.unbound',
  );
});

test('Personal Shopper executes a read-only capability through the in-memory provider registry', async () => {
  const tools = await EmployeeToolRegistry.load();
  const provider = new InMemoryEmployeeToolProvider('memory:commerce', Object.fromEntries(
    personalShopperTools.map((tool) => [tool, async (input: unknown) => ({ tool, input })]),
  ));
  tools.bindMany(personalShopperTools, provider);

  const employees = await EmployeeAgentRegistry.fromCatalog();
  const runtime = await employees.createRuntime(
    'Enterprise.Employee.PersonalShopperAgent',
    createCapabilityBackedOptionsFactory(tools, async (employee) => lifecycleOptions(employee)),
  );
  const sdk = new H2A2HSDK(runtime.bindings());
  const result = await sdk.run({
    initiating_human: human,
    intent: { canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Analyze' },
    input: {
      delegation_ref: 'delegation:valid',
      request_payload: { goal: 'find headphones' },
      operations: [{ tool: 'commerce.catalog.search', input: { query: 'headphones' } }],
    },
  });

  assert.equal(result.state, 'CLOSED');
  assert.equal(result.result?.tool_results[0]?.tool, 'commerce.catalog.search');
  assert.match(result.result?.tool_results[0]?.execution_id ?? '', /^tool-execution:/);
  assert.deepEqual(result.result?.tool_results[0]?.result, {
    tool: 'commerce.catalog.search',
    input: { query: 'headphones' },
  });
});

test('approved side effect executes through HTTP+JSON provider with validated H2A2H approval and idempotency metadata', async () => {
  const received: Array<{
    body: Record<string, unknown>;
    idempotencyKey?: string;
    executionId?: string;
  }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push({
        body: JSON.parse(body) as Record<string, unknown>,
        ...(typeof request.headers['idempotency-key'] === 'string'
          ? { idempotencyKey: request.headers['idempotency-key'] }
          : {}),
        ...(typeof request.headers['x-h2a2h-execution-id'] === 'string'
          ? { executionId: request.headers['x-h2a2h-execution-id'] }
          : {}),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: true, provider: 'commerce-http' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const tools = await EmployeeToolRegistry.load();
    const memory = new InMemoryEmployeeToolProvider('memory:commerce', Object.fromEntries(
      personalShopperTools
        .filter((tool) => tool !== 'commerce.purchase.request')
        .map((tool) => [tool, async (input: unknown) => ({ tool, input })]),
    ));
    tools.bindMany(personalShopperTools.filter((tool) => tool !== 'commerce.purchase.request'), memory);
    tools.bind(
      'commerce.purchase.request',
      new HttpJsonEmployeeToolProvider(
        'http:commerce-purchase',
        () => `http://127.0.0.1:${address.port}/purchase`,
      ),
    );

    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      'Enterprise.Employee.PersonalShopperAgent',
      createCapabilityBackedOptionsFactory(tools, async (employee) => lifecycleOptions(employee)),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const result = await sdk.run({
      initiating_human: human,
      intent: { canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Execute' },
      input: {
        delegation_ref: 'delegation:valid',
        request_payload: { goal: 'purchase approved product' },
        human_approval: { granted: true, approved_by: human.entity_id, evidence_ref: 'approval:purchase-1' },
        operations: [{
          tool: 'commerce.purchase.request',
          input: { sku: 'sku-1', amount: 499 },
          risk_triggers: [],
        }],
      },
    });

    assert.equal(result.state, 'CLOSED');
    assert.deepEqual(result.result?.tool_results[0]?.result, { accepted: true, provider: 'commerce-http' });
    assert.equal(received.length, 1);
    const providerContext = received[0]?.body.context as Record<string, unknown>;
    assert.equal(received[0]?.body.capability, 'commerce.purchase.request');
    assert.equal(providerContext.delegation_ref, 'delegation:valid');
    assert.equal(providerContext.approval_evidence_ref, 'approval:purchase-1');
    assert.equal(providerContext.correlation_id, result.correlation_id);
    assert.equal(received[0]?.executionId, providerContext.execution_id);
    assert.equal(received[0]?.idempotencyKey, providerContext.idempotency_key);
    assert.equal(result.result?.tool_results[0]?.execution_id, providerContext.execution_id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('MCP provider adapter preserves canonical capability, correlation and execution identity metadata', async () => {
  const tools = await EmployeeToolRegistry.load();
  let call: { name: string; args: unknown; metadata: Record<string, unknown> } | undefined;
  const provider = new McpEmployeeToolProvider('mcp:commerce', {
    callTool: async (name, args, metadata) => {
      call = { name, args, metadata: metadata as unknown as Record<string, unknown> };
      return { ok: true };
    },
  });
  tools.bind('commerce.catalog.search', provider);
  const executor = tools.resolveExecutor('commerce.catalog.search');
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load('Enterprise.Employee.PersonalShopperAgent');
  const execution = deriveEmployeeToolExecutionIdentity({
    interaction_id: 'interaction:mcp',
    intent_canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Analyze',
    employee_canonical_label: employee.contract.identity.canonical_label,
    operation_index: 0,
    tool_canonical_label: 'commerce.catalog.search',
    operation_input: { query: 'camera' },
  });
  await executor({ query: 'camera' }, {
    employee,
    operation: { tool: 'commerce.catalog.search', input: { query: 'camera' } },
    execution,
    interaction: {
      interaction_id: 'interaction:mcp',
      correlation_id: 'correlation:mcp',
      state: 'EXECUTING',
      initiating_human: human,
      intent: {
        ref: { canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Analyze', version: '0.1.0' },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: { delegation_ref: 'delegation:valid', request_payload: {} },
      transitions: [],
    },
  });
  assert.equal(call?.name, 'commerce.catalog.search');
  assert.equal(call?.metadata.correlation_id, 'correlation:mcp');
  assert.equal(call?.metadata.execution_id, execution.execution_id);
  assert.equal(call?.metadata.idempotency_key, execution.idempotency_key);
  assert.equal(call?.metadata.operation_index, 0);
});
