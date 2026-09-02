import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEmployeeToolExecutionIdentity,
  type EmployeeToolCallContext,
} from '../employee-agent.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
  HttpJsonEmployeeToolProvider,
  InMemoryEmployeeToolProvider,
  McpEmployeeToolProvider,
} from '../employee-tool-registry.js';
import {
  InMemoryToolExecutionJournalStore,
  type ToolExecutionDescriptor,
} from '../tool-execution-journal.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:provider-recovery-owner',
  kind: 'Human',
  canonical_label: 'Human.ProviderRecoveryOwner',
};

async function shopperContext(
  interactionId: string,
  tool: string,
  input: unknown,
): Promise<EmployeeToolCallContext> {
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.PersonalShopperAgent',
  );
  const intentCanonicalLabel = tool === 'commerce.purchase.request'
    ? 'Enterprise.Employee.PersonalShopperAgent.Execute'
    : 'Enterprise.Employee.PersonalShopperAgent.Analyze';
  const operation = { tool, input };
  return {
    employee,
    operation,
    execution: deriveEmployeeToolExecutionIdentity({
      interaction_id: interactionId,
      intent_canonical_label: intentCanonicalLabel,
      employee_canonical_label: employee.contract.identity.canonical_label,
      operation_index: 0,
      tool_canonical_label: tool,
      operation_input: input,
    }),
    interaction: {
      interaction_id: interactionId,
      correlation_id: `correlation:${interactionId}`,
      state: 'EXECUTING',
      initiating_human: human,
      intent: {
        ref: { canonical_label: intentCanonicalLabel, version: '0.1.0' },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: { delegation_ref: 'delegation:provider-recovery', request_payload: {} },
      transitions: [],
    },
  };
}

function executionDescriptor(context: EmployeeToolCallContext): ToolExecutionDescriptor {
  return {
    execution_id: context.execution.execution_id,
    idempotency_key: context.execution.idempotency_key,
    operation_index: context.execution.operation_index,
    input_digest: context.execution.input_digest,
    capability_canonical_label: context.operation.tool,
    interaction_id: context.interaction.interaction_id,
    correlation_id: context.interaction.correlation_id,
    intent_canonical_label: context.interaction.intent.ref.canonical_label,
    employee_canonical_label: context.employee.contract.identity.canonical_label,
  };
}

function recoveryJournal() {
  let now = Date.parse('2026-09-02T09:00:00.000Z');
  const journal = new InMemoryToolExecutionJournalStore({
    claim_ttl_ms: 1_000,
    now: () => new Date(now),
  });
  return {
    journal,
    expire: () => { now += 1_001; },
  };
}

test('recovered read-only capability may retry even when provider declares no recovery guarantee', async () => {
  const { journal, expire } = recoveryJournal();
  const context = await shopperContext(
    'interaction:read-only-recovery-safe',
    'commerce.catalog.search',
    { query: 'camera' },
  );
  const orphan = journal.claimExecution(executionDescriptor(context));
  assert.equal(orphan.status, 'claimed');
  expire();

  let calls = 0;
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  registry.bind('commerce.catalog.search', new InMemoryEmployeeToolProvider('memory:read-recovery', {
    'commerce.catalog.search': async (_input, providerContext) => {
      calls += 1;
      assert.equal(providerContext.execution_recovered, true);
      assert.equal(providerContext.execution_fence, 2);
      return { matches: ['camera'] };
    },
  }));

  const result = await registry.resolveExecutor('commerce.catalog.search')(
    context.operation.input,
    context,
  );
  assert.deepEqual(result, { matches: ['camera'] });
  assert.equal(calls, 1);
  const completed = await journal.loadExecution(context.execution.execution_id);
  assert.equal(completed?.state, 'completed');
  assert.equal(completed?.fence, 2);
});

