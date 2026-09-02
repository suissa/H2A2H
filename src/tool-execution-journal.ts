import { randomUUID } from 'node:crypto';
import type { MaybePromise } from './types.js';

export interface ToolExecutionDescriptor {
  execution_id: string;
  idempotency_key: string;
  operation_index: number;
  input_digest: string;
  capability_canonical_label: string;
  interaction_id: string;
  correlation_id: string;
  intent_canonical_label: string;
  employee_canonical_label: string;
}

export interface ToolExecutionExecutingRecord extends ToolExecutionDescriptor {
  state: 'executing';
  claim_id: string;
  claimed_at: string;
  /** Optional for compatibility with non-recoverable journal stores. */
  claim_expires_at?: string;
  /** Monotonic ownership generation. Optional for compatibility with older stores. */
  fence?: number;
}

export interface ToolExecutionCompletedRecord<TResult = unknown> extends ToolExecutionDescriptor {
  state: 'completed';
  claimed_at: string;
  completed_at: string;
  result: TResult;
  /** Final fencing generation that committed this result, when supported. */
  fence?: number;
}

export type ToolExecutionJournalRecord<TResult = unknown> =
  | ToolExecutionExecutingRecord
  | ToolExecutionCompletedRecord<TResult>;

export type ToolExecutionClaim<TResult = unknown> =
  | { status: 'claimed'; record: ToolExecutionExecutingRecord; recovered?: boolean }
  | { status: 'completed'; record: ToolExecutionCompletedRecord<TResult> }
  | { status: 'conflict' };

export interface ToolExecutionJournalStore<TResult = unknown> {
  claimExecution(descriptor: ToolExecutionDescriptor): MaybePromise<ToolExecutionClaim<TResult>>;
  completeExecution(executionId: string, claimId: string, result: TResult): MaybePromise<boolean>;
  releaseExecution(executionId: string, claimId: string): MaybePromise<boolean>;
  loadExecution(executionId: string): MaybePromise<ToolExecutionJournalRecord<TResult> | undefined>;
}

export interface InMemoryToolExecutionJournalOptions {
  claim_ttl_ms?: number;
  now?: () => Date;
}

export class ToolExecutionJournalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ToolExecutionJournalError';
  }
}

function sameDescriptor(
  record: ToolExecutionJournalRecord,
  descriptor: ToolExecutionDescriptor,
): boolean {
  return record.execution_id === descriptor.execution_id
    && record.idempotency_key === descriptor.idempotency_key
    && record.operation_index === descriptor.operation_index
    && record.input_digest === descriptor.input_digest
    && record.capability_canonical_label === descriptor.capability_canonical_label
    && record.interaction_id === descriptor.interaction_id
    && record.correlation_id === descriptor.correlation_id
    && record.intent_canonical_label === descriptor.intent_canonical_label
    && record.employee_canonical_label === descriptor.employee_canonical_label;
}

function snapshot<TResult>(record: ToolExecutionJournalRecord<TResult>): ToolExecutionJournalRecord<TResult> {
  return structuredClone(record);
}

/**
 * Reference single-process execution journal.
 *
 * Map claim/complete/release mutations are synchronous and therefore atomic
 * inside one JavaScript process. Durable implementations must provide the same
 * compare-and-claim semantics transactionally across workers/processes.
 *
 * The reference store also models orphan recovery with an expiring claim and a
 * monotonically increasing fencing generation. Reclaim does not replace the
 * provider idempotency boundary: remote side effects must continue using the
 * stable runtime-derived idempotency_key when a recovered owner retries them.
 */
