import { createHash, sign, verify, type KeyLike } from 'node:crypto';
import type { MaybePromise } from './types.js';

export type CanonicalJsonValue =
  | null
  | boolean
  | string
  | number
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export class SecurityCanonicalizationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}:${message}`);
    this.name = 'SecurityCanonicalizationError';
  }
}

export interface SignedEvidence<T = unknown> {
  profile: 'h2a2h.security.signed-ed25519.v1';
  key_id: string;
  algorithm: 'Ed25519';
  created_at: string;
  payload_digest: { algorithm: 'sha-256'; value: string };
  signature: string;
  payload: T;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeValue(value: unknown, stack: WeakSet<object>, path: string): CanonicalJsonValue {
  if (value === null) return null;

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new SecurityCanonicalizationError(
          'security.canonical.non_finite_number',
          `Non-finite number at ${path}`,
        );
      }
      return Object.is(value, -0) ? 0 : value;
    case 'undefined':
      throw new SecurityCanonicalizationError('security.canonical.undefined', `Undefined value at ${path}`);
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new SecurityCanonicalizationError(
        'security.canonical.invalid_type',
        `Unsupported ${typeof value} value at ${path}`,
      );
    case 'object':
      break;
    default:
      throw new SecurityCanonicalizationError('security.canonical.invalid_type', `Unsupported value at ${path}`);
  }

  const object = value as object;
  if (stack.has(object)) {
    throw new SecurityCanonicalizationError('security.canonical.cycle', `Cyclic value at ${path}`);
  }
  stack.add(object);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new SecurityCanonicalizationError('security.canonical.array_metadata', `Array has symbol metadata at ${path}`);
      }
      const ownNames = Object.getOwnPropertyNames(value).filter((key) => key !== 'length');
      if (ownNames.length !== value.length) {
        throw new SecurityCanonicalizationError('security.canonical.sparse_array', `Sparse or decorated array at ${path}`);
      }
      const result: CanonicalJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          throw new SecurityCanonicalizationError('security.canonical.sparse_array', `Sparse array at ${path}[${index}]`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new SecurityCanonicalizationError('security.canonical.array_accessor', `Non-data array element at ${path}[${index}]`);
        }
        result.push(canonicalizeValue(descriptor.value, stack, `${path}[${index}]`));
      }
      return result;
    }

    if (!isPlainObject(object)) {
      throw new SecurityCanonicalizationError(
        'security.canonical.non_plain_object',
        `Only plain JSON objects are allowed at ${path}`,
      );
    }
    if (Object.getOwnPropertySymbols(object).length > 0) {
      throw new SecurityCanonicalizationError('security.canonical.symbol_key', `Symbol-keyed property at ${path}`);
    }

    const ownNames = Object.getOwnPropertyNames(object);
    const enumerableKeys = Object.keys(object);
    if (ownNames.length !== enumerableKeys.length) {
      throw new SecurityCanonicalizationError(
        'security.canonical.hidden_property',
        `Non-enumerable property at ${path}`,
      );
    }

    const result: Record<string, CanonicalJsonValue> = {};
    for (const key of enumerableKeys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new SecurityCanonicalizationError(
          'security.canonical.accessor_property',
          `Accessor property ${path}.${key} is not canonical JSON`,
        );
      }
      result[key] = canonicalizeValue(descriptor.value, stack, `${path}.${key}`);
    }
    return result;
  } finally {
    stack.delete(object);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, new WeakSet<object>(), '$'));
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('base64url');
}

function requireValidIsoInstant(value: string): boolean {
  if (typeof value !== 'string' || !value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function strictBase64Url(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === expectedBytes && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return actual.length === canonicalExpected.length
    && actual.every((key, index) => key === canonicalExpected[index]);
}

export function signEd25519<T>(
  payload: T,
  options: { key_id: string; private_key: KeyLike; created_at?: Date },
): SignedEvidence<T> {
  if (typeof options.key_id !== 'string' || !options.key_id.trim()) {
    throw new SecurityCanonicalizationError('security.evidence.key_id_required', 'Signing key id is required');
  }
  const createdAt = options.created_at ?? new Date();
  if (!Number.isFinite(createdAt.getTime())) {
    throw new SecurityCanonicalizationError('security.evidence.created_at_invalid', 'Signing creation time is invalid');
  }

  const serialized = canonicalJson(payload);
  const digest = createHash('sha256').update(serialized).digest('base64url');
  const signature = sign(null, Buffer.from(serialized), options.private_key).toString('base64url');
  const isolatedPayload = JSON.parse(serialized) as T;
  return {
    profile: 'h2a2h.security.signed-ed25519.v1',
    key_id: options.key_id,
    algorithm: 'Ed25519',
    created_at: createdAt.toISOString(),
    payload_digest: { algorithm: 'sha-256', value: digest },
    signature,
    payload: isolatedPayload,
  };
}

export function verifyEd25519<T>(evidence: unknown, publicKey: KeyLike): evidence is SignedEvidence<T> {
  try {
    if (!evidence || typeof evidence !== 'object' || !isPlainObject(evidence as object)) return false;
    const candidate = evidence as Record<string, unknown>;
    if (!exactKeys(candidate, [
      'profile',
      'key_id',
      'algorithm',
      'created_at',
      'payload_digest',
      'signature',
      'payload',
    ])) return false;
    if (candidate['profile'] !== 'h2a2h.security.signed-ed25519.v1') return false;
    if (candidate['algorithm'] !== 'Ed25519') return false;
    if (typeof candidate['key_id'] !== 'string' || !candidate['key_id'].trim()) return false;
    if (!requireValidIsoInstant(candidate['created_at'] as string)) return false;
    if (!strictBase64Url(candidate['signature'], 64)) return false;

    const digestMetadata = candidate['payload_digest'];
    if (!digestMetadata || typeof digestMetadata !== 'object' || !isPlainObject(digestMetadata as object)) return false;
    const digest = digestMetadata as Record<string, unknown>;
    if (!exactKeys(digest, ['algorithm', 'value'])) return false;
    if (digest['algorithm'] !== 'sha-256') return false;
    if (!strictBase64Url(digest['value'], 32)) return false;

    const serialized = canonicalJson(candidate['payload']);
    const recomputed = createHash('sha256').update(serialized).digest('base64url');
    if (recomputed !== digest['value']) return false;
    return verify(
      null,
      Buffer.from(serialized),
      publicKey,
      Buffer.from(candidate['signature'] as string, 'base64url'),
    );
  } catch {
    return false;
  }
}

export class ReplayProtectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}:${message}`);
    this.name = 'ReplayProtectionError';
  }
}

