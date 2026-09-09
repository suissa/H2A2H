import { createHash, sign, verify, type KeyLike } from 'node:crypto';
import { argon2id } from '@noble/hashes/argon2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js';
import { canonicalJson } from './security.js';

const textEncoder = new TextEncoder();

export const H2A2H_CRYPTO_SUITE_V0_1 = 'h2a2h.crypto-suite.v0.1' as const;
export const H2A2H_CANONICAL_JSON_V1 = 'h2a2h.canonical-json.v1' as const;

export const ROOT_IDENTITY_ARGON2ID_V0_1 = Object.freeze({
  algorithm: 'Argon2id' as const,
  version: 0x13 as const,
  memory_kib: 65_536 as const,
  iterations: 3 as const,
  parallelism: 4 as const,
  output_bytes: 32 as const,
});

const ARTIFACT_CONTEXT = textEncoder.encode('H2A2H 2026-09-09 artifact-id v0.1');
const BRANCH_CONTEXT = textEncoder.encode('H2A2H 2026-09-09 branch-id v0.1');
const ARTIFACT_ID_PATTERN = /^h2a2h:artifact:blake3-256:[A-Za-z0-9_-]{43}$/;

export class CryptoSuiteError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}:${message}`);
    this.name = 'CryptoSuiteError';
  }
}

export interface CryptoProtectedHeader {
  suite: typeof H2A2H_CRYPTO_SUITE_V0_1;
  serialization: typeof H2A2H_CANONICAL_JSON_V1;
  digest_algorithm: 'sha-256';
  signature_algorithm: 'Ed25519';
  key_id: string;
  issuer: string;
  artifact_id: string;
  purpose: string;
  created_at: string;
  expires_at: string | null;
}

export interface H2A2HCryptoEnvelope<T = unknown> {
  protected: CryptoProtectedHeader;
  payload_digest: { algorithm: 'sha-256'; value: string };
  signature: string;
  payload: T;
}

export type CryptoVerificationCode =
  | 'crypto.envelope.malformed'
  | 'crypto.envelope.not_yet_valid'
  | 'crypto.envelope.expired'
  | 'crypto.envelope.expectation_mismatch'
  | 'crypto.envelope.digest_mismatch'
  | 'crypto.envelope.invalid_signature';

export type CryptoVerification<T> =
  | { ok: true; envelope: H2A2HCryptoEnvelope<T> }
  | { ok: false; code: CryptoVerificationCode };

function requireBytes(value: Uint8Array, name: string, minimumLength: number): void {
  if (!(value instanceof Uint8Array) || value.byteLength < minimumLength) {
    throw new CryptoSuiteError('crypto.input.invalid', `${name} must contain at least ${minimumLength} bytes`);
  }
}

function requireExactBytes(value: Uint8Array, name: string, length: number): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    throw new CryptoSuiteError('crypto.input.invalid', `${name} must contain exactly ${length} bytes`);
  }
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CryptoSuiteError('crypto.input.invalid', `${name} is required`);
  }
}

function requireIsoInstant(value: string, name: string): Date {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CryptoSuiteError('crypto.input.invalid', `${name} must be a canonical ISO instant`);
  }
  return parsed;
}

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function strictBase64Url(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === expectedBytes && decoded.toString('base64url') === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

/**
 * Derives secret root identity material using the fixed RFC 9106 low-memory
 * profile. Callers must keep the result secret and wipe caller-owned buffers.
 */
export function deriveRootIdentitySeed(secret: Uint8Array, salt: Uint8Array): Uint8Array {
  requireBytes(secret, 'secret', 16);
  requireBytes(salt, 'salt', 16);
  return argon2id(secret, salt, {
    t: ROOT_IDENTITY_ARGON2ID_V0_1.iterations,
    m: ROOT_IDENTITY_ARGON2ID_V0_1.memory_kib,
    p: ROOT_IDENTITY_ARGON2ID_V0_1.parallelism,
    version: ROOT_IDENTITY_ARGON2ID_V0_1.version,
    dkLen: ROOT_IDENTITY_ARGON2ID_V0_1.output_bytes,
    maxmem: ROOT_IDENTITY_ARGON2ID_V0_1.memory_kib * 1024 + 8192,
  });
}

/** Derives one domain-separated child key from secret root material. */
export function deriveDomainKey(
  rootSeed: Uint8Array,
  options: { purpose: string; context: string; salt: Uint8Array; length?: number },
): Uint8Array {
  requireExactBytes(rootSeed, 'rootSeed', ROOT_IDENTITY_ARGON2ID_V0_1.output_bytes);
  requireBytes(options.salt, 'salt', 16);
  requireText(options.purpose, 'purpose');
  requireText(options.context, 'context');
  const length = options.length ?? 32;
  if (!Number.isSafeInteger(length) || length < 16 || length > 64) {
    throw new CryptoSuiteError('crypto.input.invalid', 'length must be an integer between 16 and 64 bytes');
  }
  const info = textEncoder.encode(canonicalJson({
    suite: H2A2H_CRYPTO_SUITE_V0_1,
    purpose: options.purpose,
    context: options.context,
  }));
  return hkdf(sha256Bytes, rootSeed, options.salt, info, length);
}

/** Creates a transport-independent content identity for a canonical artifact. */
export function deriveArtifactId(artifact: unknown): string {
  const canonical = textEncoder.encode(canonicalJson({
    domain: 'h2a2h.crypto.artifact.v0.1',
    artifact,
  }));
  return `h2a2h:artifact:blake3-256:${base64url(blake3(canonical, { context: ARTIFACT_CONTEXT }))}`;
}

/** Creates a DAG branch identity bound to its parent, label, ordinal and state. */
export function deriveBranchId(input: {
  parent_id: string;
  canonical_label: string;
  ordinal: number;
  state: unknown;
}): string {
  requireText(input.parent_id, 'parent_id');
  requireText(input.canonical_label, 'canonical_label');
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
    throw new CryptoSuiteError('crypto.input.invalid', 'ordinal must be a non-negative safe integer');
  }
  const canonical = textEncoder.encode(canonicalJson({
    domain: 'h2a2h.crypto.branch.v0.1',
    parent_id: input.parent_id,
    canonical_label: input.canonical_label,
    ordinal: input.ordinal,
    state: input.state,
  }));
  return `h2a2h:branch:blake3-256:${base64url(blake3(canonical, { context: BRANCH_CONTEXT }))}`;
}

function signingInput(
  protectedHeader: CryptoProtectedHeader,
  payloadDigest: H2A2HCryptoEnvelope['payload_digest'],
): string {
  return canonicalJson({ protected: protectedHeader, payload_digest: payloadDigest });
}

export function createCryptoEnvelope<T>(
  payload: T,
  options: {
    private_key: KeyLike;
    key_id: string;
    issuer: string;
    artifact_id: string;
    purpose: string;
    created_at: Date;
    expires_at?: Date | null;
  },
): H2A2HCryptoEnvelope<T> {
  requireText(options.key_id, 'key_id');
  requireText(options.issuer, 'issuer');
  if (!ARTIFACT_ID_PATTERN.test(options.artifact_id)) {
    throw new CryptoSuiteError('crypto.input.invalid', 'artifact_id must be a v0.1 BLAKE3 artifact identity');
  }
  requireText(options.purpose, 'purpose');
  if (!Number.isFinite(options.created_at.getTime())) {
    throw new CryptoSuiteError('crypto.input.invalid', 'created_at is invalid');
  }
  const expiresAt = options.expires_at ?? null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= options.created_at)) {
    throw new CryptoSuiteError('crypto.input.invalid', 'expires_at must be later than created_at');
  }

  const serializedPayload = canonicalJson(payload);
  const isolatedPayload = JSON.parse(serializedPayload) as T;
  const payloadDigest = {
    algorithm: 'sha-256' as const,
    value: createHash('sha256').update(serializedPayload).digest('base64url'),
  };
  const protectedHeader: CryptoProtectedHeader = {
    suite: H2A2H_CRYPTO_SUITE_V0_1,
    serialization: H2A2H_CANONICAL_JSON_V1,
    digest_algorithm: 'sha-256',
    signature_algorithm: 'Ed25519',
    key_id: options.key_id,
    issuer: options.issuer,
    artifact_id: options.artifact_id,
    purpose: options.purpose,
    created_at: options.created_at.toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
  };
  const signature = sign(
    null,
    Buffer.from(signingInput(protectedHeader, payloadDigest)),
    options.private_key,
  ).toString('base64url');
  return { protected: protectedHeader, payload_digest: payloadDigest, signature, payload: isolatedPayload };
}

export function verifyCryptoEnvelope<T>(
  value: unknown,
  options: {
    public_key: KeyLike;
    now: Date;
    expected_key_id?: string;
    expected_issuer?: string;
    expected_artifact_id?: string;
    expected_purpose?: string;
  },
): CryptoVerification<T> {
  try {
    if (!Number.isFinite(options.now.getTime()) || !isPlainRecord(value)) {
      return { ok: false, code: 'crypto.envelope.malformed' };
    }
    if (!hasExactKeys(value, ['protected', 'payload_digest', 'signature', 'payload'])) {
      return { ok: false, code: 'crypto.envelope.malformed' };
    }
    if (!isPlainRecord(value['protected']) || !isPlainRecord(value['payload_digest'])) {
      return { ok: false, code: 'crypto.envelope.malformed' };
    }
    const header = value['protected'];
    const digest = value['payload_digest'];
    if (!hasExactKeys(header, [
      'suite', 'serialization', 'digest_algorithm', 'signature_algorithm', 'key_id',
      'issuer', 'artifact_id', 'purpose', 'created_at', 'expires_at',
    ]) || !hasExactKeys(digest, ['algorithm', 'value'])) {
      return { ok: false, code: 'crypto.envelope.malformed' };
    }
    if (
      header['suite'] !== H2A2H_CRYPTO_SUITE_V0_1
      || header['serialization'] !== H2A2H_CANONICAL_JSON_V1
      || header['digest_algorithm'] !== 'sha-256'
      || header['signature_algorithm'] !== 'Ed25519'
      || digest['algorithm'] !== 'sha-256'
      || !strictBase64Url(digest['value'], 32)
      || !strictBase64Url(value['signature'], 64)
    ) return { ok: false, code: 'crypto.envelope.malformed' };
    for (const field of ['key_id', 'issuer', 'artifact_id', 'purpose'] as const) {
      if (typeof header[field] !== 'string' || !header[field].trim()) {
        return { ok: false, code: 'crypto.envelope.malformed' };
      }
    }
    if (!ARTIFACT_ID_PATTERN.test(header['artifact_id'] as string)) {
      return { ok: false, code: 'crypto.envelope.malformed' };
    }
    const createdAt = requireIsoInstant(header['created_at'] as string, 'created_at');
    const expiresAt = header['expires_at'] === null
      ? null
      : requireIsoInstant(header['expires_at'] as string, 'expires_at');
    if (expiresAt && expiresAt <= createdAt) return { ok: false, code: 'crypto.envelope.malformed' };
    if (createdAt > options.now) return { ok: false, code: 'crypto.envelope.not_yet_valid' };
    if (expiresAt && expiresAt <= options.now) return { ok: false, code: 'crypto.envelope.expired' };

    const expectations: Array<[unknown, string | undefined]> = [
      [header['key_id'], options.expected_key_id],
      [header['issuer'], options.expected_issuer],
      [header['artifact_id'], options.expected_artifact_id],
      [header['purpose'], options.expected_purpose],
    ];
    if (expectations.some(([actual, expected]) => expected !== undefined && actual !== expected)) {
      return { ok: false, code: 'crypto.envelope.expectation_mismatch' };
    }

    const serializedPayload = canonicalJson(value['payload']);
    const recomputed = createHash('sha256').update(serializedPayload).digest('base64url');
    if (recomputed !== digest['value']) return { ok: false, code: 'crypto.envelope.digest_mismatch' };

    const typedHeader = header as unknown as CryptoProtectedHeader;
    const typedDigest = digest as unknown as H2A2HCryptoEnvelope['payload_digest'];
    if (!verify(
      null,
      Buffer.from(signingInput(typedHeader, typedDigest)),
      options.public_key,
      Buffer.from(value['signature'] as string, 'base64url'),
    )) return { ok: false, code: 'crypto.envelope.invalid_signature' };

    return { ok: true, envelope: value as unknown as H2A2HCryptoEnvelope<T> };
  } catch {
    return { ok: false, code: 'crypto.envelope.malformed' };
  }
}