export class InMemoryToolExecutionJournalStore<TResult = unknown>
implements ToolExecutionJournalStore<TResult> {
  private readonly records = new Map<string, ToolExecutionJournalRecord<TResult>>();
  private readonly claimTtlMs: number;
  private readonly now: () => Date;

  constructor(options: InMemoryToolExecutionJournalOptions = {}) {
    this.claimTtlMs = options.claim_ttl_ms ?? 300_000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.claimTtlMs) || this.claimTtlMs <= 0) {
      throw new ToolExecutionJournalError(
        'tool.execution.claim_ttl_invalid',
        'Tool execution claim TTL must be a positive finite number of milliseconds',
      );
    }
  }

  private createExecutingRecord(
    descriptor: ToolExecutionDescriptor,
    fence: number,
  ): ToolExecutionExecutingRecord {
    const claimedAt = this.now();
    return {
      ...descriptor,
      state: 'executing',
      claim_id: `tool-execution-claim:${randomUUID()}`,
      claimed_at: claimedAt.toISOString(),
      claim_expires_at: new Date(claimedAt.getTime() + this.claimTtlMs).toISOString(),
      fence,
    };
  }

  claimExecution(descriptor: ToolExecutionDescriptor): ToolExecutionClaim<TResult> {
    const existing = this.records.get(descriptor.execution_id);
    if (existing) {
      if (!sameDescriptor(existing, descriptor)) {
        throw new ToolExecutionJournalError(
          'tool.execution.identity_mismatch',
          `Execution ${descriptor.execution_id} does not match its canonical journal descriptor`,
        );
      }
      if (existing.state === 'completed') {
        return { status: 'completed', record: snapshot(existing) as ToolExecutionCompletedRecord<TResult> };
      }

      const expiry = existing.claim_expires_at ? Date.parse(existing.claim_expires_at) : Number.NaN;
      if (!Number.isFinite(expiry) || typeof existing.fence !== 'number') {
        return { status: 'conflict' };
      }
      if (expiry > this.now().getTime()) return { status: 'conflict' };

      const recovered = this.createExecutingRecord(descriptor, existing.fence + 1);
      this.records.set(descriptor.execution_id, recovered as ToolExecutionJournalRecord<TResult>);
      return {
        status: 'claimed',
        record: snapshot(recovered) as ToolExecutionExecutingRecord,
        recovered: true,
      };
    }

    const record = this.createExecutingRecord(descriptor, 1);
    this.records.set(descriptor.execution_id, record as ToolExecutionJournalRecord<TResult>);
    return {
      status: 'claimed',
      record: snapshot(record) as ToolExecutionExecutingRecord,
      recovered: false,
    };
  }

  completeExecution(executionId: string, claimId: string, result: TResult): boolean {
    const existing = this.records.get(executionId);
    if (!existing || existing.state !== 'executing' || existing.claim_id !== claimId) return false;

    const completed: ToolExecutionCompletedRecord<TResult> = {
      execution_id: existing.execution_id,
      idempotency_key: existing.idempotency_key,
      operation_index: existing.operation_index,
      input_digest: existing.input_digest,
      capability_canonical_label: existing.capability_canonical_label,
      interaction_id: existing.interaction_id,
      correlation_id: existing.correlation_id,
      intent_canonical_label: existing.intent_canonical_label,
      employee_canonical_label: existing.employee_canonical_label,
      state: 'completed',
      claimed_at: existing.claimed_at,
      completed_at: this.now().toISOString(),
      result: structuredClone(result),
      ...(typeof existing.fence === 'number' ? { fence: existing.fence } : {}),
    };
    this.records.set(executionId, completed);
    return true;
  }

  releaseExecution(executionId: string, claimId: string): boolean {
    const existing = this.records.get(executionId);
    if (!existing || existing.state !== 'executing' || existing.claim_id !== claimId) return false;
    this.records.delete(executionId);
    return true;
  }

  loadExecution(executionId: string): ToolExecutionJournalRecord<TResult> | undefined {
    const record = this.records.get(executionId);
    return record ? snapshot(record) : undefined;
  }

  clear(executionId?: string): void {
    if (executionId) {
      this.records.delete(executionId);
      return;
    }
    this.records.clear();
  }
}
