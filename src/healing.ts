import { randomUUID } from 'node:crypto';
import { sha256 } from './security.js';
import type { LifecycleState } from './types.js';

export interface HealingFailure {
  code: string;
  message: string;
  path?: string;
  evidence?: string[];
}

export interface HealingStep<T = unknown> {
  canonical_label: string;
  apply(value: T): T | Promise<T>;
  validate?(before: T, after: T): boolean | Promise<boolean>;
}

export interface HealingAttempt {
  canonical_label: string;
  attempted_at: string;
  input_fingerprint: string;
  outcome: 'applied' | 'rejected' | 'failed';
  failure?: string;
}

export interface EscalationRecord<T = unknown> {
  escalation_id: string;
  interaction_id: string;
  correlation_id: string;
  cause: HealingFailure;
  current_state: LifecycleState;
  resume_state: LifecycleState;
  value: T;
  attempts: HealingAttempt[];
  created_at: string;
  status: 'pending_human' | 'resolved' | 'cancelled';
  human_event_ref?: string;
}

export function healingFingerprint(value: unknown): string {
  return sha256({
    profile: 'h2a2h.healing.input-fingerprint.v1',
    value,
  });
}

function cloneAttempts(attempts: readonly HealingAttempt[]): HealingAttempt[] {
  return structuredClone([...attempts]);
}

/**
 * Stateless-across-invocations healing coordinator.
 *
 * Recursive/cycle state belongs to one `heal()` execution only. Reusing the
 * coordinator instance cannot leak prior visits or attempts into a later
 * Intent-based Healing invocation.
 */
export class HealingCoordinator<T = unknown> {
  async heal(value: T, steps: readonly HealingStep<T>[]): Promise<{ value: T; attempts: HealingAttempt[] }> {
    const attempts: HealingAttempt[] = [];
    const visited = new Set<string>();
    let current = value;

    for (const step of steps) {
      if (!step.canonical_label.trim()) {
        throw new Error('healing.step.canonical_label_required');
      }

      const inputFingerprint = healingFingerprint(current);
      const visitKey = `${step.canonical_label}:${inputFingerprint}`;
      if (visited.has(visitKey)) {
        throw new Error(`healing.cycle_detected:${step.canonical_label}`);
      }
      visited.add(visitKey);

      try {
        const next = await step.apply(current);
        const valid = step.validate ? await step.validate(current, next) : true;
        attempts.push({
          canonical_label: step.canonical_label,
          attempted_at: new Date().toISOString(),
          input_fingerprint: inputFingerprint,
          outcome: valid ? 'applied' : 'rejected',
        });
        if (!valid) continue;
        current = next;
      } catch (error) {
        attempts.push({
          canonical_label: step.canonical_label,
          attempted_at: new Date().toISOString(),
          input_fingerprint: inputFingerprint,
          outcome: 'failed',
          failure: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      value: current,
      attempts: cloneAttempts(attempts),
    };
  }

  escalate(input: {
    interaction_id: string;
    correlation_id: string;
    cause: HealingFailure;
    current_state: LifecycleState;
    resume_state: LifecycleState;
    value: T;
    /** Attempts from the exact healing invocation being escalated. */
    attempts?: readonly HealingAttempt[];
  }): EscalationRecord<T> {
    return {
      escalation_id: `escalation:${randomUUID()}`,
      interaction_id: input.interaction_id,
      correlation_id: input.correlation_id,
      cause: structuredClone(input.cause),
      current_state: input.current_state,
      resume_state: input.resume_state,
      value: structuredClone(input.value),
      attempts: cloneAttempts(input.attempts ?? []),
      created_at: new Date().toISOString(),
      status: 'pending_human',
    };
  }

  resolveWithHuman<U extends EscalationRecord<T>>(
    escalation: U,
    correction: T,
    humanEventRef: string,
  ): U {
    return {
      ...structuredClone(escalation),
      value: structuredClone(correction),
      status: 'resolved',
      human_event_ref: humanEventRef,
    } as U;
  }

  cancel<U extends EscalationRecord<T>>(escalation: U, humanEventRef: string): U {
    return {
      ...structuredClone(escalation),
      status: 'cancelled',
      human_event_ref: humanEventRef,
    } as U;
  }
}
