import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityBackedOptionsFactory } from '../employee-tool-binding.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import { EmployeeProviderPackRegistry, loadEmployeeProviderPackManifest } from '../employee-provider-pack.js';
import { EmployeeToolCapabilityError, EmployeeToolRegistry } from '../employee-tool-registry.js';
import { createDeclarativeHttpJsonProviderPackFactory } from '../provider-packs/http-json-domain.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';
import { directProviderToolContext, providerRoutes, testLifecycleOptions, withProviderServer } from './http-provider-pack-test-helpers.js';

const human: EntityRef = { entity_id: 'human:supply-owner', kind: 'Human', canonical_label: 'Human.SupplyChainOwner' };
const manifestPath = 'providers/supply-chain-manufacturing-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.ProcurementSpecialistAgent';
const delegation = 'delegation:supply';

test('Supply manifest is complete and makes Procurement Specialist capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.canonical_label, 'ProviderPack.SupplyChainManufacturing.HttpJson');
  assert.deepEqual(manifest.capability_domains, ['supply']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  await packs.activate(manifest.canonical_label, { base_url: 'https://supply.example.test' }, { access_token: 'token' });
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Supply routes execute solely from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl, organization_id: 'supply-1' }, { access_token: 'supply-token' });
    const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)({ sequence: index }, directProviderToolContext(employee, human, `${employeeLabel}.Analyze`, capability, `supply-${index}`, delegation));
    }
    assert.deepEqual(received.map((request) => request.path), manifest.capabilities.map((capability) => routes[capability]));
    for (const request of received) {
      assert.equal(request.headers.authorization, 'Bearer supply-token');
      assert.equal(request.headers['x-h2a2h-delegation-ref'], delegation);
      assert.equal(request.headers['x-h2a2h-organization-id'], 'supply-1');
    }
  });
});

test('WMS query fails closed without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', { status: 200 })));
  await packs.activate(manifest.canonical_label, { base_url: 'https://supply.example.test' }, { access_token: 'token' });
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(employee, human, `${employeeLabel}.Analyze`, 'supply.wms.query', 'supply-no-delegation', delegation);
  delete context.interaction.input.delegation_ref;
  await assert.rejects(async () => tools.resolveExecutor('supply.wms.query')({}, context), (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'http_domain_provider.delegation.missing');
});

test('purchase order above threshold requires Human approval before ERP write', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { access_token: 'token' });
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(employeeLabel, createCapabilityBackedOptionsFactory(tools, async (employee) => testLifecycleOptions(employee, human, delegation, 'responsibility:supply-owner')));
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: `${employeeLabel}.Execute` },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'commit purchase order' },
        operations: [{ tool: 'supply.erp.write', input: { purchase_order: 'PO-1' }, risk_triggers: ['purchase order above threshold'] }],
      },
    };
    await assert.rejects(() => sdk.run(request));
    assert.equal(received.length, 0);
    const approved = await sdk.run({ ...request, input: { ...request.input, human_approval: { granted: true, approved_by: human.entity_id, evidence_ref: 'approval:supply-1' } } });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:supply-1');
  });
});

test('Supply pack fails closed on missing config or secret', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(() => missingConfig.activate(manifest.canonical_label, {}, { access_token: 'token' }));
  const tools2 = await EmployeeToolRegistry.load();
  const manifest2 = await loadEmployeeProviderPackManifest(manifestPath, tools2);
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest2, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(() => missingSecret.activate(manifest2.canonical_label, { base_url: 'https://supply.example.test' }, {}));
});
