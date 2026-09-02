import { sha256 } from './security.js';
import type {
  EntityRef,
  IntentRef,
  LifecycleState,
  MaybePromise,
  TransitionRecord,
} from './types.js';

export interface AuditRecord {
  audit_id: string;
  interaction_id: string;
  correlation_id: string;
  sequence: number;
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

export type AppendAuditInput = Omit<
  AuditRecord,
  'audit_id' | 'digest' | 'previous_digest' | 'sequence'
> & {
  sequence?: number;
};

export type AuditAppendResult =
  | { status: 'appended'; record: AuditRecord }
  | { status: 'duplicate'; record: AuditRecord };

/**
 * Durable audit persistence contract.
 *
 * Implementations MUST atomically compare the requested `sequence` and
 * `previous_digest` with the current interaction tail. Re-appending the exact
 * same record is idempotent; a different record at an existing sequence fails
 * closed.
 */
export interface AuditRecordStore {
  load(interactionId: string): MaybePromise<AuditRecord[]>;
  append(record: AuditRecord): MaybePromise<AuditAppendResult>;
}

export class AuditTrailError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuditTrailError';
  }
}

function withoutDigest(record: Omit<AuditRecord, 'digest'> | AuditRecord): unknown {
  const { digest: _digest, ...rest } = record as AuditRecord;
  return rest;
}

function deterministicAuditId(interactionId: string, sequence: number): string {
  return `audit:${sha256({
    profile: 'h2a2h.audit.record.v1',
    interaction_id: interactionId,
    sequence,
  })}`;
}

function cloneRecord(record: AuditRecord): AuditRecord {
  return structuredClone(record);
}

function validateSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new AuditTrailError('audit.sequence_invalid', 'Audit sequence must be a non-negative safe integer');
  }
}

function verifyRecord(
  record: AuditRecord,
  previous: AuditRecord | undefined,
): { valid: true } | { valid: false; reason: string } {
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 0) {
    return { valid: false, reason: 'audit.sequence_invalid' };
  }
  if (record.audit_id !== deterministicAuditId(record.interaction_id, record.sequence)) {
    return { valid: false, reason: 'audit.identity_mismatch' };
  }
  if (record.sequence === 0 && record.previous_digest) {
    return { valid: false, reason: 'audit.unexpected_previous_digest' };
  }
  if (record.sequence > 0 && !previous) {
    return { valid: false, reason: 'audit.sequence_gap' };
  }
  if (previous) {
    if (record.sequence !== previous.sequence + 1) {
      return { valid: false, reason: 'audit.sequence_gap' };
    }
    if (record.previous_digest !== previous.digest) {
      return { valid: false, reason: 'audit.previous_digest_mismatch' };
    }
    if (
      record.interaction_id !== previous.interaction_id
      || record.correlation_id !== previous.correlation_id
    ) {
      return { valid: false, reason: 'audit.correlation_mismatch' };
    }
  }
  if (sha256(withoutDigest(record)) !== record.digest) {
    return { valid: false, reason: 'audit.digest_mismatch' };
  }
  return { valid: true };
}

export function createAuditRecord(
  input: AppendAuditInput,
  previous?: AuditRecord,
): AuditRecord {
  const sequence = input.sequence ?? (previous ? previous.sequence + 1 : 0);
  validateSequence(sequence);
  if (previous && sequence !== previous.sequence + 1) {
    throw new AuditTrailError('audit.sequence_gap', `Expected audit sequence ${previous.sequence + 1}, received ${sequence}`);
  }
  if (!previous && sequence !== 0) {
    throw new AuditTrailError('audit.sequence_gap', `First audit record must use sequence 0, received ${sequence}`);
  }
  if (previous && (
    previous.interaction_id !== input.interaction_id
    || previous.correlation_id !== input.correlation_id
  )) {
    throw new AuditTrailError('audit.correlation_mismatch', 'Audit chain interaction/correlation identity changed');
  }

  const isolatedInput = structuredClone(input);
  delete isolatedInput.sequence;
  const partial: Omit<AuditRecord, 'digest'> = {
    ...isolatedInput,
    audit_id: deterministicAuditId(input.interaction_id, sequence),
    sequence,
    ...(previous ? { previous_digest: previous.digest } : {}),
  };
  return {
    ...partial,
    digest: sha256(partial),
  };
}

export function auditInputFromTransition(
  transition: TransitionRecord,
  sequence: number,
  extra: {
    intent?: IntentRef;
    delegation_ref?: string;
    channel_profile?: string;
    proof_refs?: string[];
    data?: unknown;
  } = {},
): AppendAuditInput {
  return {
    interaction_id: transition.interaction_id,
    correlation_id: transition.correlation_id,
    sequence,
    ...(transition.causation_id ? { causation_id: transition.causation_id } : {}),
    event: transition.event,
    timestamp: transition.timestamp,
    ...(transition.actor ? { actor: transition.actor } : {}),
    lifecycle: { from: transition.from, to: transition.to },
    ...(transition.intent ?? extra.intent ? { intent: transition.intent ?? extra.intent } : {}),
    ...(transition.delegation_ref ?? extra.delegation_ref
      ? { delegation_ref: transition.delegation_ref ?? extra.delegation_ref }
      : {}),
    ...(transition.channel_profile ?? extra.channel_profile
      ? { channel_profile: transition.channel_profile ?? extra.channel_profile }
      : {}),
    ...(transition.proof_refs ?? extra.proof_refs
      ? { proof_refs: transition.proof_refs ?? extra.proof_refs }
      : {}),
    ...('data' in extra ? { data: extra.data } : {}),
  };
}

