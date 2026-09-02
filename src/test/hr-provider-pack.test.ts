import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityBackedOptionsFactory } from '../employee-tool-binding.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  EmployeeProviderPackRegistry,
  loadEmployeeProviderPackManifest,
} from '../employee-provider-pack.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
} from '../employee-tool-registry.js';
import { createHrHttpJsonProviderPackFactory } from '../provider-packs/hr-http-json.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';
import {
  directProviderToolContext,
  providerRoutes,
  testLifecycleOptions,
  withProviderServer,
} from './http-provider-pack-test-helpers.js';

const human: EntityRef = {
  entity_id: 'human:hr-owner',
  kind: 'Human',
  canonical_label: 'Human.HumanResourcesOwner',
};
const manifestPath = 'providers/hr-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.HrBusinessPartnerAgent';
const analyzeIntent = `${employeeLabel}.Analyze`;
const executeIntent = `${employeeLabel}.Execute`;
const delegation = 'delegation:hr';

test('HR manifest owns complete HTTP routes and authorization metadata', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.domain, 'human-resources');
  assert.deepEqual(manifest.capability_domains, ['hr']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  assert.equal(manifest.binding?.authorization.secret, 'access_token');
  assert.equal(manifest.binding?.config_headers?.organization_id, 'x-h2a2h-organization-id');
});

test('HR declarative factory makes HR Business Partner capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createHrHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://hr.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('HR routes and organization header execute directly from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createHrHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, organization_id: 'org-1', timeout_ms: 5000 },
      { access_token: 'hr-token' },
    );
    const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)(
        { sequence: index },
        directProviderToolContext(employee, human, analyzeIntent, capability, `hr-${index}`, delegation),
      );
    }
    assert.deepEqual(
      received.map((request) => request.path),
      manifest.capabilities.map((capability) => routes[capability]),
    );
    for (const request of received) {
      assert.equal(request.headers.authorization, 'Bearer hr-token');
      assert.equal(request.headers['x-h2a2h-organization-id'], 'org-1');
      assert.equal(request.headers['x-h2a2h-delegation-ref'], delegation);
    }
  });
});

test('HR provider blocks employee-data access without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createHrHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://hr.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(
    employee,
    human,
    analyzeIntent,
    'hr.hris.read',
    'hr-no-delegation',
    delegation,
  );
  delete context.interaction.input.delegation_ref;
  await assert.rejects(
    async () => tools.resolveExecutor('hr.hris.read')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('HR termination remains Human-approved above declarative provider binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createHrHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { access_token: 'token' });
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      employeeLabel,
      createCapabilityBackedOptionsFactory(tools, async (employee) =>
        testLifecycleOptions(employee, human, delegation, 'responsibility:hr-owner'),
      ),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: executeIntent },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'terminate employee' },
        operations: [{
          tool: 'hr.hris.write',
          input: { employee_id: 'employee-1', action: 'terminate' },
          risk_triggers: ['hire or termination'],
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
          evidence_ref: 'approval:hr-termination-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:hr-termination-1');
  });
});
