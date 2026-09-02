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
  ToolExecutionJournalError,
  type ToolExecutionDescriptor,
} from '../tool-execution-journal.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:journal-owner',
  kind: 'Human',
  canonical_label: 'Human.JournalOwner',
};

function descriptor(overrides: Partial<ToolExecutionDescriptor> = {}): ToolExecutionDescriptor {
  return {
    execution_id: 'tool-execution:journal-1',
    idempotency_key: 'h2a2h:journal-1',
    operation_index: 0,
    input_digest: 'digest:journal-1',
    capability_canonical_label: 'commerce.catalog.search',
    interaction_id: 'interaction:journal-1',
    correlation_id: 'correlation:journal-1',
    intent_canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Analyze',
    employee_canonical_label: 'Enterprise.Employee.PersonalShopperAgent',
    ...overrides,
  };
}

async function shopperContext(
  interactionId: string,
  tool = 'commerce.catalog.search',
  input: unknown = { query: 'camera' },
  operationIndex = 0,
): Promise<EmployeeToolCallContext> {
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.PersonalShopperAgent',
  );
  const intentCanonicalLabel = 'Enterprise.Employee.PersonalShopperAgent.Analyze';
  const operation = { tool, input };
  return {
    employee,
    operation,
    execution: deriveEmployeeToolExecutionIdentity({
      interaction_id: interactionId,
      intent_canonical_label: intentCanonicalLabel,
      employee_canonical_label: employee.contract.identity.canonical_label,
      operation_index: operationIndex,
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
      input: { delegation_ref: 'delegation:journal', request_payload: {} },
      transitions: [],
    },
  };
}

test('journal claim is atomic, wrong claims cannot mutate ownership, and completion replays', () => {
  const journal = new InMemoryToolExecutionJournalStore();
  const first = journal.claimExecution(descriptor());
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Expected execution claim');

  assert.equal(journal.releaseExecution(first.record.execution_id, 'claim:wrong'), false);
  assert.equal(journal.completeExecution(first.record.execution_id, 'claim:wrong', { wrong: true }), false);
  assert.equal(journal.claimExecution(descriptor()).status, 'conflict');

  assert.equal(
    journal.completeExecution(first.record.execution_id, first.record.claim_id, { value: 42 }),
    true,
  );
  assert.equal(journal.releaseExecution(first.record.execution_id, first.record.claim_id), false);

  const completed = journal.claimExecution(descriptor());
  assert.equal(completed.status, 'completed');
  if (completed.status !== 'completed') throw new Error('Expected completed replay');
  assert.deepEqual(completed.record.result, { value: 42 });
  assert.equal(journal.loadExecution(first.record.execution_id)?.state, 'completed');

  assert.throws(
    () => journal.claimExecution(descriptor({ input_digest: 'digest:different' })),
    (error: unknown) =>
      error instanceof ToolExecutionJournalError
      && error.code === 'tool.execution.identity_mismatch',
  );
});

test('completed Tool execution is replayed across registry instances without a second provider call', async () => {
  const journal = new InMemoryToolExecutionJournalStore();
  const context = await shopperContext('interaction:journal-recovery');
  let firstProviderCalls = 0;

  const firstRegistry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  firstRegistry.bind('commerce.catalog.search', new InMemoryEmployeeToolProvider('memory:first', {
    'commerce.catalog.search': async () => {
      firstProviderCalls += 1;
      return { recovered: false, source: 'first-provider' };
    },
  }));
  const firstResult = await firstRegistry.resolveExecutor('commerce.catalog.search')(
    context.operation.input,
    context,
  );
  assert.deepEqual(firstResult, { recovered: false, source: 'first-provider' });
  assert.equal(firstProviderCalls, 1);

  let recoveryProviderCalls = 0;
  const recoveryRegistry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  recoveryRegistry.bind('commerce.catalog.search', new InMemoryEmployeeToolProvider('memory:recovery', {
    'commerce.catalog.search': async () => {
      recoveryProviderCalls += 1;
      return { should_not_execute: true };
    },
  }));
  const replayed = await recoveryRegistry.resolveExecutor('commerce.catalog.search')(
    context.operation.input,
    context,
  );

  assert.deepEqual(replayed, firstResult);
  assert.equal(recoveryProviderCalls, 0);
  const record = await journal.loadExecution(context.execution.execution_id);
  assert.equal(record?.state, 'completed');
});

