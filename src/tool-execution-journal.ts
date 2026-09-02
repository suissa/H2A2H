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
}

export interface ToolExecutionCompletedRecord<TResult = unknown> extends ToolExecutionDescriptor {
  state: 'completed';
  claimed_at: string;
  completed_at: string;
  result: TResult;
}

export type ToolExecutionJournalRecord<TResult = unknown> =
  | ToolExecutionExecutingRecord
  | ToolExecutionCompletedRecord<TResult>;

export type ToolExecutionClaim<TResult = unknown> =
  | { status: 'claimed'; record: ToolExecutionExecutingRecord }
  | { status: 'completed'; record: ToolExecutionCompletedRecord<TResult> }
  | { status: 'conflict' };

export interface ToolExecutionJournalStore<TResult = unknown> {
  claimExecution(descriptor: ToolExecutionDescriptor): MaybePromise<ToolExecutionClaim<TResult>>;
  completeExecution(executionId: string, claimId: string, result: TResult): MaybePromise<boolean>;
  releaseExecution(executionId: string, claimId: string): MaybePromise<boolean>;
  loadExecution(executionId: string): MaybePromise<ToolExecutionJournalRecord<TResult> | undefined>;
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
 */
export class InMemoryToolExecutionJournalStore<TResult = unknown>
implements ToolExecutionJournalStore<TResult> {
  private readonly records = new Map<string, ToolExecutionJournalRecord<TResult>>();

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
      return { status: 'conflict' };
    }

    const record: ToolExecutionExecutingRecord = {
      ...descriptor,
      state: 'executing',
      claim_id: `tool-execution-claim:${randomUUID()}`,
      claimed_at: new Date().toISOString(),
    };
    this.records.set(descriptor.execution_id, record as ToolExecutionJournalRecord<TResult>);
    return { status: 'claimed', record: snapshot(record) as ToolExecutionExecutingRecord };
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
      completed_at: new Date().toISOString(),
      result: structuredClone(result),
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