/** Reference store for tests and a single runtime process. */
export class InMemoryAuditRecordStore implements AuditRecordStore {
  private readonly chains = new Map<string, AuditRecord[]>();

  constructor(initial: readonly AuditRecord[] = []) {
    for (const record of initial) this.append(record);
  }

  load(interactionId: string): AuditRecord[] {
    return structuredClone(this.chains.get(interactionId) ?? []);
  }

  append(record: AuditRecord): AuditAppendResult {
    const chain = this.chains.get(record.interaction_id) ?? [];
    const existing = chain[record.sequence];
    if (existing) {
      if (existing.digest !== record.digest) {
        throw new AuditTrailError(
          'audit.sequence_conflict',
          `Audit sequence ${record.sequence} already contains a different canonical record`,
        );
      }
      return { status: 'duplicate', record: cloneRecord(existing) };
    }
    if (record.sequence !== chain.length) {
      throw new AuditTrailError(
        'audit.sequence_gap',
        `Audit append expected sequence ${chain.length}, received ${record.sequence}`,
      );
    }
    const previous = chain.at(-1);
    const verified = verifyRecord(record, previous);
    if (!verified.valid) throw new AuditTrailError(verified.reason, `Invalid audit record: ${verified.reason}`);
    chain.push(cloneRecord(record));
    this.chains.set(record.interaction_id, chain);
    return { status: 'appended', record: cloneRecord(record) };
  }
}

/**
 * In-process verified view of one or more independent H2A2H audit chains.
 * Durable authority belongs to `AuditRecordStore`; this class is the hydrated
 * verifier/cache and remains useful directly for lightweight callers.
 */
export class AuditTrail {
  private readonly chains = new Map<string, AuditRecord[]>();

  constructor(initial: readonly AuditRecord[] = []) {
    this.hydrate(initial);
  }

  append(input: AppendAuditInput): AuditRecord {
    const chain = this.chains.get(input.interaction_id) ?? [];
    const sequence = input.sequence ?? chain.length;
    const existing = chain[sequence];
    if (existing) {
      const expected = createAuditRecord({ ...input, sequence }, sequence > 0 ? chain[sequence - 1] : undefined);
      if (existing.digest !== expected.digest) {
        throw new AuditTrailError('audit.sequence_conflict', `Audit sequence ${sequence} conflicts with hydrated record`);
      }
      return cloneRecord(existing);
    }
    if (sequence !== chain.length) {
      throw new AuditTrailError('audit.sequence_gap', `Audit append expected sequence ${chain.length}, received ${sequence}`);
    }
    const record = createAuditRecord({ ...input, sequence }, chain.at(-1));
    chain.push(cloneRecord(record));
    this.chains.set(record.interaction_id, chain);
    return cloneRecord(record);
  }

  appendRecord(record: AuditRecord): AuditRecord {
    const chain = this.chains.get(record.interaction_id) ?? [];
    const existing = chain[record.sequence];
    if (existing) {
      if (existing.digest !== record.digest) {
        throw new AuditTrailError('audit.sequence_conflict', `Audit sequence ${record.sequence} conflicts with hydrated record`);
      }
      return cloneRecord(existing);
    }
    if (record.sequence !== chain.length) {
      throw new AuditTrailError('audit.sequence_gap', `Audit hydration expected sequence ${chain.length}, received ${record.sequence}`);
    }
    const verified = verifyRecord(record, chain.at(-1));
    if (!verified.valid) throw new AuditTrailError(verified.reason, `Invalid audit record: ${verified.reason}`);
    chain.push(cloneRecord(record));
    this.chains.set(record.interaction_id, chain);
    return cloneRecord(record);
  }

  hydrate(records: readonly AuditRecord[]): void {
    for (const record of records) this.appendRecord(record);
  }

  preview(input: AppendAuditInput): AuditRecord {
    const chain = this.chains.get(input.interaction_id) ?? [];
    const sequence = input.sequence ?? chain.length;
    return createAuditRecord({ ...input, sequence }, chain.at(-1));
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
    sequence?: number,
  ): AuditRecord {
    const chain = this.chains.get(transition.interaction_id) ?? [];
    const resolvedSequence = sequence ?? transition.sequence ?? chain.length;
    return this.append(auditInputFromTransition(transition, resolvedSequence, extra));
  }

  get(interactionId: string, sequence: number): AuditRecord | undefined {
    const record = this.chains.get(interactionId)?.[sequence];
    return record ? cloneRecord(record) : undefined;
  }

  size(interactionId: string): number {
    return this.chains.get(interactionId)?.length ?? 0;
  }

  export(interactionId?: string): AuditRecord[] {
    if (interactionId) return structuredClone(this.chains.get(interactionId) ?? []);
    return structuredClone([...this.chains.values()].flat());
  }

  verify(interactionId?: string):
    | { valid: true }
    | { valid: false; index: number; reason: string; interaction_id?: string } {
    const entries = interactionId
      ? [[interactionId, this.chains.get(interactionId) ?? []] as const]
      : [...this.chains.entries()];

    for (const [chainInteractionId, chain] of entries) {
      for (let index = 0; index < chain.length; index += 1) {
        const record = chain[index]!;
        const verified = verifyRecord(record, index > 0 ? chain[index - 1] : undefined);
        if (!verified.valid) {
          return {
            valid: false,
            index,
            reason: verified.reason,
            interaction_id: chainInteractionId,
          };
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
