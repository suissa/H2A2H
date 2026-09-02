import { randomUUID } from 'node:crypto';
import type { InteractionContext, MaybePromise } from './types.js';

export interface InteractionStartLease {
  interaction_id: string;
  claim_id: string;
  /** Optional for source compatibility with pre-recovery checkpoint stores. */
  claim_expires_at?: string;
  /** Monotonic ownership generation when the store supports fenced recovery. */
  fence?: number;
  /** True when this owner reclaimed an expired start reservation. */
  recovered?: boolean;
}

export type InteractionStartClaim =
  | { status: 'claimed'; lease: InteractionStartLease }
  | { status: 'exists' }
  | { status: 'conflict' };

export interface InteractionResumeLease<TInput = unknown, TResult = unknown> {
  interaction_id: string;
  lease_id: string;
  context: InteractionContext<TInput, TResult>;
  /** Optional for source compatibility with pre-recovery checkpoint stores. */
  lease_expires_at?: string;
  /** Monotonic ownership generation when the store supports fenced recovery. */
  fence?: number;
  /** True when this owner reclaimed an expired resume lease. */
  recovered?: boolean;
}

export type InteractionResumeClaim<TInput = unknown, TResult = unknown> =
  | { status: 'claimed'; lease: InteractionResumeLease<TInput, TResult> }
  | { status: 'not_found' }
  | { status: 'conflict' };

export type InteractionCheckpointOwnership =
  | {
      kind: 'start';
      claim_id: string;
      fence?: number;
    }
  | {
      kind: 'resume';
      lease_id: string;
      fence?: number;
    };

export interface InteractionCheckpointStore<TInput = unknown, TResult = unknown> {
  save(context: InteractionContext<TInput, TResult>): MaybePromise<void>;
  load(interactionId: string): MaybePromise<InteractionContext<TInput, TResult> | undefined>;
  /**
   * Optional fenced write primitive. Stores that issue expiring/fenced leases
   * must implement this so stale owners cannot overwrite canonical checkpoints.
   */
  saveOwned?(
    context: InteractionContext<TInput, TResult>,
    ownership: InteractionCheckpointOwnership,
  ): MaybePromise<boolean>;
  /** Optional for source compatibility; SDK run fails closed when unsupported. */
  claimStart?(interactionId: string): MaybePromise<InteractionStartClaim>;
  /** Returns true only when the supplied claim owns the active start reservation. */
  releaseStart?(interactionId: string, claimId: string): MaybePromise<boolean>;
  /** Optional for source compatibility; SDK resume fails closed when unsupported. */
  claimResume?(interactionId: string): MaybePromise<InteractionResumeClaim<TInput, TResult>>;
  /** Returns true only when the supplied lease owned the active resume claim. */
  releaseResume?(interactionId: string, leaseId: string): MaybePromise<boolean>;
}

export interface InMemoryInteractionCheckpointOptions {
  /** Lease lifetime used for both start reservations and Human resume ownership. */
  lease_ttl_ms?: number;
  /** Injectable wall clock for deterministic recovery tests. */
  now?: () => Date;
}

export class InteractionCheckpointError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InteractionCheckpointError';
  }
}

