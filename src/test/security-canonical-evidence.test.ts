import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  SecurityCanonicalizationError,
  canonicalJson,
  sha256,
  signEd25519,
  verifyEd25519,
} from '../security.js';

test('canonical JSON is recursive, order-independent and normalizes negative zero', () => {
  const left = { z: [{ b: 2, a: 1 }], a: -0 };
  const right = { a: 0, z: [{ a: 1, b: 2 }] };
  assert.equal(canonicalJson(left), '{"a":0,"z":[{"a":1,"b":2}]}');
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(sha256(left), sha256(right));
});

test('non-JSON JavaScript values fail closed instead of collapsing into ambiguous digests', () => {
  const cases: Array<[unknown, string]> = [
    [undefined, 'security.canonical.undefined'],
    [Number.NaN, 'security.canonical.non_finite_number'],
    [Number.POSITIVE_INFINITY, 'security.canonical.non_finite_number'],
    [new Date('2026-09-02T20:00:00.000Z'), 'security.canonical.non_plain_object'],
    [new Map([['a', 1]]), 'security.canonical.non_plain_object'],
    [new Set([1]), 'security.canonical.non_plain_object'],
    [1n, 'security.canonical.invalid_type'],
  ];
  for (const [value, code] of cases) {
    assert.throws(
      () => canonicalJson(value),
      (error: unknown) => error instanceof SecurityCanonicalizationError && error.code === code,
    );
  }
});

test('canonical JSON rejects sparse/decorated arrays, accessors and cyclic structures', () => {
  const sparse = new Array(2);
  sparse[0] = 1;
  assert.throws(() => canonicalJson(sparse), /security\.canonical\.sparse_array/);

  const decorated = [1] as number[] & { extra?: number };
  decorated.extra = 2;
  assert.throws(() => canonicalJson(decorated), /security\.canonical\.sparse_array/);

  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  assert.throws(() => canonicalJson(accessor), /security\.canonical\.accessor_property/);

  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  assert.throws(() => canonicalJson(cyclic), /security\.canonical\.cycle/);
});

test('valid Ed25519 evidence verifies and isolates payload from later caller mutation', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = { b: 2, nested: { z: true, a: 'x' } };
  const evidence = signEd25519(payload, {
    key_id: 'key:test-ed25519',
    private_key: privateKey,
    created_at: new Date('2026-09-02T20:00:00.000Z'),
  });
  payload.nested.a = 'mutated-after-sign';

  assert.equal(evidence.payload.nested.a, 'x');
  assert.equal(verifyEd25519(evidence, publicKey), true);
});

test('Ed25519 verification rejects every authority-critical metadata mutation', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const evidence = signEd25519({ action: 'approve', amount: 10 }, {
    key_id: 'key:approval',
    private_key: privateKey,
    created_at: new Date('2026-09-02T20:00:00.000Z'),
  });

  const mutations: unknown[] = [
    { ...evidence, profile: 'other.profile' },
    { ...evidence, algorithm: 'RSA' },
    { ...evidence, key_id: '' },
    { ...evidence, created_at: 'not-a-date' },
    { ...evidence, payload_digest: { ...evidence.payload_digest, algorithm: 'sha-1' } },
    { ...evidence, payload_digest: { ...evidence.payload_digest, value: 'not-base64url' } },
    { ...evidence, signature: 'invalid' },
    { ...evidence, payload: { action: 'deny', amount: 10 } },
    { ...evidence, unexpected: true },
  ];
  for (const mutation of mutations) assert.equal(verifyEd25519(mutation, publicKey), false);
});

test('verification rejects malformed non-JSON payload without throwing through the boundary', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const evidence = signEd25519({ ok: true }, {
    key_id: 'key:test',
    private_key: privateKey,
    created_at: new Date('2026-09-02T20:00:00.000Z'),
  });
  const forged = { ...evidence, payload: new Date() };
  assert.doesNotThrow(() => verifyEd25519(forged, publicKey));
  assert.equal(verifyEd25519(forged, publicKey), false);
});

test('signing rejects missing key id, invalid timestamp and non-canonical payload', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  assert.throws(
    () => signEd25519({ ok: true }, { key_id: ' ', private_key: privateKey }),
    /security\.evidence\.key_id_required/,
  );
  assert.throws(
    () => signEd25519({ ok: true }, { key_id: 'key:test', private_key: privateKey, created_at: new Date(Number.NaN) }),
    /security\.evidence\.created_at_invalid/,
  );
  assert.throws(
    () => signEd25519({ invalid: undefined }, { key_id: 'key:test', private_key: privateKey }),
    /security\.canonical\.undefined/,
  );
});