test('HTTP Idempotency-Key propagation alone does not authorize recovered side-effect execution', async () => {
  const { journal, expire } = recoveryJournal();
  const context = await shopperContext(
    'interaction:http-recovery-unsafe',
    'commerce.purchase.request',
    { sku: 'sku-unsafe', amount: 450 },
  );
  assert.equal(journal.claimExecution(executionDescriptor(context)).status, 'claimed');
  expire();

  let fetchCalls = 0;
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  registry.bind('commerce.purchase.request', new HttpJsonEmployeeToolProvider(
    'http:unsafe-recovery',
    () => 'https://unsafe.example.invalid/purchase',
    async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  ));

  await assert.rejects(
    async () => registry.resolveExecutor('commerce.purchase.request')(
      context.operation.input,
      context,
    ),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError
      && error.code === 'tool.execution.recovery_unsafe',
  );
  assert.equal(fetchCalls, 0);
  const fenced = await journal.loadExecution(context.execution.execution_id);
  assert.equal(fenced?.state, 'executing');
  assert.equal(fenced?.fence, 2);
});

test('explicit provider-idempotency allows recovered HTTP side effect with stable recovery metadata', async () => {
  const { journal, expire } = recoveryJournal();
  const context = await shopperContext(
    'interaction:http-recovery-idempotent',
    'commerce.purchase.request',
    { sku: 'sku-idempotent', amount: 725 },
  );
  assert.equal(journal.claimExecution(executionDescriptor(context)).status, 'claimed');
  expire();

  let fetchCalls = 0;
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  registry.bind('commerce.purchase.request', new HttpJsonEmployeeToolProvider(
    'http:idempotent-recovery',
    () => 'https://idempotent.example.invalid/purchase',
    async (_request, init) => {
      fetchCalls += 1;
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers['Idempotency-Key'], context.execution.idempotency_key);
      const body = JSON.parse(String(init?.body)) as {
        context: { execution_recovered?: boolean; execution_fence?: number; idempotency_key: string };
      };
      assert.equal(body.context.execution_recovered, true);
      assert.equal(body.context.execution_fence, 2);
      assert.equal(body.context.idempotency_key, context.execution.idempotency_key);
      return new Response(JSON.stringify({ accepted: true, recovered: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    { recovery_mode: 'provider-idempotency' },
  ));

  const result = await registry.resolveExecutor('commerce.purchase.request')(
    context.operation.input,
    context,
  );
  assert.deepEqual(result, { accepted: true, recovered: true });
  assert.equal(fetchCalls, 1);
  assert.equal((await journal.loadExecution(context.execution.execution_id))?.state, 'completed');
});

test('reconciliation-capable MCP provider may recover a side effect and receives the fencing generation', async () => {
  const { journal, expire } = recoveryJournal();
  const context = await shopperContext(
    'interaction:mcp-recovery-reconcile',
    'commerce.purchase.request',
    { sku: 'sku-reconcile', amount: 990 },
  );
  assert.equal(journal.claimExecution(executionDescriptor(context)).status, 'claimed');
  expire();

  let calls = 0;
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  registry.bind('commerce.purchase.request', new McpEmployeeToolProvider(
    'mcp:reconciliation-recovery',
    {
      callTool: async (name, _args, metadata) => {
        calls += 1;
        assert.equal(name, 'commerce.purchase.request');
        assert.equal(metadata.execution_recovered, true);
        assert.equal(metadata.execution_fence, 2);
        assert.equal(metadata.idempotency_key, context.execution.idempotency_key);
        return { reconciled: true };
      },
    },
    { recovery_mode: 'reconciliation' },
  ));

  const result = await registry.resolveExecutor('commerce.purchase.request')(
    context.operation.input,
    context,
  );
  assert.deepEqual(result, { reconciled: true });
  assert.equal(calls, 1);
  const completed = await journal.loadExecution(context.execution.execution_id);
  assert.equal(completed?.state, 'completed');
  assert.equal(completed?.fence, 2);
});
