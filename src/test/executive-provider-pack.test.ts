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

const human: EntityRef = { entity_id: 'human:board-principal', kind: 'Human', canonical_label: 'Human.BoardPrincipal' };
const manifestPath = 'providers/executive-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.ChiefExecutiveOfficerAgent';
const delegation = 'delegation:executive';

test('Executive manifest is complete and makes CEO capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.canonical_label, 'ProviderPack.Executive.HttpJson');
  assert.deepEqual(manifest.capability_domains, ['enterprise']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  await packs.activate(manifest.canonical_label, { base_url: 'https://executive.example.test' }, { access_token: 'token' });
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Executive routes execute solely from manifest binding', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl, organization_id: 'enterprise-1' }, { access_token: 'executive-token' });
    const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
    for (const [index, capability] of manifest.capabilities.entries()) {
      await tools.resolveExecutor(capability)({ sequence: index }, directProviderToolContext(employee, human, `${employeeLabel}.Analyze`, capability, `executive-${index}`, delegation));
    }
    assert.deepEqual(received.map((request) => request.path), manifest.capabilities.map((capability) => routes[capability]));
    for (let index = 0; index < received.length; index += 1) {
      assert.equal(received[index]?.headers.authorization, 'Bearer executive-token');
      assert.equal(received[index]?.headers['x-h2a2h-delegation-ref'], delegation);
      assert.equal(received[index]?.headers['x-h2a2h-organization-id'], 'enterprise-1');
      assert.equal(received[index]?.headers['x-h2a2h-correlation-id'], `correlation:executive-${index}`);
    }
  });
});

test('strategy read fails closed without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () => new Response('{}', { status: 200 })));
  await packs.activate(manifest.canonical_label, { base_url: 'https://executive.example.test' }, { access_token: 'token' });
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(employee, human, `${employeeLabel}.Analyze`, 'enterprise.strategy.read', 'executive-no-delegation', delegation);
  delete context.interaction.input.delegation_ref;
  await assert.rejects(async () => tools.resolveExecutor('enterprise.strategy.read')({}, context), (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'http_domain_provider.delegation.missing');
});

test('irreversible strategic action requires Human approval before provider call', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(manifest.canonical_label, { base_url: baseUrl }, { access_token: 'token' });
    const employees = await EmployeeAgentRegistry.fromCatalog();
    const runtime = await employees.createRuntime(employeeLabel, createCapabilityBackedOptionsFactory(tools, async (employee) => testLifecycleOptions(employee, human, delegation, 'responsibility:board-principal')));
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: `${employeeLabel}.Execute` },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'record irreversible strategy' },
        operations: [{ tool: 'enterprise.decision.record', input: { decision: 'irreversible' }, risk_triggers: ['irreversible strategic action'] }],
      },
    };
    const denied = await sdk.run(request);
    assert.equal(denied.state, 'HUMAN_ESCALATION_REQUIRED');
    assert.equal(denied.human_escalation?.code, 'human.approval_required');
    assert.equal(received.length, 0);
    const approved = await sdk.run({ ...request, input: { ...request.input, human_approval: { granted: true, approved_by: human.entity_id, evidence_ref: 'approval:executive-1' } } });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:executive-1');
  });
});

test('Executive pack fails closed on missing config or secret', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const missingConfig = new EmployeeProviderPackRegistry(tools);
  missingConfig.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(() => missingConfig.activate(manifest.canonical_label, {}, { access_token: 'token' }));
  const tools2 = await EmployeeToolRegistry.load();
  const manifest2 = await loadEmployeeProviderPackManifest(manifestPath, tools2);
  const missingSecret = new EmployeeProviderPackRegistry(tools2);
  missingSecret.register(manifest2, createDeclarativeHttpJsonProviderPackFactory());
  await assert.rejects(() => missingSecret.activate(manifest2.canonical_label, { base_url: 'https://executive.example.test' }, {}));
});
