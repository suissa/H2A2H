import assert from 'node:assert/strict';
import {
  buildCapabilityIndex,
  validateProviderManifestSemantics,
} from './validate-provider-packs.mjs';

const catalog = {
  defaults: {
    provider_required: true,
    provider_bindings: ['in-memory', 'http-json', 'mcp', 'injected'],
  },
  departments: {
    test: {
      tools: ['alpha.read', 'beta.write'],
      side_effects: ['beta.write'],
    },
  },
};
const capabilities = buildCapabilityIndex(catalog);

const valid = {
  canonical_label: 'ProviderPack.Test.HttpJson',
  version: '0.1.0',
  domain: 'test',
  capability_domains: ['alpha', 'beta'],
  provider_kind: 'http-json',
  capabilities: ['alpha.read', 'beta.write'],
  binding: {
    routes: {
      'alpha.read': '/v1/alpha/read',
      'beta.write': '/v1/beta/write',
    },
    authorization: { type: 'bearer', secret: 'access_token' },
    config_headers: { organization_id: 'x-organization-id' },
  },
  config_schema: {
    type: 'object',
    properties: {
      base_url: { type: 'string' },
      organization_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  secrets: [{ name: 'access_token', required: true }],
  runtime: { network: true, protocols: ['HTTP+JSON'] },
};

assert.doesNotThrow(() => validateProviderManifestSemantics(valid, capabilities));

assert.throws(
  () => validateProviderManifestSemantics({ ...valid, capabilities: ['unknown.read'] }, capabilities),
  /unknown capability/,
);
assert.throws(
  () => validateProviderManifestSemantics({
    ...valid,
    binding: { ...valid.binding, routes: { 'alpha.read': '/v1/alpha/read' } },
  }, capabilities),
  /routes must exactly cover/,
);
assert.throws(
  () => validateProviderManifestSemantics({
    ...valid,
    binding: { ...valid.binding, authorization: { type: 'bearer', secret: 'missing_secret' } },
  }, capabilities),
  /undeclared secret/,
);
assert.throws(
  () => validateProviderManifestSemantics({
    ...valid,
    binding: { ...valid.binding, config_headers: { undeclared: 'x-undeclared' } },
  }, capabilities),
  /undeclared config/,
);

console.log('Provider Pack validator self-test passed: malformed semantic bindings fail closed.');
