import { createHash, sign, verify, type KeyLike } from 'node:crypto';

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

export class ReplayGuard {
  private readonly accepted = new Map<string, number>();

  accept(identity: string, expiresAt: Date, now: Date = new Date()): void {
    this.prune(now);
    const existingExpiry = this.accepted.get(identity);
    if (existingExpiry !== undefined && existingExpiry > now.getTime()) {
      throw new Error(`security.replay:${identity}`);
    }
    if (expiresAt <= now) {
      throw new Error(`security.expired:${identity}`);
    }
    this.accepted.set(identity, expiresAt.getTime());
  }

  has(identity: string, now: Date = new Date()): boolean {
    this.prune(now);
    return this.accepted.has(identity);
  }

  prune(now: Date = new Date()): void {
    for (const [identity, expiry] of this.accepted) {
      if (expiry <= now.getTime()) this.accepted.delete(identity);
    }
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
