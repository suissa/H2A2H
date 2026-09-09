import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020Module, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import {
  CryptoSuiteError,
  ROOT_IDENTITY_ARGON2ID_V0_1,
  createCryptoEnvelope,
  deriveArtifactId,
  deriveBranchId,
  deriveDomainKey,
  deriveRootIdentitySeed,
  verifyCryptoEnvelope,
} from '../crypto-suite.js';

interface VectorFile {
  root_identity: { secret: string; salt: string; parameters: unknown; output: string };
  domain_key: { root_seed: string; salt: string; purpose: string; context: string; length: number; output: string };
  artifact: { input: unknown; id: string };
  branch: { input: { parent_id: string; canonical_label: string; ordinal: number; state: unknown }; id: string };
  envelope: {
    private_key_seed: string;
    public_key_spki: string;
    payload: unknown;
    options: {
      key_id: string;
      issuer: string;
      artifact_id: string;
      purpose: string;
      created_at: string;
      expires_at: string;
    };
    output: Record<string, unknown>;
  };
}

interface ValidationFunction {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

interface AjvLike {
  compile(schema: unknown): ValidationFunction;
}

type AjvConstructor = new (options?: Record<string, unknown>) => AjvLike;
const Ajv2020 = Ajv2020Module as unknown as AjvConstructor;
const addFormats = addFormatsModule as unknown as (ajv: AjvLike) => void;
const b64 = (value: Uint8Array): string => Buffer.from(value).toString('base64url');
const bytes = (value: string): Uint8Array => Buffer.from(value, 'base64url');
const vectors = JSON.parse(readFileSync(
  new URL('../../test-vectors/h2a2h-crypto-suite-v0.1.json', import.meta.url),
  'utf8',
)) as VectorFile;

function keys(): { privateKey: ReturnType<typeof createPrivateKey>; publicKey: ReturnType<typeof createPublicKey> } {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(vectors.envelope.private_key_seed, 'base64url'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

test('published vectors reproduce Argon2id root and HKDF-SHA-256 domain keys', () => {
  assert.deepEqual(vectors.root_identity.parameters, ROOT_IDENTITY_ARGON2ID_V0_1);
  const rootSeed = deriveRootIdentitySeed(bytes(vectors.root_identity.secret), bytes(vectors.root_identity.salt));
  assert.equal(b64(rootSeed), vectors.root_identity.output);
  assert.equal(b64(deriveDomainKey(rootSeed, {
    purpose: vectors.domain_key.purpose,
    context: vectors.domain_key.context,
    salt: bytes(vectors.domain_key.salt),
    length: vectors.domain_key.length,
  })), vectors.domain_key.output);
});

test('published BLAKE3 artifact and DAG branch identities are deterministic and domain-separated', () => {
  assert.equal(deriveArtifactId(vectors.artifact.input), vectors.artifact.id);
  assert.equal(deriveArtifactId({
    intent: 'Commerce.PurchaseProducts',
    currency: 'BRL',
    amount: 1250,
    action: 'approve',
  }), vectors.artifact.id);
  assert.equal(deriveBranchId(vectors.branch.input), vectors.branch.id);
  assert.notEqual(deriveBranchId({ ...vectors.branch.input, ordinal: 2 }), vectors.branch.id);
  assert.notEqual(deriveBranchId({ ...vectors.branch.input, state: vectors.artifact.input }), vectors.artifact.id);
});

test('published Ed25519 crypto envelope reproduces and verifies every protected field', () => {
  const { privateKey, publicKey } = keys();
  assert.equal(b64(publicKey.export({ format: 'der', type: 'spki' })), vectors.envelope.public_key_spki);
  const output = createCryptoEnvelope(vectors.envelope.payload, {
    private_key: privateKey,
    key_id: vectors.envelope.options.key_id,
    issuer: vectors.envelope.options.issuer,
    artifact_id: vectors.envelope.options.artifact_id,
    purpose: vectors.envelope.options.purpose,
    created_at: new Date(vectors.envelope.options.created_at),
    expires_at: new Date(vectors.envelope.options.expires_at),
  });
  assert.deepEqual(output, vectors.envelope.output);
  assert.deepEqual(verifyCryptoEnvelope(output, {
    public_key: publicKey,
    now: new Date('2026-09-09T13:00:00.000Z'),
    expected_key_id: vectors.envelope.options.key_id,
    expected_issuer: vectors.envelope.options.issuer,
    expected_artifact_id: vectors.envelope.options.artifact_id,
    expected_purpose: vectors.envelope.options.purpose,
  }), { ok: true, envelope: output });
});

test('crypto envelope rejects protected-header, digest, signature, payload and time mutations', () => {
  const { publicKey } = keys();
  const original = vectors.envelope.output;
  const header = original['protected'] as Record<string, unknown>;
  const digest = original['payload_digest'] as Record<string, unknown>;
  const verify = (value: unknown, now = '2026-09-09T13:00:00.000Z') => verifyCryptoEnvelope(value, {
    public_key: publicKey,
    now: new Date(now),
  });
  const mutations: unknown[] = [
    { ...original, protected: { ...header, key_id: 'key:test-ed25519:2' } },
    { ...original, protected: { ...header, issuer: 'entity:attacker' } },
    { ...original, protected: { ...header, artifact_id: `${header['artifact_id']}-other` } },
    { ...original, protected: { ...header, purpose: 'other-purpose' } },
    { ...original, protected: { ...header, created_at: '2026-09-09T12:01:00.000Z' } },
    { ...original, payload_digest: { ...digest, value: 'A'.repeat(43) } },
    { ...original, signature: `A${String(original['signature']).slice(1)}` },
    { ...original, payload: { action: 'deny' } },
    { ...original, extra: true },
  ];
  for (const mutation of mutations) assert.equal(verify(mutation).ok, false);
  assert.deepEqual(verify(original, '2026-09-10T12:00:00.000Z'), {
    ok: false,
    code: 'crypto.envelope.expired',
  });
});

test('crypto envelope schema validates the vector and rejects extension ambiguity', () => {
  const schema = JSON.parse(readFileSync(
    new URL('../../schemas/h2a2h-crypto-suite-v0.1.schema.json', import.meta.url),
    'utf8',
  )) as unknown;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(vectors.envelope.output), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...vectors.envelope.output, unsigned_extension: true }), false);
});

test('crypto derivation inputs fail closed before expensive or ambiguous work', () => {
  assert.throws(
    () => deriveRootIdentitySeed(new Uint8Array(15), new Uint8Array(16)),
    (error: unknown) => error instanceof CryptoSuiteError && error.code === 'crypto.input.invalid',
  );
  assert.throws(
    () => deriveDomainKey(new Uint8Array(32), {
      purpose: '', context: 'x', salt: new Uint8Array(16), length: 32,
    }),
    /crypto\.input\.invalid/,
  );
  assert.throws(
    () => deriveDomainKey(new Uint8Array(33), {
      purpose: 'test', context: 'x', salt: new Uint8Array(16), length: 32,
    }),
    /crypto\.input\.invalid/,
  );
  assert.throws(
    () => deriveBranchId({ parent_id: 'p', canonical_label: 'x', ordinal: -1, state: {} }),
    /crypto\.input\.invalid/,
  );
  const { privateKey } = keys();
  assert.throws(
    () => createCryptoEnvelope({}, {
      private_key: privateKey,
      key_id: 'key:test',
      issuer: 'entity:test',
      artifact_id: 'not-a-canonical-artifact-id',
      purpose: 'test',
      created_at: new Date('2026-09-09T12:00:00.000Z'),
    }),
    /crypto\.input\.invalid/,
  );
});
