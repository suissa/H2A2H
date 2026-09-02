import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEmployeeToolExecutionIdentity,
  type EmployeeToolCallContext,
} from '../employee-agent.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  EmployeeProviderPackRegistry,
  createMcpProviderPackFactory,
  loadEmployeeProviderPackManifest,
} from '../employee-provider-pack.js';
import { EmployeeToolRegistry } from '../employee-tool-registry.js';
import { createDeclarativeHttpJsonProviderPackFactory } from '../provider-packs/http-json-domain.js';
import {
  InMemoryToolExecutionJournalStore,
  type ToolExecutionDescriptor,
} from '../tool-execution-journal.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:declarative-recovery-owner',
  kind: 'Human',
  canonical_label: 'Human.DeclarativeRecoveryOwner',
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
      input: {
        delegation_ref: 'delegation:declarative-recovery',
        request_payload: {},
      },
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
  let now = Date.parse('2026-09-02T10:00:00.000Z');
  const journal = new InMemoryToolExecutionJournalStore({
    claim_ttl_ms: 1_000,
    now: () => new Date(now),
  });
  return {
    journal,
    expire: () => { now += 1_001; },
  };
}

test('official Provider Pack manifests explicitly bind recovery mode none', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/commerce-http-json/manifest.json',
    tools,
  );
  assert.deepEqual(manifest.recovery, { mode: 'none' });

  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(
    manifest,
    createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );
  const active = await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://commerce.example.invalid' },
    { access_token: 'test-token' },
  );
  assert.equal(
    active.capabilityProviders.get('commerce.purchase.request')?.recovery_mode,
    'none',
  );
});

test('provider-idempotency manifest drives HTTP adapter and recovered side effect without hidden constructor policy', async () => {
  const { journal, expire } = recoveryJournal();
  const tools = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/reference-commerce-idempotent-http-json/manifest.json',
    tools,
  );
  assert.deepEqual(manifest.recovery, {
    mode: 'provider-idempotency',
    profile: 'h2a2h://recovery/provider-idempotency/reference-commerce/v1',
  });

  const context = await shopperContext(
    'interaction:manifest-http-recovery',
    'commerce.purchase.request',
    { sku: 'manifest-http', amount: 500 },
  );
  assert.equal(journal.claimExecution(executionDescriptor(context)).status, 'claimed');
  expire();

  let fetchCalls = 0;
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async (request, init) => {
    fetchCalls += 1;
    assert.equal(String(request), 'https://commerce.example.invalid/v1/commerce/purchase/request');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['Idempotency-Key'], context.execution.idempotency_key);
    assert.equal(headers['x-h2a2h-execution-id'], context.execution.execution_id);
    assert.equal(headers['x-h2a2h-execution-recovered'], 'true');
    assert.equal(headers['x-h2a2h-execution-fence'], '2');
    const body = JSON.parse(String(init?.body)) as {
      context: {
        execution_id: string;
        idempotency_key: string;
        execution_recovered?: boolean;
        execution_fence?: number;
      };
    };
    assert.equal(body.context.execution_id, context.execution.execution_id);
    assert.equal(body.context.idempotency_key, context.execution.idempotency_key);
    assert.equal(body.context.execution_recovered, true);
    assert.equal(body.context.execution_fence, 2);
    return new Response(JSON.stringify({ accepted: true, source: 'manifest' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
  const active = await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://commerce.example.invalid' },
    { access_token: 'test-token' },
  );
  assert.equal(
    active.capabilityProviders.get('commerce.purchase.request')?.recovery_mode,
    'provider-idempotency',
  );

  const result = await tools.resolveExecutor('commerce.purchase.request')(
    context.operation.input,
    context,
  );
  assert.deepEqual(result, { accepted: true, source: 'manifest' });
  assert.equal(fetchCalls, 1);
  assert.equal((await journal.loadExecution(context.execution.execution_id))?.state, 'completed');
});

test('reconciliation manifest drives MCP adapter and recovered side effect metadata', async () => {
  const { journal, expire } = recoveryJournal();
  const tools = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/reference-commerce-reconciliation-mcp/manifest.json',
    tools,
  );
  assert.deepEqual(manifest.recovery, {
    mode: 'reconciliation',
    profile: 'h2a2h://recovery/reconciliation/reference-commerce-mcp/v1',
  });

  const context = await shopperContext(
    'interaction:manifest-mcp-recovery',
    'commerce.purchase.request',
    { sku: 'manifest-mcp', amount: 700 },
  );
  assert.equal(journal.claimExecution(executionDescriptor(context)).status, 'claimed');
  expire();

  let calls = 0;
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createMcpProviderPackFactory('mcp:manifest-reconciliation', {
    callTool: async (name, _args, metadata) => {
      calls += 1;
      assert.equal(name, 'commerce.purchase.request');
      assert.equal(metadata.execution_recovered, true);
      assert.equal(metadata.execution_fence, 2);
      assert.equal(metadata.execution_id, context.execution.execution_id);
      assert.equal(metadata.idempotency_key, context.execution.idempotency_key);
      return { reconciled: true, source: 'manifest' };
    },
  }));
  const active = await packs.activate(manifest.canonical_label);
  assert.equal(
    active.capabilityProviders.get('commerce.purchase.request')?.recovery_mode,
    'reconciliation',
  );

  const result = await tools.resolveExecutor('commerce.purchase.request')(
    context.operation.input,
    context,
  );
  assert.deepEqual(result, { reconciled: true, source: 'manifest' });
  assert.equal(calls, 1);
  assert.equal((await journal.loadExecution(context.execution.execution_id))?.state, 'completed');
});
