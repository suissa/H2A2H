import assert from 'node:assert/strict';
import test from 'node:test';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  EmployeeProviderPackRegistry,
  createHttpJsonProviderPackFactory,
  createInMemoryProviderPackFactory,
  loadEmployeeProviderPackManifest,
  type EmployeeProviderPackManifest,
} from '../employee-provider-pack.js';
import { EmployeeToolCapabilityError, EmployeeToolRegistry } from '../employee-tool-registry.js';

const commerceCapabilities = [
  'commerce.catalog.search',
  'commerce.offer.compare',
  'commerce.cart.prepare',
  'commerce.order.status',
  'commerce.purchase.request',
];

function commerceHandlers() {
  return Object.fromEntries(
    commerceCapabilities.map((label) => [label, async (input: unknown) => ({ capability: label, input })]),
  );
}

test('loads and registers a machine-readable commerce Provider Pack', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest('providers/reference-commerce/manifest.json', tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createInMemoryProviderPackFactory('reference:commerce', commerceHandlers()));

  assert.equal(manifest.canonical_label, 'ProviderPack.Commerce.Reference');
  assert.equal(manifest.domain, 'commerce');
  assert.equal(manifest.capabilities.length, 5);
  assert.deepEqual(packs.list({ domain: 'commerce' }).map((entry) => entry.canonical_label), [
    'ProviderPack.Commerce.Reference',
  ]);
});

test('activating one Provider Pack makes every Personal Shopper business capability ready', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest('providers/reference-commerce/manifest.json', tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createInMemoryProviderPackFactory('reference:commerce', commerceHandlers()));
  const active = await packs.activate(manifest.canonical_label);

  assert.equal(active.capabilityProviders.size, 5);
  const employees = await EmployeeAgentRegistry.fromCatalog();
  const shopper = await employees.load('Enterprise.Employee.PersonalShopperAgent');
  assert.doesNotThrow(() => tools.assertEmployeeReady(shopper));
});

test('Provider Pack execution preserves canonical capability identity through the Tool Registry', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest('providers/reference-commerce/manifest.json', tools);
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(manifest, createInMemoryProviderPackFactory('reference:commerce', commerceHandlers()));
  await packs.activate(manifest.canonical_label);

  const shopper = await (await EmployeeAgentRegistry.fromCatalog()).load('Enterprise.Employee.PersonalShopperAgent');
  const executor = tools.resolveExecutor('commerce.catalog.search');
  const result = await executor({ query: 'laptop' }, {
    employee: shopper,
    operation: { tool: 'commerce.catalog.search', input: { query: 'laptop' } },
    interaction: {
      interaction_id: 'interaction:provider-pack',
      correlation_id: 'correlation:provider-pack',
      state: 'EXECUTING',
      initiating_human: {
        entity_id: 'human:shopper',
        kind: 'Human',
        canonical_label: 'Human.Shopper',
      },
      intent: {
        ref: {
          canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Analyze',
          version: '0.1.0',
        },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: { delegation_ref: 'delegation:valid', request_payload: {} },
      transitions: [],
    },
  });

  assert.deepEqual(result, {
    capability: 'commerce.catalog.search',
    input: { query: 'laptop' },
  });
});

test('Provider Pack rejects capability/domain mismatch', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest = await loadEmployeeProviderPackManifest('providers/reference-commerce/manifest.json', tools);
  const invalid: EmployeeProviderPackManifest = {
    ...manifest,
    canonical_label: 'ProviderPack.Finance.Invalid',
    domain: 'finance',
  };
  const packs = new EmployeeProviderPackRegistry(tools);
  assert.throws(
    () => packs.register(invalid, createInMemoryProviderPackFactory('invalid', commerceHandlers())),
    (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.capability.domain_mismatch',
  );
});

test('Provider Pack fails closed when required configuration is absent', async () => {
  const tools = await EmployeeToolRegistry.load();
  const manifest: EmployeeProviderPackManifest = {
    canonical_label: 'ProviderPack.Finance.HttpReference',
    version: '0.1.0',
    domain: 'finance',
    provider_kind: 'http-json',
    capabilities: ['finance.erp.read'],
    config_schema: {
      type: 'object',
      required: ['base_url'],
      properties: { base_url: { type: 'string' } },
      additionalProperties: false,
    },
    secrets: [],
    runtime: { network: true, protocols: ['HTTP+JSON'] },
  };
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(
    manifest,
    createHttpJsonProviderPackFactory('finance:http', () => 'https://finance.example.invalid/tool'),
  );

  await assert.rejects(
    () => packs.activate(manifest.canonical_label),
    (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.config.missing',
  );
});

test('two active Provider Packs cannot ambiguously own the same capability', async () => {
  const tools = await EmployeeToolRegistry.load();
  const base = await loadEmployeeProviderPackManifest('providers/reference-commerce/manifest.json', tools);
  const first: EmployeeProviderPackManifest = {
    ...base,
    canonical_label: 'ProviderPack.Commerce.First',
    capabilities: ['commerce.catalog.search'],
  };
  const second: EmployeeProviderPackManifest = {
    ...base,
    canonical_label: 'ProviderPack.Commerce.Second',
    capabilities: ['commerce.catalog.search'],
  };
  const packs = new EmployeeProviderPackRegistry(tools);
  packs.register(first, createInMemoryProviderPackFactory('first', commerceHandlers()));
  packs.register(second, createInMemoryProviderPackFactory('second', commerceHandlers()));
  await packs.activate(first.canonical_label);

  await assert.rejects(
    () => packs.activate(second.canonical_label),
    (error: unknown) => error instanceof EmployeeToolCapabilityError && error.code === 'provider_pack.capability.ambiguous',
  );
});
