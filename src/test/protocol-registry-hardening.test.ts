import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtocolRegistry, ProtocolRegistryError } from '../registry.js';

const artifact = {
  protocol: 'openintent',
  version: '1.2.3',
  canonical_label: 'Commerce.PurchaseProducts',
  metadata: { stable: true },
};

test('protocol artifact ids are write-once while exact canonical replay is idempotent', () => {
  const registry = new ProtocolRegistry();
  registry.register('intent:purchase', artifact);
  registry.register('intent:purchase', {
    metadata: { stable: true },
    canonical_label: 'Commerce.PurchaseProducts',
    version: '1.2.3',
    protocol: 'openintent',
  });

  assert.throws(
    () => registry.register('intent:purchase', { ...artifact, version: '1.2.4' }),
    (error: unknown) => error instanceof ProtocolRegistryError && error.code === 'artifact.already_registered',
  );
});

test('sealed registry rejects every later write', () => {
  const registry = new ProtocolRegistry({ first: artifact });
  registry.seal();
  assert.equal(registry.isSealed(), true);
  assert.throws(
    () => registry.register('second', { protocol: 'openintent', version: '1.0.0' }),
    (error: unknown) => error instanceof ProtocolRegistryError && error.code === 'registry.sealed',
  );
});

test('constructor and get boundaries clone caller-owned protocol artifacts', () => {
  const source = { ...artifact, metadata: { stable: true } };
  const registry = new ProtocolRegistry({ purchase: source });
  source.metadata.stable = false;

  const first = registry.get<typeof source>('purchase');
  assert.equal(first.metadata.stable, true);
  first.metadata.stable = false;
  assert.equal(registry.get<typeof source>('purchase').metadata.stable, true);
});

test('malformed semantic versions fail registration instead of being interpreted by major prefix', () => {
  const registry = new ProtocolRegistry();
  for (const version of ['1', '1.x', '1.2', '1garbage.0.0', '01.2.3']) {
    assert.throws(
      () => registry.register(`bad:${version}`, { protocol: 'openintent', version }),
      (error: unknown) => error instanceof ProtocolRegistryError && error.code === 'artifact.version_invalid',
    );
  }
});

test('requireProtocol uses strict parsed SemVer major and validates requested major', () => {
  const registry = new ProtocolRegistry({ purchase: artifact });
  assert.equal(registry.requireProtocol('purchase', 'openintent', 1).version, '1.2.3');
  assert.throws(
    () => registry.requireProtocol('purchase', 'openintent', 2),
    (error: unknown) => error instanceof ProtocolRegistryError && error.code === 'artifact.version_incompatible',
  );
  assert.throws(
    () => registry.requireProtocol('purchase', 'openintent', Number.NaN),
    (error: unknown) => error instanceof ProtocolRegistryError && error.code === 'artifact.compatible_major_invalid',
  );
});

test('registry list order is deterministic by artifact id', () => {
  const registry = new ProtocolRegistry();
  registry.register('z-last', { protocol: 'h2a2h', version: '1.0.0' });
  registry.register('a-first', { protocol: 'h2a2h', version: '1.0.0' });
  registry.register('m-middle', { protocol: 'other', version: '1.0.0' });

  assert.deepEqual(registry.list().map((entry) => entry.id), ['a-first', 'm-middle', 'z-last']);
  assert.deepEqual(registry.list('h2a2h').map((entry) => entry.id), ['a-first', 'z-last']);
});
