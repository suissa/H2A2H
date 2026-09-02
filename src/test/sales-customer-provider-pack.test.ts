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
import { createDeclarativeHttpJsonProviderPackFactory } from '../provider-packs/http-json-domain.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';
import {
  directProviderToolContext,
  providerRoutes,
  testLifecycleOptions,
  withProviderServer,
} from './http-provider-pack-test-helpers.js';

const human: EntityRef = {
  entity_id: 'human:sales-owner',
  kind: 'Human',
  canonical_label: 'Human.SalesCustomerOwner',
};
const manifestPath = 'providers/sales-customer-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.AccountExecutiveAgent';
const analyzeIntent = `${employeeLabel}.Analyze`;
const executeIntent = `${employeeLabel}.Execute`;
const delegation = 'delegation:sales-customer';

test('Sales/Customer manifest is a truthful cross-domain declarative HTTP pack', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.canonical_label, 'ProviderPack.SalesCustomer.HttpJson');
  assert.equal(manifest.domain, 'sales-customer');
  assert.deepEqual(providerPackCapabilityDomains(manifest).sort(), ['customer', 'sales']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  assert.equal(manifest.binding?.authorization.secret, 'access_token');
  assert.equal(manifest.binding?.config_headers?.organization_id, 'x-h2a2h-organization-id');
});

test('one declarative Sales/Customer manifest makes Account Executive capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://sales.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Sales/Customer routes, auth and organization metadata execute only from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, organization_id: 'org-sales-1', timeout_ms: 5000 },
      { access_token: 'sales-token' },
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
          `sales-${index}`,
          delegation,
        ),
      );
    }
    assert.equal(received.length, manifest.capabilities.length);
    assert.deepEqual(
      received.map((request) => request.path),
      manifest.capabilities.map((capability) => routes[capability]),
    );
    for (let index = 0; index < received.length; index += 1) {
      const request = received[index]!;
      const capability = manifest.capabilities[index]!;
      assert.equal(request.headers.authorization, 'Bearer sales-token');
      assert.equal(request.headers['x-h2a2h-capability'], capability);
      assert.equal(request.headers['x-h2a2h-delegation-ref'], delegation);
      assert.equal(request.headers['x-h2a2h-organization-id'], 'org-sales-1');
      assert.equal(request.headers['x-h2a2h-correlation-id'], `correlation:sales-${index}`);
      assert.equal(request.body.capability, capability);
    }
  });
});

test('customer history access fails closed without H2A2H delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://sales.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(
    employee,
    human,
    analyzeIntent,
    'customer.history.query',
    'sales-no-delegation',
    delegation,
  );
  delete context.interaction.input.delegation_ref;
  await assert.rejects(
    async () => tools.resolveExecutor('customer.history.query')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('contractual Sales side effect remains Human-approved above the provider layer', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { access_token: 'token' });

    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(
      employeeLabel,
      createCapabilityBackedOptionsFactory(tools, async (employee) =>
        testLifecycleOptions(employee, human, delegation, 'responsibility:sales-owner'),
      ),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: executeIntent },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'record contractual promise' },
        operations: [{
          tool: 'sales.crm.write',
          input: { account_id: 'account-1', promise: 'binding delivery date' },
          risk_triggers: ['contractual promise'],
        }],
      },
    };

    const denied = await sdk.run(request);
    assert.equal(denied.state, 'HUMAN_ESCALATION_REQUIRED');
    assert.equal(denied.human_escalation?.code, 'human.approval_required');
    assert.equal(received.length, 0);

    const approved = await sdk.run({
      ...request,
      input: {
        ...request.input,
        human_approval: {
          granted: true,
          approved_by: human.entity_id,
          evidence_ref: 'approval:sales-contract-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:sales-contract-1');
  });
});

test('Sales/Customer Provider Pack fails closed on missing config or secret', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingConfig.activate(manifest.canonical_label, {}, { access_token: 'token' }),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.config.missing',
  );

  const tools2 = await EmployeeToolRegistry.load();
  const manifest2 = await loadEmployeeProviderPackManifest(manifestPath, tools2);
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest2, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(
    () => missingSecret.activate(
      manifest2.canonical_label,
      { base_url: 'https://sales.example.test' },
      {},
    ),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.secret.missing',
  );
});
