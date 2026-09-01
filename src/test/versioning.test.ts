import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExtensionsSupported, isProtocolCompatible, negotiateVersion } from '../versioning.js';

test('same major protocol versions are compatible', () => {
  assert.equal(isProtocolCompatible('1.0.0', '1.9.3'), true);
  assert.equal(isProtocolCompatible('1.0.0', '2.0.0'), false);
});

test('negotiation chooses highest mutually compatible concrete version', () => {
  assert.equal(negotiateVersion(['1.0.0', '1.2.0'], ['1.x']), '1.2.0');
  assert.throws(() => negotiateVersion(['1.0.0'], ['2.0.0']), /version\.no_common_version/);
});

test('unknown critical extensions fail while optional extensions may pass', () => {
  assert.doesNotThrow(() => assertExtensionsSupported([{ namespace: 'future.optional', critical: false }], []));
  assert.throws(
    () => assertExtensionsSupported([{ namespace: 'future.critical', critical: true }], []),
    /version\.extension_unsupported/,
  );
});
