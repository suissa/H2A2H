import { createHash, sign, verify, type KeyLike } from 'node:crypto';
import type { MaybePromise } from './types.js';

export interface SignedEvidence<T = unknown> {
  profile: 'h2a2h.security.signed-ed25519.v1';
  key_id: string;
  algorithm: 'Ed25519';
  created_at: string;
  payload_digest: { algorithm: 'sha-256'; value: string };
  signature: string;
  payload: T;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalizeValue(object[key])]),
    );
  }
  if (value === undefined) return null;
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('base64url');
}

export function signEd25519<T>(
  payload: T,
  options: { key_id: string; private_key: KeyLike; created_at?: Date },
): SignedEvidence<T> {
  const serialized = canonicalJson(payload);
  const digest = createHash('sha256').update(serialized).digest('base64url');
  const signature = sign(null, Buffer.from(serialized), options.private_key).toString('base64url');
  return {
    profile: 'h2a2h.security.signed-ed25519.v1',
    key_id: options.key_id,
    algorithm: 'Ed25519',
    created_at: (options.created_at ?? new Date()).toISOString(),
    payload_digest: { algorithm: 'sha-256', value: digest },
    signature,
    payload,
  };
}

export function verifyEd25519<T>(evidence: SignedEvidence<T>, publicKey: KeyLike): boolean {
  const serialized = canonicalJson(evidence.payload);
  const digest = createHash('sha256').update(serialized).digest('base64url');
  if (digest !== evidence.payload_digest.value) return false;
  return verify(null, Buffer.from(serialized), publicKey, Buffer.from(evidence.signature, 'base64url'));
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
