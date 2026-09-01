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
  providerPackCapabilityDomains,
} from '../employee-provider-pack.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
} from '../employee-tool-registry.js';
import {
  ENGINEERING_HTTP_PATHS,
  createEngineeringHttpJsonProviderPackFactory,
} from '../provider-packs/engineering-http-json.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:engineering-owner',
  kind: 'Human',
  canonical_label: 'Human.EngineeringOwner',
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
      valid: context.input.delegation_ref === 'delegation:engineering',
      ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : {}),
      ...(context.input.delegation_ref === 'delegation:engineering'
        ? {}
        : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:engineering-owner',
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
          canonical_label: 'Enterprise.Employee.SoftwareEngineerAgent.Analyze',
          version: '0.1.0',
        },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: {
        delegation_ref: 'delegation:engineering',
        request_payload: {},
      },
      transitions: [],
    },
  };
}

async function withEngineeringServer(
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

test('Engineering Provider Pack explicitly spans engineering and observability capability domains', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/engineering-http-json/manifest.json',
    tools,
  );
  assert.equal(manifest.canonical_label, 'ProviderPack.Engineering.HttpJson');
  assert.equal(manifest.domain, 'engineering-it');
  assert.deepEqual(providerPackCapabilityDomains(manifest).sort(), ['engineering', 'observability']);
  assert.deepEqual(manifest.capabilities.sort(), Object.keys(ENGINEERING_HTTP_PATHS).sort());
});

test('one Engineering Provider Pack makes Software Engineer capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const packs = new EmployeeProviderPackRegistry(tools);
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/engineering-http-json/manifest.json',
    tools,
  );
  packs.register(manifest, createEngineeringHttpJsonProviderPackFactory(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://engineering.example.test' },
    { access_token: 'test-token' },
  );
  const engineer = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.SoftwareEngineerAgent',
  );
  assert.doesNotThrow(() => tools.assertEmployeeReady(engineer));
});

test('Engineering Provider Pack routes all five capabilities and propagates H2A2H metadata', async () => {
  await withEngineeringServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const packs = new EmployeeProviderPackRegistry(tools);
    const manifest = await loadEmployeeProviderPackManifest(
      'providers/engineering-http-json/manifest.json',
      tools,
    );
    packs.register(manifest, createEngineeringHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, workspace: 'repo:example/project', timeout_ms: 5000 },
      { access_token: 'engineering-secret-token' },
    );

    const engineer = await (await EmployeeAgentRegistry.fromCatalog()).load(
      'Enterprise.Employee.SoftwareEngineerAgent',
    );
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)(
        { sequence: index },
        directToolContext(engineer, capability, `engineering-${index}`),
      );
    }

    assert.equal(received.length, 5);
    assert.deepEqual(
      received.map((request) => request.path),
      manifest.capabilities.map(
        (capability) => ENGINEERING_HTTP_PATHS[capability as keyof typeof ENGINEERING_HTTP_PATHS],
      ),
    );
    for (let index = 0; index < received.length; index += 1) {
      const request = received[index]!;
      const capability = manifest.capabilities[index]!;
      assert.equal(request.headers.authorization, 'Bearer engineering-secret-token');
      assert.equal(request.headers['x-h2a2h-capability'], capability);
      assert.equal(request.headers['x-h2a2h-delegation-ref'], 'delegation:engineering');
      assert.equal(request.headers['x-h2a2h-workspace'], 'repo:example/project');
      assert.equal(
        request.headers['x-h2a2h-correlation-id'],
        `correlation:engineering-${index}`,
      );
      assert.equal(request.body.capability, capability);
    }
  });
});

test('Engineering Provider Pack blocks direct provider invocation without delegation context', async () => {
  const tools = await EmployeeToolRegistry.load();
  const packs = new EmployeeProviderPackRegistry(tools);
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/engineering-http-json/manifest.json',
    tools,
  );
  packs.register(manifest, createEngineeringHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://engineering.example.test' },
    { access_token: 'token' },
  );
  const engineer = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.SoftwareEngineerAgent',
  );
  const context = directToolContext(engineer, 'observability.query', 'no-delegation');
  delete context.interaction.input.delegation_ref;

  await assert.rejects(
    async () => tools.resolveExecutor('observability.query')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('production CI execution remains blocked by Employee Human approval before provider call', async () => {
  await withEngineeringServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const packs = new EmployeeProviderPackRegistry(tools);
    const manifest = await loadEmployeeProviderPackManifest(
      'providers/engineering-http-json/manifest.json',
      tools,
    );
    packs.register(manifest, createEngineeringHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl },
      { access_token: 'token' },
    );

    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      'Enterprise.Employee.SoftwareEngineerAgent',
      createCapabilityBackedOptionsFactory(tools, async (employee) => lifecycleOptions(employee)),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: 'Enterprise.Employee.SoftwareEngineerAgent.Execute' },
      input: {
        delegation_ref: 'delegation:engineering',
        request_payload: { action: 'deploy production' },
        operations: [{
          tool: 'engineering.ci.execute',
          input: { pipeline: 'production' },
          risk_triggers: ['production deployment'],
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
          evidence_ref: 'approval:production-deploy-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received.length, 1);
    assert.equal(
      received[0]?.headers['x-h2a2h-approval-evidence'],
      'approval:production-deploy-1',
    );
  });
});

test('Engineering Provider Pack fails closed on missing base_url or access_token', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(
    'providers/engineering-http-json/manifest.json',
    tools,
  );
  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createEngineeringHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingConfig.activate(manifest.canonical_label, {}, { access_token: 'token' }),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.config.missing',
  );

  const tools2 = await EmployeeToolRegistry.load();
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest, createEngineeringHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingSecret.activate(
      manifest.canonical_label,
      { base_url: 'https://engineering.example.test' },
      {},
    ),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.secret.missing',
  );
});
