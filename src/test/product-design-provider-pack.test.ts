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
  entity_id: 'human:product-owner',
  kind: 'Human',
  canonical_label: 'Human.ProductDesignOwner',
};
const manifestPath = 'providers/product-design-http-json/manifest.json';
const employeeLabel = 'Enterprise.Employee.ProductManagerAgent';
const analyzeIntent = `${employeeLabel}.Analyze`;
const executeIntent = `${employeeLabel}.Execute`;
const delegation = 'delegation:product-design';

test('Product/Design manifest spans product, research and design capability domains', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  assert.equal(manifest.canonical_label, 'ProviderPack.ProductDesign.HttpJson');
  assert.equal(manifest.domain, 'product-design');
  assert.deepEqual(providerPackCapabilityDomains(manifest).sort(), ['design', 'product', 'research']);
  assert.deepEqual(Object.keys(providerRoutes(manifest)).sort(), manifest.capabilities.slice().sort());
  assert.equal(manifest.binding?.authorization.secret, 'access_token');
});

test('one Product/Design manifest makes Product Manager capability-complete', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://product.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  assert.doesNotThrow(() => tools.assertEmployeeReady(employee));
});

test('Product/Design routes execute directly from manifest with H2A2H metadata', async () => {
  await withProviderServer(async (baseUrl, received) => {
    const tools = await EmployeeToolRegistry.load();
    const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
    const routes = providerRoutes(manifest);
    const packs = new EmployeeProviderPackRegistry(tools);
    packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory());
    await packs.activate(
      manifest.canonical_label,
      { base_url: baseUrl, organization_id: 'org-product-1', timeout_ms: 5000 },
      { access_token: 'product-token' },
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
          `product-${index}`,
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
      assert.equal(request.headers.authorization, 'Bearer product-token');
      assert.equal(request.headers['x-h2a2h-capability'], capability);
      assert.equal(request.headers['x-h2a2h-delegation-ref'], delegation);
      assert.equal(request.headers['x-h2a2h-organization-id'], 'org-product-1');
      assert.equal(request.headers['x-h2a2h-correlation-id'], `correlation:product-${index}`);
      assert.equal(request.body.capability, capability);
    }
  });
});

test('research repository access fails closed without delegation', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest(manifestPath, tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createDeclarativeHttpJsonProviderPackFactory(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
  await packs.activate(
    manifest.canonical_label,
    { base_url: 'https://product.example.test' },
    { access_token: 'token' },
  );
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(employeeLabel);
  const context = directProviderToolContext(
    employee,
    human,
    analyzeIntent,
    'research.repository.query',
    'product-no-delegation',
    delegation,
  );
  delete context.interaction.input.delegation_ref;
  await assert.rejects(
    async () => tools.resolveExecutor('research.repository.query')({}, context),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError &&
      error.code === 'http_domain_provider.delegation.missing',
  );
});

test('roadmap commitment remains Human-approved above Product provider binding', async () => {
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
        testLifecycleOptions(employee, human, delegation, 'responsibility:product-owner'),
      ),
    );
    const sdk = new H2A2HSDK(runtime.bindings());
    const request = {
      initiating_human: human,
      intent: { canonical_label: executeIntent },
      input: {
        delegation_ref: delegation,
        request_payload: { action: 'commit roadmap item' },
        operations: [{
          tool: 'product.backlog.write',
          input: { item: 'feature-1', commitment: 'next release' },
          risk_triggers: ['roadmap commitment'],
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
          evidence_ref: 'approval:product-roadmap-1',
        },
      },
    });
    assert.equal(approved.state, 'CLOSED');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.headers['x-h2a2h-approval-evidence'], 'approval:product-roadmap-1');
  });
});

test('Product/Design Provider Pack fails closed on missing config or secret', async () => {
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
    () => missingSecret.activate(manifest2.canonical_label, { base_url: 'https://product.example.test' }, {}),
    (error: unknown) =>
      error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.secret.missing',
  );
});
