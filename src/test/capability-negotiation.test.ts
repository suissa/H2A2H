import assert from 'node:assert/strict';
import test from 'node:test';
import {
  negotiateCapabilities,
  resolveCapabilityHandlers,
  resolveSemanticExtensions,
  type CapabilityNegotiationRequest,
} from '../capability-negotiation.js';

const requester = { entity_id: 'agent:student', kind: 'Agent' as const, canonical_label: 'education.personal_agent' };
const provider = { entity_id: 'school:example', kind: 'School' as const, canonical_label: 'education.school.example' };

function requestWithOrder(reverse = false): CapabilityNegotiationRequest {
  const requesterCapabilities = [
    { canonical_label: 'org.h2a2h.vaal', versions: ['1.0.0'] },
    { canonical_label: 'transport.quic', versions: ['1.0.0', '1.1.0'] },
    { canonical_label: 'education.records.vc', versions: ['1.0.0', '1.1.0'] },
  ];
  const providerCapabilities = [
    { canonical_label: 'transport.quic', versions: ['1.1.0'] },
    { canonical_label: 'education.records.vc', versions: ['1.1.0', '2.0.0'] },
    { canonical_label: 'org.h2a2h.vaal', versions: ['1.0.0'] },
  ];
  return {
    requester,
    provider,
    requester_capabilities: reverse ? [...requesterCapabilities].reverse() : requesterCapabilities,
    provider_capabilities: reverse ? [...providerCapabilities].reverse() : providerCapabilities,
    intent_requirements: [
      { canonical_label: 'education.records.vc', acceptable_versions: ['1.1.0'] },
    ],
    authorization_requirements: [
      { canonical_label: 'org.h2a2h.vaal' },
    ],
  };
}

test('negotiates the deterministic intersection required by intent and authorization', () => {
  const result = negotiateCapabilities(requestWithOrder());
  assert.equal(result.status, 'compatible');
  assert.deepEqual(
    result.selected.map(({ canonical_label, selected_version }) => ({ canonical_label, selected_version })),
    [
      { canonical_label: 'education.records.vc', selected_version: '1.1.0' },
      { canonical_label: 'org.h2a2h.vaal', selected_version: '1.0.0' },
      { canonical_label: 'transport.quic', selected_version: '1.1.0' },
    ],
  );
  assert.deepEqual(result.missing_required, []);
});

test('negotiation hash is stable across declaration order', () => {
  const first = negotiateCapabilities(requestWithOrder(false));
  const second = negotiateCapabilities(requestWithOrder(true));
  assert.equal(first.hashes.negotiation_hash, second.hashes.negotiation_hash);
  assert.equal(first.hashes.requester_capabilities_hash, second.hashes.requester_capabilities_hash);
  assert.equal(first.hashes.provider_capabilities_hash, second.hashes.provider_capabilities_hash);
});

test('fails closed when a required semantic capability is missing', () => {
  const request = requestWithOrder();
  request.authorization_requirements = [
    { canonical_label: 'org.h2a2h.vaal' },
    { canonical_label: 'authorization.hardware-bound' },
  ];
  const result = negotiateCapabilities(request);
  assert.equal(result.status, 'incompatible');
  assert.deepEqual(result.missing_required, ['authorization.hardware-bound']);
});

test('resolves semantic extensions and action handlers from the negotiated set', () => {
  const negotiation = negotiateCapabilities(requestWithOrder());
  const extensions = resolveSemanticExtensions(
    ['education.vc.selective-disclosure'],
    [
      {
        canonical_label: 'education.vc.selective-disclosure',
        version: '1.0.0',
        extends: ['education.records.vc'],
        schema: 'https://example.test/schema.json',
      },
    ],
    ['education.vc.selective-disclosure'],
  );
  assert.equal(extensions.missing_critical.length, 0);
  assert.equal(extensions.active[0]?.canonical_label, 'education.vc.selective-disclosure');

  const handlers = resolveCapabilityHandlers({
    negotiated_capabilities: negotiation.selected,
    channel: 'transport.quic',
    authorization_profile: 'org.h2a2h.vaal',
    handlers: [
      {
        id: 'school-vc-quic',
        canonical_label: 'education.records.vc.quic',
        capability: 'education.records.vc',
        version: '1.0.0',
        spec: 'https://example.test/spec',
        config_schema: 'https://example.test/config.schema.json',
        input_schema: 'https://example.test/input.schema.json',
        output_schema: 'https://example.test/output.schema.json',
        channels: ['transport.quic'],
        authorization_profiles: ['org.h2a2h.vaal'],
        config: {},
      },
      {
        id: 'school-vc-http',
        canonical_label: 'education.records.vc.http',
        capability: 'education.records.vc',
        version: '1.0.0',
        spec: 'https://example.test/spec-http',
        config_schema: 'https://example.test/config-http.schema.json',
        input_schema: 'https://example.test/input-http.schema.json',
        output_schema: 'https://example.test/output-http.schema.json',
        channels: ['transport.https'],
        authorization_profiles: ['org.h2a2h.vaal'],
        config: {},
      },
    ],
  });
  assert.deepEqual(handlers.map((handler) => handler.id), ['school-vc-quic']);
});
