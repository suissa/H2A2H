import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import test from 'node:test';
import { createCapabilityBackedOptionsFactory } from '../employee-tool-binding.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import type {
  EmployeeAgentDefinition,
  EmployeeAgentRuntimeOptions,
  EmployeeToolCallContext,
} from '../employee-agent.js';
import {
  EmployeeProviderPackRegistry,
  loadEmployeeProviderPackManifest,
} from '../employee-provider-pack.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
} from '../employee-tool-registry.js';
import {
  FINANCE_HTTP_PATHS,
  createFinanceHttpJsonProviderPackFactory,
} from '../provider-packs/finance-http-json.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:finance-owner',
  kind: 'Human',
  canonical_label: 'Human.FinanceOwner',
};

interface ReceivedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

function lifecycleOptions(employee: EmployeeAgentDefinition): EmployeeAgentRuntimeOptions {
  const agent: EntityRef = {
    entity_id: `agent:${employee.contract.identity.canonical_label}`,
    kind: 'Agent',
    canonical_label: employee.contract.identity.canonical_label,
  };
  return {
    validateDelegation: async (context) => ({
      valid: context.input.delegation_ref === 'delegation:finance',
      ...(context.input.delegation_ref
        ? { delegation_id: context.input.delegation_ref }
        : {}),
      ...(context.input.delegation_ref === 'delegation:finance'
        ? {}
        : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:finance-owner',
    }),
    resolveChannel: async () => ({ profile: 'memory' }),
    returnToHuman: async (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };
}

function directToolContext(
  employee: EmployeeAgentDefinition,
  tool: string,
  interactionId: string,
): EmployeeToolCallContext {
  return {
    employee,
    operation: { tool, input: { test: true } },
    interaction: {
      interaction_id: interactionId,
      correlation_id: `correlation:${interactionId}`,
      state: 'EXECUTING',
      initiating_human: human,
      intent: {
        ref: {
          canonical_label: 'Enterprise.Employee.AccountantAgent.Analyze',
          version: '0.1.0',
        },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: {
        delegation_ref: 'delegation:finance',
        request_payload: {},
      },
      transitions: [],
    },
  };
}

async function withFinanceServer(
  run: (baseUrl: string, received: ReceivedRequest[]) => Promise<void>,
): Promise<void> {
  const received: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      received.push({
        path: request.url ?? '',
        headers: request.headers,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, path: request.url }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`, received);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

test('Finance Provider Pack manifest covers the complete finance capability domain', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/finance-http-json/manifest.json',
    tools,
  );
  assert.equal(manifest.canonical_label, 'ProviderPack.Finance.HttpJson');
  assert.equal(manifest.domain, 'finance');
  assert.equal(manifest.provider_kind, 'http-json');
  assert.deepEqual(manifest.capabilities.sort(), Object.keys(FINANCE_HTTP_PATHS).sort());
  assert.equal(manifest.secrets[0]?.name, 'api_token');
  assert.equal(manifest.secrets[0]?.required, true);
});

test('one Finance Provider Pack makes a Finance Employee Agent capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const packs = new EmployeeProviderPackRegistry(tools);
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/finance-http-json/manifest.json',
    tools,
  );
  packs.register(manifest, createFinanceHttpJsonProviderPackFactory(async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
  await packs.activate(manifest.canonical_label, { base_url: 'https://finance.example.test' }, { api_token: 'test-token' });

  const accountant = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.AccountantAgent',
  );
  assert.doesNotThrow(() => tools.assertEmployeeReady(accountant));
});

test('Finance Provider Pack routes all five capabilities and propagates H2A2H metadata', async () => {
  await withFinanceServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const packs = new EmployeeProviderPackRegistry(tools);
    const manifest = await loadEmployeeProviderPackManifest(
      'providers/finance-http-json/manifest.json',
      tools,
    );
    packs.register(manifest, createFinanceHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, tenant_id: 'tenant-1', timeout_ms: 5000 },
      { api_token: 'finance-secret-token' },
    );

    const accountant = await (await EmployeeAgentRegistry.fromCatalog()).load(
      'Enterprise.Employee.AccountantAgent',
    );
    for (const [index, capability] of manifest.capabilities.entries()) {
      const executor = tools.resolveExecutor(capability);
      await executor(
        { sequence: index },
        directToolContext(accountant, capability, `finance-${index}`),
      );
    }

    assert.equal(received.length, 5);
    assert.deepEqual(received.map((request) => request.path), manifest.capabilities.map(
      (capability) => FINANCE_HTTP_PATHS[capability as keyof typeof FINANCE_HTTP_PATHS],
    ));
    for (let index = 0; index < received.length; index += 1) {
      const request = received[index]!;
      const capability = manifest.capabilities[index]!;
      assert.equal(request.headers.authorization, 'Bearer finance-secret-token');
      assert.equal(request.headers['x-h2a2h-capability'], capability);
      assert.equal(request.headers['x-h2a2h-delegation-ref'], 'delegation:finance');
      assert.equal(request.headers['x-h2a2h-tenant-id'], 'tenant-1');
      assert.equal(request.headers['x-h2a2h-correlation-id'], `correlation:finance-${index}`);
      assert.equal(request.body.capability, capability);
    }
  });
});

test('Finance Provider Pack cannot invoke even a read capability without delegation context', async () => {
  const tools = await EmployeeToolRegistry.load();
  const packs = new EmployeeProviderPackRegistry(tools);
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/finance-http-json/manifest.json',
    tools,
  );
  packs.register(manifest, createFinanceHttpJsonProviderPackFactory(async () => {
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  await packs.activate(manifest.canonical_label, { base_url: 'https://finance.example.test' }, { api_token: 'token' });
  const accountant = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.AccountantAgent',
  );
  const context = directToolContext(accountant, 'finance.erp.read', 'no-delegation');
  delete context.interaction.input.delegation_ref;

  await assert.rejects(
    () => tools.resolveExecutor('finance.erp.read')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'finance_provider.delegation.missing',
  );
});

test('Finance side effect remains governed by Employee Human-approval policy before provider call', async () => {
  await withFinanceServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const packs = new EmployeeProviderPackRegistry(tools);
    const manifest = await loadEmployeeProviderPackManifest(
      'providers/finance-http-json/manifest.json',
      tools,
    );
    packs.register(manifest, createFinanceHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { api_token: 'token' });

    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      'Enterprise.Employee.AccountantAgent',
      createCapabilityBackedOptionsFactory(tools, async (employee) => lifecycleOptions(employee)),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: 'Enterprise.Employee.AccountantAgent.Execute' },
      input: {
        delegation_ref: 'delegation:finance',
        request_payload: { action: 'post finance operation' },
        operations: [{
          tool: 'finance.erp.write',
          input: { amount: 100 },
          risk_triggers: ['payment or transfer'],
        }],
      },
    };

    await assert.rejects(
      () => sdk.run(request),
      (error: unknown) =>
        error instanceof Error && error.message.includes('Human approval required'),
    );
    assert.equal(received.length, 0);

    const approved = await sdk.run({
      ...request,
      input: {
        ...request.input,
        human_approval: {
          granted: true,
          approved_by: human.entity_id,
          evidence_ref: 'approval:finance-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:finance-1');
  });
});

test('Finance Provider Pack fails closed on missing config and secret', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/finance-http-json/manifest.json',
    tools,
  );

  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createFinanceHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingConfig.activate(manifest.canonical_label, {}, { api_token: 'token' }),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.config.missing',
  );

  const tools2 = await EmployeeToolRegistry.load();
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest, createFinanceHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingSecret.activate(manifest.canonical_label, { base_url: 'https://finance.example.test' }, {}),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.secret.missing',
  );
});
