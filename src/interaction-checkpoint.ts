import { randomUUID } from 'node:crypto';
import type { InteractionContext, MaybePromise } from './types.js';

export interface InteractionStartLease {
  interaction_id: string;
  claim_id: string;
}

export type InteractionStartClaim =
  | { status: 'claimed'; lease: InteractionStartLease }
  | { status: 'exists' }
  | { status: 'conflict' };

export interface InteractionResumeLease<TInput = unknown, TResult = unknown> {
  interaction_id: string;
  lease_id: string;
  context: InteractionContext<TInput, TResult>;
}

export type InteractionResumeClaim<TInput = unknown, TResult = unknown> =
  | { status: 'claimed'; lease: InteractionResumeLease<TInput, TResult> }
  | { status: 'not_found' }
  | { status: 'conflict' };

export interface InteractionCheckpointStore<TInput = unknown, TResult = unknown> {
  save(context: InteractionContext<TInput, TResult>): MaybePromise<void>;
  load(interactionId: string): MaybePromise<InteractionContext<TInput, TResult> | undefined>;
  /** Optional for source compatibility; SDK run fails closed when unsupported. */
  claimStart?(interactionId: string): MaybePromise<InteractionStartClaim>;
  /** Returns true only when the supplied claim owns the active start reservation. */
  releaseStart?(interactionId: string, claimId: string): MaybePromise<boolean>;
  /** Optional for source compatibility; SDK resume fails closed when unsupported. */
  claimResume?(interactionId: string): MaybePromise<InteractionResumeClaim<TInput, TResult>>;
  /** Returns true only when the supplied lease owned the active resume claim. */
  releaseResume?(interactionId: string, leaseId: string): MaybePromise<boolean>;
}

function snapshot<TInput, TResult>(
  context: InteractionContext<TInput, TResult>,
): InteractionContext<TInput, TResult> {
  return structuredClone(context);
}

/**
 * Reference checkpoint store for one runtime process.
 *
 * Every write and read is cloned so authoritative state never shares mutable
 * references with callers. Start and resume claims are synchronous Map
 * mutations, making acquisition atomic within one JavaScript process. Durable
 * stores must provide equivalent compare-and-claim semantics.
 */
export class InMemoryInteractionCheckpointStore<TInput = unknown, TResult = unknown>
implements InteractionCheckpointStore<TInput, TResult> {
  private readonly checkpoints = new Map<string, InteractionContext<TInput, TResult>>();
  private readonly startClaims = new Map<string, string>();
  private readonly resumeLeases = new Map<string, string>();

  save(context: InteractionContext<TInput, TResult>): void {
    this.checkpoints.set(context.interaction_id, snapshot(context));
  }

  load(interactionId: string): InteractionContext<TInput, TResult> | undefined {
    const stored = this.checkpoints.get(interactionId);
    return stored ? snapshot(stored) : undefined;
  }

  claimStart(interactionId: string): InteractionStartClaim {
    if (this.startClaims.has(interactionId)) return { status: 'conflict' };
    if (this.checkpoints.has(interactionId)) return { status: 'exists' };

    const claimId = `start-claim:${randomUUID()}`;
    this.startClaims.set(interactionId, claimId);
    return {
      status: 'claimed',
      lease: { interaction_id: interactionId, claim_id: claimId },
    };
  }

  releaseStart(interactionId: string, claimId: string): boolean {
    if (this.startClaims.get(interactionId) !== claimId) return false;
    this.startClaims.delete(interactionId);
    return true;
  }

  claimResume(interactionId: string): InteractionResumeClaim<TInput, TResult> {
    const stored = this.checkpoints.get(interactionId);
    if (!stored) return { status: 'not_found' };
    if (this.resumeLeases.has(interactionId)) return { status: 'conflict' };

    const leaseId = `resume-lease:${randomUUID()}`;
    this.resumeLeases.set(interactionId, leaseId);
    return {
      status: 'claimed',
      lease: {
        interaction_id: interactionId,
        lease_id: leaseId,
        context: snapshot(stored),
      },
    };
  }

  releaseResume(interactionId: string, leaseId: string): boolean {
    if (this.resumeLeases.get(interactionId) !== leaseId) return false;
    this.resumeLeases.delete(interactionId);
    return true;
  }

  clear(interactionId?: string): void {
    if (interactionId) {
      this.checkpoints.delete(interactionId);
      this.startClaims.delete(interactionId);
      this.resumeLeases.delete(interactionId);
      return;
    }
    this.checkpoints.clear();
    this.startClaims.clear();
    this.resumeLeases.clear();
  }
}