interface ActiveInteractionLease {
  id: string;
  expires_at: string;
  fence: number;
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
 * references with callers. Start/resume claims and fenced writes are
 * synchronous Map mutations, making compare-and-claim/save atomic inside one
 * JavaScript process. Durable stores must provide equivalent transactional
 * semantics across workers/processes.
 *
 * Lease expiry permits a new owner to reclaim an abandoned reservation; expiry
 * alone does not revoke the current owner. The old owner becomes fenced only
 * after a successful reclaim replaces its opaque claim/lease ID. This avoids
 * penalizing a slow owner when no competing recovery has actually occurred.
 */
export class InMemoryInteractionCheckpointStore<TInput = unknown, TResult = unknown>
implements InteractionCheckpointStore<TInput, TResult> {
  private readonly checkpoints = new Map<string, InteractionContext<TInput, TResult>>();
  private readonly startClaims = new Map<string, ActiveInteractionLease>();
  private readonly resumeLeases = new Map<string, ActiveInteractionLease>();
  private readonly startFences = new Map<string, number>();
  private readonly resumeFences = new Map<string, number>();
  private readonly leaseTtlMs: number;
  private readonly now: () => Date;

  constructor(options: InMemoryInteractionCheckpointOptions = {}) {
    this.leaseTtlMs = options.lease_ttl_ms ?? 300_000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.leaseTtlMs) || this.leaseTtlMs <= 0) {
      throw new InteractionCheckpointError(
        'interaction.lease_ttl_invalid',
        'Interaction checkpoint lease TTL must be a positive finite number of milliseconds',
      );
    }
  }

  private createLease(prefix: 'start-claim' | 'resume-lease', fence: number): ActiveInteractionLease {
    const claimedAt = this.now();
    return {
      id: `${prefix}:${randomUUID()}`,
      expires_at: new Date(claimedAt.getTime() + this.leaseTtlMs).toISOString(),
      fence,
    };
  }

  private nextFence(counters: Map<string, number>, interactionId: string): number {
    const fence = (counters.get(interactionId) ?? 0) + 1;
    counters.set(interactionId, fence);
    return fence;
  }

  private isExpired(lease: ActiveInteractionLease): boolean {
    const expiresAt = Date.parse(lease.expires_at);
    return Number.isFinite(expiresAt) && expiresAt <= this.now().getTime();
  }

  save(context: InteractionContext<TInput, TResult>): void {
    this.checkpoints.set(context.interaction_id, snapshot(context));
  }

  saveOwned(
    context: InteractionContext<TInput, TResult>,
    ownership: InteractionCheckpointOwnership,
  ): boolean {
    if (ownership.kind === 'start') {
      const active = this.startClaims.get(context.interaction_id);
      if (!active || active.id !== ownership.claim_id) return false;
      if (ownership.fence !== undefined && active.fence !== ownership.fence) return false;
      this.checkpoints.set(context.interaction_id, snapshot(context));
      return true;
    }

    const active = this.resumeLeases.get(context.interaction_id);
    if (!active || active.id !== ownership.lease_id) return false;
    if (ownership.fence !== undefined && active.fence !== ownership.fence) return false;
    this.checkpoints.set(context.interaction_id, snapshot(context));
    return true;
  }

  load(interactionId: string): InteractionContext<TInput, TResult> | undefined {
    const stored = this.checkpoints.get(interactionId);
    return stored ? snapshot(stored) : undefined;
  }

  claimStart(interactionId: string): InteractionStartClaim {
    const existing = this.startClaims.get(interactionId);
    const hasCheckpoint = this.checkpoints.has(interactionId);

    // A currently live creator still owns admission even after it has emitted
    // intermediate checkpoints. Once that owner expires or releases, any
    // canonical checkpoint makes the interaction identity non-restartable.
    if (existing && !this.isExpired(existing)) return { status: 'conflict' };
    if (hasCheckpoint) return { status: 'exists' };

    const recovered = Boolean(existing);
    const fence = this.nextFence(this.startFences, interactionId);
    const lease = this.createLease('start-claim', fence);
    this.startClaims.set(interactionId, lease);
    return {
      status: 'claimed',
      lease: {
        interaction_id: interactionId,
        claim_id: lease.id,
        claim_expires_at: lease.expires_at,
        fence: lease.fence,
        ...(recovered ? { recovered: true } : {}),
      },
    };
  }

  releaseStart(interactionId: string, claimId: string): boolean {
    const active = this.startClaims.get(interactionId);
    if (!active || active.id !== claimId) return false;
    this.startClaims.delete(interactionId);
    return true;
  }

  claimResume(interactionId: string): InteractionResumeClaim<TInput, TResult> {
    const stored = this.checkpoints.get(interactionId);
    if (!stored) return { status: 'not_found' };

    const existing = this.resumeLeases.get(interactionId);
    if (existing && !this.isExpired(existing)) return { status: 'conflict' };

    const recovered = Boolean(existing);
    const fence = this.nextFence(this.resumeFences, interactionId);
    const lease = this.createLease('resume-lease', fence);
    this.resumeLeases.set(interactionId, lease);
    return {
      status: 'claimed',
      lease: {
        interaction_id: interactionId,
        lease_id: lease.id,
        context: snapshot(stored),
        lease_expires_at: lease.expires_at,
        fence: lease.fence,
        ...(recovered ? { recovered: true } : {}),
      },
    };
  }

  releaseResume(interactionId: string, leaseId: string): boolean {
    const active = this.resumeLeases.get(interactionId);
    if (!active || active.id !== leaseId) return false;
    this.resumeLeases.delete(interactionId);
    return true;
  }

  clear(interactionId?: string): void {
    if (interactionId) {
      this.checkpoints.delete(interactionId);
      this.startClaims.delete(interactionId);
      this.resumeLeases.delete(interactionId);
      this.startFences.delete(interactionId);
      this.resumeFences.delete(interactionId);
      return;
    }
    this.checkpoints.clear();
    this.startClaims.clear();
    this.resumeLeases.clear();
    this.startFences.clear();
    this.resumeFences.clear();
  }
}
