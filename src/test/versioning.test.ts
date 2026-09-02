import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertExtensionsSupported,
  assertVersionSelector,
  isProtocolCompatible,
  negotiateVersion,
  parseVersion,
} from '../versioning.js';

test('same major protocol versions are compatible', () => {
  assert.equal(isProtocolCompatible('1.0.0', '1.9.3'), true);
  assert.equal(isProtocolCompatible('1.0.0', '2.0.0'), false);
});

test('strict SemVer rejects leading zeroes and malformed prerelease/build identifiers', () => {
  for (const version of ['01.2.3', '1.02.3', '1.2.03', '1.0.0-01', '1.0', '1garbage.0.0']) {
    assert.throws(() => parseVersion(version), /version\.invalid/);
  }
  assert.deepEqual(parseVersion('1.2.3-alpha.1+build.5'), { major: 1, minor: 2, patch: 3 });
});

test('version selector accepts only concrete SemVer or explicit major.x wildcard', () => {
  assert.doesNotThrow(() => assertVersionSelector('1.2.3'));
  assert.doesNotThrow(() => assertVersionSelector('1.x'));
  for (const selector of ['01.x', '1.y', '1.2.x', 'x']) {
    assert.throws(() => assertVersionSelector(selector), /version\.invalid/);
  }
});

test('negotiation chooses highest mutually compatible concrete version', () => {
  assert.equal(negotiateVersion(['1.0.0', '1.2.0'], ['1.x']), '1.2.0');
  assert.equal(negotiateVersion(['1.x'], ['1.4.0']), '1.4.0');
  assert.throws(() => negotiateVersion(['1.x'], ['1.x']), /version\.no_common_version/);
  assert.throws(() => negotiateVersion(['1.0.0'], ['2.0.0']), /version\.no_common_version/);
});

test('unknown critical extensions fail while optional extensions may pass', () => {
  assert.doesNotThrow(() => assertExtensionsSupported([{ namespace: 'future.optional', critical: false }], []));
  assert.throws(
    () => assertExtensionsSupported([{ namespace: 'future.critical', critical: true }], []),
    /version\.extension_unsupported/,
  );
});
