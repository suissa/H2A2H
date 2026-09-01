import { randomUUID } from 'node:crypto';
import { sha256 } from './security.js';
import type { EntityRef, IntentRef, LifecycleState, TransitionRecord } from './types.js';

export interface AuditRecord {
  audit_id: string;
  interaction_id: string;
  correlation_id: string;
  causation_id?: string;
  event: string;
  timestamp: string;
  actor?: EntityRef;
  intent?: IntentRef;
  lifecycle?: { from: LifecycleState | null; to: LifecycleState };
  delegation_ref?: string;
  channel_profile?: string;
  proof_refs?: string[];
  data?: unknown;
  redactions?: string[];
  previous_digest?: string;
  digest: string;
}

export interface AppendAuditInput extends Omit<AuditRecord, 'audit_id' | 'digest' | 'previous_digest'> {}

function withoutDigest(record: Omit<AuditRecord, 'digest'> | AuditRecord): unknown {
  const { digest: _digest, ...rest } = record as AuditRecord;
  return rest;
}

export class AuditTrail {
  private readonly records: AuditRecord[] = [];

  append(input: AppendAuditInput): AuditRecord {
    const previous = this.records.at(-1);
    const partial = {
      ...input,
      audit_id: `audit:${randomUUID()}`,
      ...(previous ? { previous_digest: previous.digest } : {}),
    };
    const record: AuditRecord = {
      ...partial,
      digest: sha256(partial),
    };
    this.records.push(record);
    return structuredClone(record);
  }

  appendTransition(
    transition: TransitionRecord,
    extra: {
      intent?: IntentRef;
      delegation_ref?: string;
      channel_profile?: string;
      proof_refs?: string[];
      data?: unknown;
    } = {},
  ): AuditRecord {
    return this.append({
      interaction_id: transition.interaction_id,
      correlation_id: transition.correlation_id,
      ...(transition.causation_id ? { causation_id: transition.causation_id } : {}),
      event: transition.event,
      timestamp: transition.timestamp,
      ...(transition.actor ? { actor: transition.actor } : {}),
      lifecycle: { from: transition.from, to: transition.to },
      ...extra,
    });
  }

  export(): AuditRecord[] {
    return structuredClone(this.records);
  }

  verify(): { valid: true } | { valid: false; index: number; reason: string } {
    for (let index = 0; index < this.records.length; index += 1) {
      const record = this.records[index]!;
      const previous = index > 0 ? this.records[index - 1]! : undefined;
      if (index === 0 && record.previous_digest) {
        return { valid: false, index, reason: 'audit.unexpected_previous_digest' };
      }
      if (previous && record.previous_digest !== previous.digest) {
        return { valid: false, index, reason: 'audit.previous_digest_mismatch' };
      }
      const expected = sha256(withoutDigest(record));
      if (expected !== record.digest) {
        return { valid: false, index, reason: 'audit.digest_mismatch' };
      }
      if (index > 0) {
        const first = this.records[0]!;
        if (record.interaction_id !== first.interaction_id || record.correlation_id !== first.correlation_id) {
          return { valid: false, index, reason: 'audit.correlation_mismatch' };
        }
      }
    }
    return { valid: true };
  }
}

export function redactObject<T extends Record<string, unknown>>(
  source: T,
  paths: readonly (keyof T)[],
): { data: Record<string, unknown>; redactions: string[] } {
  const data: Record<string, unknown> = { ...source };
  const redactions: string[] = [];
  for (const path of paths) {
    const key = String(path);
    if (!(key in data)) continue;
    const value = data[key];
    data[key] = {
      redacted: true,
      digest: sha256(value),
    };
    redactions.push(key);
  }
  return { data, redactions };
}
