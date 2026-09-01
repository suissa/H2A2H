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
import { createFinanceHttpJsonProviderPackFactory } from '../provider-packs/finance-http-json.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';
import {
  directProviderToolContext,
  providerRoutes,
  testLifecycleOptions,
  withProviderServer,
} from './http-provider-pack-test-helpers.js';

const human: EntityRef = {
  entity_id: 'human:finance-owner',
  kind: 'Human',
  canonical_label: 'Human.FinanceOwner',
};

const manifestPath = 'providers/finance-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.AccountantAgent';
const analyzeIntent = `${employeeLabel}.Analyze`;
const executeIntent = `${employeeLabel}.Execute`;
const delegation = 'delegation:finance';

test('Finance manifest is the complete source of HTTP binding truth', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const routes = providerRoutes(manifest);
  assert.equal(manifest.canonical_label, 'ProviderPack.Finance.HttpJson');
  assert.equal(manifest.provider_kind, 'http-json');
  assert.deepEqual(Object.keys(routes).sort(), manifest.capabilities.slice().sort());
  assert.equal(manifest.binding?.authorization.secret, 'api_token');
  assert.equal(manifest.binding?.config_headers?.tenant_id, 'x-h2a2h-tenant-id');
});

test('Finance declarative factory makes Accountant capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createFinanceHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://finance.example.test' },
    { api_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Finance routes, auth and headers are executed directly from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createFinanceHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, tenant_id: 'tenant-1', timeout_ms: 5000 },
      { api_token: 'finance-secret-token' },
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
          `finance-${index}`,
          delegation,
        ),
      );
    }
    assert.deepEqual(
      received.map((request) => request.path),
      manifest.capabilities.map((capability) => routes[capability]),
    );
    for (let index = 0; index < received.length; index += 1) {
      const request = received[index]!;
      const capability = manifest.capabilities[index]!;
      assert.equal(request.headers.authorization, 'Bearer finance-secret-token');
      assert.equal(request.headers['x-h2a2h-capability'], capability);
      assert.equal(request.headers['x-h2a2h-delegation-ref'], delegation);
      assert.equal(request.headers['x-h2a2h-tenant-id'], 'tenant-1');
      assert.equal(request.headers['x-h2a2h-correlation-id'], `correlation:finance-${index}`);
    }
  });
});

test('Finance provider still fails closed without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createFinanceHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://finance.example.test' },
    { api_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(
    employee,
    human,
    analyzeIntent,
    'finance.erp.read',
    'finance-no-delegation',
    delegation,
  );
  delete context.interaction.input.delegation_ref;
  await assert.rejects(
    async () => tools.resolveExecutor('finance.erp.read')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('Finance Human approval remains above the declarative provider', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createFinanceHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { api_token: 'token' });
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      employeeLabel,
      createCapabilityBackedOptionsFactory(tools, async (employee) =>
        testLifecycleOptions(employee, human, delegation, 'responsibility:finance-owner'),
      ),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: executeIntent },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'payment' },
        operations: [{
          tool: 'finance.erp.write',
          input: { amount: 100 },
          risk_triggers: ['payment or transfer'],
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
          evidence_ref: 'approval:finance-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:finance-1');
  });
});