export interface ReplayRecord {
  identity: string;
  accepted_at: string;
  expires_at: string;
}

export type ReplayAcceptance =
  | { status: 'accepted'; record: ReplayRecord }
  | { status: 'replay'; record: ReplayRecord };

/**
 * Durable atomic replay boundary.
 *
 * `accept()` MUST perform live-identity comparison and insertion/replacement as
 * one atomic operation. Callers must never implement replay protection as a
 * separate `has()` followed by `set()` across this boundary.
 */
export interface ReplayRecordStore {
  accept(record: ReplayRecord, now: Date): MaybePromise<ReplayAcceptance>;
  load?(identity: string): MaybePromise<ReplayRecord | undefined>;
}

function requireValidReplayInput(identity: string, expiresAt: Date, now: Date): void {
  if (!identity.trim()) {
    throw new ReplayProtectionError('security.replay.identity_required', 'Replay identity is required');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new ReplayProtectionError('security.replay.now_invalid', 'Replay protection clock is invalid');
  }
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new ReplayProtectionError('security.replay.expiry_invalid', 'Replay expiry is invalid');
  }
  if (expiresAt <= now) {
    throw new ReplayProtectionError('security.expired', `Replay identity ${identity} is already expired`);
  }
}

function replayRecord(identity: string, expiresAt: Date, now: Date): ReplayRecord {
  requireValidReplayInput(identity, expiresAt, now);
  return {
    identity,
    accepted_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

/** Reference atomic replay store for one JavaScript process. */
export class InMemoryReplayRecordStore implements ReplayRecordStore {
  private readonly records = new Map<string, ReplayRecord>();

  accept(record: ReplayRecord, now: Date): ReplayAcceptance {
    if (!Number.isFinite(now.getTime())) {
      throw new ReplayProtectionError('security.replay.now_invalid', 'Replay protection clock is invalid');
    }
    const expiry = new Date(record.expires_at);
    const acceptedAt = new Date(record.accepted_at);
    requireValidReplayInput(record.identity, expiry, now);
    if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt > now) {
      throw new ReplayProtectionError('security.replay.accepted_at_invalid', 'Replay record accepted_at is invalid');
    }

    const existing = this.records.get(record.identity);
    if (existing) {
      const existingExpiry = Date.parse(existing.expires_at);
      if (Number.isFinite(existingExpiry) && existingExpiry > now.getTime()) {
        return { status: 'replay', record: structuredClone(existing) };
      }
    }

    this.records.set(record.identity, structuredClone(record));
    return { status: 'accepted', record: structuredClone(record) };
  }

  load(identity: string): ReplayRecord | undefined {
    const record = this.records.get(identity);
    return record ? structuredClone(record) : undefined;
  }

  prune(now: Date = new Date()): void {
    if (!Number.isFinite(now.getTime())) {
      throw new ReplayProtectionError('security.replay.now_invalid', 'Replay protection clock is invalid');
    }
    for (const [identity, record] of this.records) {
      if (Date.parse(record.expires_at) <= now.getTime()) this.records.delete(identity);
    }
  }
}

/** Multi-process/durable replay coordinator. */
export class ReplayProtector {
  constructor(private readonly store: ReplayRecordStore) {}

  async accept(identity: string, expiresAt: Date, now: Date = new Date()): Promise<ReplayRecord> {
    const record = replayRecord(identity, expiresAt, now);
    const result = await this.store.accept(record, now);
    if (result.status === 'replay') {
      throw new ReplayProtectionError('security.replay', `Replay identity ${identity} is already live`);
    }
    return structuredClone(result.record);
  }

  async has(identity: string, now: Date = new Date()): Promise<boolean> {
    if (!identity.trim()) return false;
    if (!Number.isFinite(now.getTime())) {
      throw new ReplayProtectionError('security.replay.now_invalid', 'Replay protection clock is invalid');
    }
    if (!this.store.load) {
      throw new ReplayProtectionError(
        'security.replay.lookup_unsupported',
        'Replay store does not expose non-authoritative lookup',
      );
    }
    const record = await this.store.load(identity);
    return Boolean(record && Date.parse(record.expires_at) > now.getTime());
  }
}

/**
 * Backward-compatible synchronous reference guard.
 *
 * Durable deployments should use `ReplayProtector` with a shared
 * `ReplayRecordStore`. This convenience class still uses the same atomic store
 * semantics rather than split has/set logic.
 */
export class ReplayGuard {
  private readonly store = new InMemoryReplayRecordStore();

  accept(identity: string, expiresAt: Date, now: Date = new Date()): void {
    const result = this.store.accept(replayRecord(identity, expiresAt, now), now);
    if (result.status === 'replay') {
      throw new ReplayProtectionError('security.replay', `Replay identity ${identity} is already live`);
    }
  }

  has(identity: string, now: Date = new Date()): boolean {
    if (!identity.trim()) return false;
    const record = this.store.load(identity);
    return Boolean(record && Date.parse(record.expires_at) > now.getTime());
  }

  prune(now: Date = new Date()): void {
    this.store.prune(now);
  }
}

export function requireSecurityProfile(
  supported: readonly string[],
  required: readonly string[],
): string {
  const match = required.find((profile) => supported.includes(profile));
  if (!match) throw new Error('security.profile_unsupported');
  return match;
}
