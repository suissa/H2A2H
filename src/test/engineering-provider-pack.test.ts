import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityBackedOptionsFactory } from '../employee-tool-binding.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  EmployeeProviderPackRegistry,
  loadEmployeeProviderPackManifest,
  providerPackCapabilityDomains,
} from '../employee-provider-pack.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
} from '../employee-tool-registry.js';
import { createEngineeringHttpJsonProviderPackFactory } from '../provider-packs/engineering-http-json.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';
import {
  directProviderToolContext,
  providerRoutes,
  testLifecycleOptions,
  withProviderServer,
} from './http-provider-pack-test-helpers.js';

const human: EntityRef = {
  entity_id: 'human:engineering-owner',
  kind: 'Human',
  canonical_label: 'Human.EngineeringOwner',
};
const manifestPath = 'providers/engineering-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.SoftwareEngineerAgent';
const analyzeIntent = `${employeeLabel}.Analyze`;
const executeIntent = `${employeeLabel}.Execute`;
const delegation = 'delegation:engineering';

test('Engineering manifest declares organizational and semantic capability domains', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.domain, 'engineering-it');
  assert.deepEqual(providerPackCapabilityDomains(manifest).sort(), ['engineering', 'observability']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  assert.equal(manifest.binding?.authorization.secret, 'access_token');
  assert.equal(manifest.binding?.config_headers?.workspace, 'x-h2a2h-workspace');
});

test('Engineering declarative factory makes Software Engineer capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createEngineeringHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://engineering.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Engineering routes and workspace header come only from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createEngineeringHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, workspace: 'repo:example/project', timeout_ms: 5000 },
      { access_token: 'engineering-token' },
    );
    const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)(
        { sequence: index },
        directProviderToolContext(
          employee,
          human,
          analyzeIntent,
          capability,
          `engineering-${index}`,
          delegation,
        ),
      );
    }
    assert.deepEqual(
      received.map((request) => request.path),
      manifest.capabilities.map((capability) => routes[capability]),
    );
    for (let index = 0; index < received.length; index += 1) {
      assert.equal(received[index]?.headers.authorization, 'Bearer engineering-token');
      assert.equal(received[index]?.headers['x-h2a2h-workspace'], 'repo:example/project');
      assert.equal(received[index]?.headers['x-h2a2h-delegation-ref'], delegation);
    }
  });
});

test('Engineering provider blocks direct invocation without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createEngineeringHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://engineering.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(
    employee,
    human,
    analyzeIntent,
    'observability.query',
    'engineering-no-delegation',
    delegation,
  );
  delete context.interaction.input.delegation_ref;
  await assert.rejects(
    async () => tools.resolveExecutor('observability.query')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('production CI execution remains Human-approved above declarative binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createEngineeringHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { access_token: 'token' });
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      employeeLabel,
      createCapabilityBackedOptionsFactory(tools, async (employee) =>
        testLifecycleOptions(employee, human, delegation, 'responsibility:engineering-owner'),
      ),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: executeIntent },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'deploy production' },
        operations: [{
          tool: 'engineering.ci.execute',
          input: { pipeline: 'production' },
          risk_triggers: ['production deployment'],
        }],
      },
    };
    await assert.rejects(() => sdk.run(request));
    assert.equal(received.length, 0);
    const approved = await sdk.run({
      ...request,
      input: {
        ...request.input,
        human_approval: {
          granted: true,
          approved_by: human.entity_id,
          evidence_ref: 'approval:production-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:production-1');
  });
});