test('active Tool execution claim rejects concurrent invocation before provider execution', async () => {
  const journal = new InMemoryToolExecutionJournalStore();
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  const context = await shopperContext('interaction:journal-conflict');
  let providerCalls = 0;
  let startedResolve!: () => void;
  let releaseResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });

  registry.bind('commerce.catalog.search', new InMemoryEmployeeToolProvider('memory:blocking', {
    'commerce.catalog.search': async () => {
      providerCalls += 1;
      startedResolve();
      await release;
      return { ok: true };
    },
  }));
  const executor = registry.resolveExecutor('commerce.catalog.search');
  const first = executor(context.operation.input, context);
  await started;

  await assert.rejects(
    async () => executor(context.operation.input, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError
      && error.code === 'tool.execution.conflict',
  );
  assert.equal(providerCalls, 1);

  releaseResolve();
  assert.deepEqual(await first, { ok: true });
  assert.equal((await journal.loadExecution(context.execution.execution_id))?.state, 'completed');
});

test('provider failure releases Tool execution claim and permits retry with the same identity', async () => {
  const journal = new InMemoryToolExecutionJournalStore();
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  const context = await shopperContext('interaction:journal-retry');
  let attempts = 0;
  registry.bind('commerce.catalog.search', new InMemoryEmployeeToolProvider('memory:retry', {
    'commerce.catalog.search': async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('provider temporarily unavailable');
      return { attempt: attempts, execution_id: context.execution.execution_id };
    },
  }));
  const executor = registry.resolveExecutor('commerce.catalog.search');

  await assert.rejects(
    async () => executor(context.operation.input, context),
    /provider temporarily unavailable/,
  );
  assert.equal(await journal.loadExecution(context.execution.execution_id), undefined);

  const retry = await executor(context.operation.input, context);
  assert.deepEqual(retry, { attempt: 2, execution_id: context.execution.execution_id });
  assert.equal(attempts, 2);
  assert.equal((await journal.loadExecution(context.execution.execution_id))?.state, 'completed');
});

test('HTTP and MCP providers are not reinvoked after their execution result is journaled', async () => {
  const httpJournal = new InMemoryToolExecutionJournalStore();
  const httpRegistry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: httpJournal,
  });
  const httpContext = await shopperContext('interaction:journal-http');
  let httpCalls = 0;
  httpRegistry.bind('commerce.catalog.search', new HttpJsonEmployeeToolProvider(
    'http:journal',
    () => 'https://journal.example.invalid/search',
    async (_input, init) => {
      httpCalls += 1;
      assert.equal((init?.headers as Record<string, string>)['Idempotency-Key'], httpContext.execution.idempotency_key);
      return new Response(JSON.stringify({ provider: 'http', call: httpCalls }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  ));
  const httpExecutor = httpRegistry.resolveExecutor('commerce.catalog.search');
  const httpFirst = await httpExecutor(httpContext.operation.input, httpContext);
  const httpReplay = await httpExecutor(httpContext.operation.input, httpContext);
  assert.deepEqual(httpReplay, httpFirst);
  assert.equal(httpCalls, 1);

  const mcpJournal = new InMemoryToolExecutionJournalStore();
  const mcpRegistry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: mcpJournal,
  });
  const mcpContext = await shopperContext('interaction:journal-mcp');
  let mcpCalls = 0;
  mcpRegistry.bind('commerce.catalog.search', new McpEmployeeToolProvider('mcp:journal', {
    callTool: async (_name, _args, metadata) => {
      mcpCalls += 1;
      assert.equal(metadata.execution_id, mcpContext.execution.execution_id);
      return { provider: 'mcp', call: mcpCalls };
    },
  }));
  const mcpExecutor = mcpRegistry.resolveExecutor('commerce.catalog.search');
  const mcpFirst = await mcpExecutor(mcpContext.operation.input, mcpContext);
  const mcpReplay = await mcpExecutor(mcpContext.operation.input, mcpContext);
  assert.deepEqual(mcpReplay, mcpFirst);
  assert.equal(mcpCalls, 1);
});
