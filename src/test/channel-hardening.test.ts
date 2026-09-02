import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChannelForger,
  InMemoryChannelAdapter,
  type ChannelAdapter,
  type ChannelDeclaration,
} from '../channels.js';
import type { H2A2HEnvelope } from '../types.js';

function declaration(overrides: Partial<ChannelDeclaration> = {}): ChannelDeclaration {
  return {
    channel_id: 'channel:test',
    transport: 'in-memory',
    mode: 'request_reply',
    endpoint: { address: 'test.snapshot' },
    versions: ['1.x'],
    security: { profile: 'h2a2h.security.local-trusted.v1' },
    ...overrides,
  };
}

function envelope(): H2A2HEnvelope {
  return {
    protocol: 'h2a2h',
    version: '1.0.0',
    message_id: 'msg:channel-hardening',
    interaction_id: 'interaction:channel-hardening',
    correlation_id: 'correlation:channel-hardening',
    kind: 'request',
    intent: { canonical_label: 'Test.Echo', version: '1.0.0' },
    sender: { entity_id: 'agent:a', kind: 'Agent' },
    receiver: { entity_id: 'agent:b', kind: 'Agent' },
    timestamp: '2026-09-02T19:00:00.000Z',
    payload: { schema: 'schema://test', value: { ok: true } },
  };
}

test('forged in-memory adapter keeps an immutable snapshot after caller mutates declaration', async () => {
  const source = declaration();
  const server = new InMemoryChannelAdapter(source);
  const client = new InMemoryChannelAdapter(source);
  const dispose = server.respond((request) => ({ ...request, kind: 'response', message_id: 'msg:response' }));

  source.endpoint!['address'] = 'forged.other-address';
  source.security.profile = 'forged.profile';
  source.versions[0] = '9.x';

  const response = await client.request(envelope());
  assert.equal(response.kind, 'response');
  assert.equal(client.declaration.endpoint?.['address'], 'test.snapshot');
  assert.equal(client.declaration.security.profile, 'h2a2h.security.local-trusted.v1');
  assert.deepEqual(client.declaration.versions, ['1.x']);
  assert.equal(Object.isFrozen(client.declaration), true);
  assert.equal(Object.isFrozen(client.declaration.endpoint), true);
  assert.equal(Object.isFrozen(client.declaration.security), true);
  dispose();
});

test('custom factory receives a validated frozen clone rather than caller-owned declaration', () => {
  const forger = new ChannelForger();
  let seen: ChannelDeclaration | undefined;
  forger.register('custom', (input): ChannelAdapter => {
    seen = input;
    return {
      declaration: input,
      capabilities: () => ({ mode: input.mode, ordered: false, reliable: false, streaming: false }),
      send: async () => {},
      request: async (request) => request,
      close: async () => {},
    };
  });
  const source = declaration({ transport: 'custom', endpoint: { target: 'one' } });
  forger.forge(source);
  source.endpoint!['target'] = 'two';

  assert.ok(seen);
  assert.equal(seen.endpoint?.['target'], 'one');
  assert.notEqual(seen, source);
  assert.equal(Object.isFrozen(seen), true);
});

test('malformed version selectors fail before adapter factory invocation', () => {
  const forger = new ChannelForger();
  for (const version of ['1garbage.0.0', '01.0.0', '1.y', '1.2']) {
    assert.throws(() => forger.forge(declaration({ versions: [version] })), /channel\.version_invalid/);
  }
  assert.throws(() => forger.resolve(['1garbage.0.0'], [declaration()]), /channel\.version_invalid/);
});

test('resolution uses shared version negotiation and skips incompatible declarations deterministically', () => {
  const forger = new ChannelForger();
  const adapter = forger.resolve(['1.2.0'], [
    declaration({ channel_id: 'channel:v2', endpoint: { address: 'v2' }, versions: ['2.x'] }),
    declaration({ channel_id: 'channel:v1', endpoint: { address: 'v1' }, versions: ['1.x'] }),
  ]);
  assert.equal(adapter.declaration.channel_id, 'channel:v1');
});

test('invalid capability constraints and HTTP transport mismatch fail closed', () => {
  const forger = new ChannelForger();
  assert.throws(
    () => forger.forge(declaration({ capabilities: { max_payload_bytes: 0 } })),
    /channel\.max_payload_bytes_invalid/,
  );
  assert.throws(
    () => forger.forge(declaration({ transport: 'https', endpoint: { url: 'http://example.test/h2a2h' } })),
    /channel\.http\.transport_mismatch/,
  );
});

test('channel transport factories are write-once to prevent runtime replacement', () => {
  const forger = new ChannelForger();
  assert.throws(
    () => forger.register('in-memory', () => new InMemoryChannelAdapter(declaration())),
    /channel\.factory_already_registered:in-memory/,
  );
});
