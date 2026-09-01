import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import test from 'node:test';
import {
  createCapabilityBackedOptionsFactory,
  type EmployeeLifecycleBindings,
} from '../employee-tool-binding.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import type { EmployeeAgentDefinition, EmployeeToolCallContext } from '../employee-agent.js';
import {
  EmployeeProviderPackRegistry,
  loadEmployeeProviderPackManifest,
} from '../employee-provider-pack.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
} from '../employee-tool-registry.js';
import {
  HR_HTTP_PATHS,
  createHrHttpJsonProviderPackFactory,
} from '../provider-packs/hr-http-json.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:hr-owner',
  kind: 'Human',
  canonical_label: 'Human.HumanResourcesOwner',
};

interface ReceivedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

function lifecycleOptions(employee: EmployeeAgentDefinition): EmployeeLifecycleBindings {
  const agent: EntityRef = {
    entity_id: `agent:${employee.contract.identity.canonical_label}`,
    kind: 'Agent',
    canonical_label: employee.contract.identity.canonical_label,
  };
  return {
    validateDelegation: async (context) => ({
      valid: context.input.delegation_ref === 'delegation:hr',
      ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : {}),
      ...(context.input.delegation_ref === 'delegation:hr' ? {} : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:hr-owner',
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
          canonical_label: 'Enterprise.Employee.HrBusinessPartnerAgent.Analyze',
          version: '0.1.0',
        },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: {
        delegation_ref: 'delegation:hr',
        request_payload: {},
      },
      transitions: [],
    },
  };
}

async function withHrServer(
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

test('HR Provider Pack covers all Human Resources capabilities', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest('providers/hr-http-json/manifest.json', tools);
  assert.equal(manifest.canonical_label, 'ProviderPack.HumanResources.HttpJson');
  assert.equal(manifest.domain, 'human-resources');
  assert.deepEqual(manifest.capability_domains, ['hr']);
  assert.deepEqual(manifest.capabilities.sort(), Object.keys(HR_HTTP_PATHS).sort());
});

test('one HR Provider Pack makes an HR Business Partner capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const packs = new EmployeeProviderPackRegistry(tools);
  const manifest = await loadEmployeeProviderPackManifest('providers/hr-http-json/manifest.json', tools);
  packs.register(manifest, createHrHttpJsonProviderPackFactory(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://hr.example.test' },
    { access_token: 'test-token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.HrBusinessPartnerAgent',
  );
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('HR Provider Pack routes all five capabilities and propagates H2A2H metadata', async () => {
  await withHrServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const packs = new EmployeeProviderPackRegistry(tools);
    const manifest = await loadEmployeeProviderPackManifest('providers/hr-http-json/manifest.json', tools);
    packs.register(manifest, createHrHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, organization_id: 'org-1', timeout_ms: 5000 },
      { access_token: 'hr-secret-token' },
    );
    const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(
      'Enterprise.Employee.HrBusinessPartnerAgent',
    );
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)(
        { sequence: index },
        directToolContext(employee, capability, `hr-${index}`),
      );
    }
    assert.equal(received.length, 5);
    assert.deepEqual(
      received.map((request) => request.path),
      manifest.capabilities.map(
        (capability) => HR_HTTP_PATHS[capability as keyof typeof HR_HTTP_PATHS],
      ),
    );
    for (let index = 0; index < received.length; index += 1) {
      const request = received[index]!;
      const capability = manifest.capabilities[index]!;
      assert.equal(request.headers.authorization, 'Bearer hr-secret-token');
      assert.equal(request.headers['x-h2a2h-capability'], capability);
      assert.equal(request.headers['x-h2a2h-delegation-ref'], 'delegation:hr');
      assert.equal(request.headers['x-h2a2h-organization-id'], 'org-1');
      assert.equal(request.headers['x-h2a2h-correlation-id'], `correlation:hr-${index}`);
      assert.equal(request.body.capability, capability);
    }
  });
});

test('HR Provider Pack rejects employee-data read without delegation context', async () => {
  const tools = await EmployeeToolRegistry.load();
  const packs = new EmployeeProviderPackRegistry(tools);
  const manifest = await loadEmployeeProviderPackManifest('providers/hr-http-json/manifest.json', tools);
  packs.register(manifest, createHrHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://hr.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.HrBusinessPartnerAgent',
  );
  const context = directToolContext(employee, 'hr.hris.read', 'no-delegation');
  delete context.interaction.input.delegation_ref;
  await assert.rejects(
    async () => tools.resolveExecutor('hr.hris.read')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('hire/termination HR write remains Human-approved before provider invocation', async () => {
  await withHrServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const packs = new EmployeeProviderPackRegistry(tools);
    const manifest = await loadEmployeeProviderPackManifest('providers/hr-http-json/manifest.json', tools);
    packs.register(manifest, createHrHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl },
      { access_token: 'token' },
    );
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      'Enterprise.Employee.HrBusinessPartnerAgent',
      createCapabilityBackedOptionsFactory(tools, async (employee) => lifecycleOptions(employee)),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: 'Enterprise.Employee.HrBusinessPartnerAgent.Execute' },
      input: {
        delegation_ref: 'delegation:hr',
        request_payload: { action: 'terminate employee' },
        operations: [{
          tool: 'hr.hris.write',
          input: { employee_id: 'employee-1', action: 'terminate' },
          risk_triggers: ['hire or termination'],
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
          evidence_ref: 'approval:hr-termination-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:hr-termination-1');
  });
});

test('HR Provider Pack fails closed on missing base_url or access_token', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest('providers/hr-http-json/manifest.json', tools);
  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createHrHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingConfig.activate(manifest.canonical_label, {}, { access_token: 'token' }),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.config.missing',
  );

  const tools2 = await EmployeeToolRegistry.load();
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest, createHrHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingSecret.activate(manifest.canonical_label, { base_url: 'https://hr.example.test' }, {}),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.secret.missing',
  );
});
