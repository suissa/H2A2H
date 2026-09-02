import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilityBackedOptionsFactory } from '../employee-tool-binding.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import { EmployeeProviderPackRegistry, loadEmployeeProviderPackManifest, providerPackCapabilityDomains } from '../employee-provider-pack.js';
import { EmployeeToolCapabilityError, EmployeeToolRegistry } from '../employee-tool-registry.js';
import { createDeclarativeHttpJsonProviderPackFactory } from '../provider-packs/http-json-domain.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef } from '../types.js';
import { directProviderToolContext, providerRoutes, testLifecycleOptions, withProviderServer } from './http-provider-pack-test-helpers.js';

const human: EntityRef = { entity_id: 'human:corporate-owner', kind: 'Human', canonical_label: 'Human.CorporateAffairsOwner' };
const manifestPath = 'providers/corporate-affairs-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.CorporateSecretaryAgent';
const delegation = 'delegation:corporate-affairs';

test('Corporate Affairs manifest spans corp and stakeholder and completes Corporate Secretary', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.canonical_label, 'ProviderPack.CorporateAffairs.HttpJson');
  assert.deepEqual(providerPackCapabilityDomains(manifest).sort(), ['corp', 'stakeholder']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  await packs.activate(manifest.canonical_label, { base_url: 'https://corp.example.test' }, { access_token: 'token' });
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Corporate Affairs routes execute solely from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl, organization_id: 'corp-1' }, { access_token: 'corp-token' });
    const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)({ sequence: index }, directProviderToolContext(employee, human, `${employeeLabel}.Analyze`, capability, `corp-${index}`, delegation));
    }
    assert.deepEqual(received.map((request) => request.path), manifest.capabilities.map((capability) => routes[capability]));
    for (const request of received) {
      assert.equal(request.headers.authorization, 'Bearer corp-token');
      assert.equal(request.headers['x-h2a2h-delegation-ref'], delegation);
      assert.equal(request.headers['x-h2a2h-organization-id'], 'corp-1');
    }
  });
});

test('stakeholder CRM read fails closed without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', { status: 200 })));
  await packs.activate(manifest.canonical_label, { base_url: 'https://corp.example.test' }, { access_token: 'token' });
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(employee, human, `${employeeLabel}.Analyze`, 'stakeholder.crm.read', 'corp-no-delegation', delegation);
  delete context.interaction.input.delegation_ref;
  await assert.rejects(async () => tools.resolveExecutor('stakeholder.crm.read')({}, context), (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'http_domain_provider.delegation.missing');
});

test('regulatory/public filing remains Human-approved above provider binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { access_token: 'token' });
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(employeeLabel, createCapabilityBackedOptionsFactory(tools, async (employee) => testLifecycleOptions(employee, human, delegation, 'responsibility:corporate-owner')));
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: `${employeeLabel}.Execute` },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'prepare regulated filing' },
        operations: [{ tool: 'corp.filings.prepare', input: { filing: 'public-regulatory-1' }, risk_triggers: ['regulatory/public filing'] }],
      },
    };
    await assert.rejects(() => sdk.run(request));
    assert.equal(received.length, 0);
    const approved = await sdk.run({ ...request, input: { ...request.input, human_approval: { granted: true, approved_by: human.entity_id, evidence_ref: 'approval:corporate-filing-1' } } });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:corporate-filing-1');
  });
});

test('Corporate Affairs pack fails closed on missing config or secret', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(() => missingConfig.activate(manifest.canonical_label, {}, { access_token: 'token' }));
  const tools2 = await EmployeeToolRegistry.load();
  const manifest2 = await loadEmployeeProviderPackManifest(manifestPath, tools2);
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest2, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(() => missingSecret.activate(manifest2.canonical_label, { base_url: 'https://corp.example.test' }, {}));
});
