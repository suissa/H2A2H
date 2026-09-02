import type { InteractionContext, MaybePromise } from './types.js';

export interface InteractionCheckpointStore<TInput = unknown, TResult = unknown> {
  save(context: InteractionContext<TInput, TResult>): MaybePromise<void>;
  load(interactionId: string): MaybePromise<InteractionContext<TInput, TResult> | undefined>;
}

function snapshot<TInput, TResult>(
  context: InteractionContext<TInput, TResult>,
): InteractionContext<TInput, TResult> {
  return structuredClone(context);
}

/**
 * Reference checkpoint store for one runtime process.
 *
 * Every write and read is cloned so the authoritative checkpoint never shares
 * a mutable object reference with callers. Production deployments can inject a
 * durable implementation using the same contract.
 */
export class InMemoryInteractionCheckpointStore<TInput = unknown, TResult = unknown>
implements InteractionCheckpointStore<TInput, TResult> {
  private readonly checkpoints = new Map<string, InteractionContext<TInput, TResult>>();

  save(context: InteractionContext<TInput, TResult>): void {
    this.checkpoints.set(context.interaction_id, snapshot(context));
  }

  load(interactionId: string): InteractionContext<TInput, TResult> | undefined {
    const stored = this.checkpoints.get(interactionId);
    return stored ? snapshot(stored) : undefined;
  }

  clear(interactionId?: string): void {
    if (interactionId) {
      this.checkpoints.delete(interactionId);
      return;
    }
    this.checkpoints.clear();
  }
}
