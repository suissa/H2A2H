import assert from 'node:assert/strict';
import test from 'node:test';
import { H2A2HSDK } from '../sdk.js';
import { ProtocolRegistry } from '../registry.js';

test('SDK does not expose mutable runtime authority surfaces', () => {
  const registry = new ProtocolRegistry();
  const sdk = new H2A2HSDK({
    execute: async () => ({ ok: true }),
  } as never, { registry });

  assert.equal((sdk as unknown as { checkpoints?: unknown }).checkpoints, undefined);
  assert.equal((sdk as unknown as { runtime?: unknown }).runtime, undefined);
  assert.equal((sdk as unknown as { registry?: unknown }).registry, undefined);
  assert.equal(registry.isSealed(), true);
  assert.throws(() => registry.register('late', { protocol: 'h2a2h', version: '1.0.0' }), /registry is sealed/i);
});
