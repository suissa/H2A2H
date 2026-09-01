import { randomUUID } from 'node:crypto';
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

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value, Object.keys((value && typeof value === 'object' ? value : {}) as object).sort());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class HealingCoordinator<T = unknown> {
  private readonly attempts: HealingAttempt[] = [];
  private readonly visited = new Set<string>();

  async heal(value: T, steps: readonly HealingStep<T>[]): Promise<{ value: T; attempts: HealingAttempt[] }> {
    let current = value;
    for (const step of steps) {
      const inputFingerprint = fingerprint(current);
      const visitKey = `${step.canonical_label}:${inputFingerprint}`;
      if (this.visited.has(visitKey)) {
        throw new Error(`healing.cycle_detected:${step.canonical_label}`);
      }
      this.visited.add(visitKey);

      try {
        const next = await step.apply(current);
        const valid = step.validate ? await step.validate(current, next) : true;
        const attempt: HealingAttempt = {
          canonical_label: step.canonical_label,
          attempted_at: new Date().toISOString(),
          input_fingerprint: inputFingerprint,
          outcome: valid ? 'applied' : 'rejected',
        };
        this.attempts.push(attempt);
        if (!valid) continue;
        current = next;
      } catch (error) {
        this.attempts.push({
          canonical_label: step.canonical_label,
          attempted_at: new Date().toISOString(),
          input_fingerprint: inputFingerprint,
          outcome: 'failed',
          failure: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { value: current, attempts: [...this.attempts] };
  }

  escalate(input: {
    interaction_id: string;
    correlation_id: string;
    cause: HealingFailure;
    current_state: LifecycleState;
    resume_state: LifecycleState;
    value: T;
  }): EscalationRecord<T> {
    return {
      escalation_id: `escalation:${randomUUID()}`,
      interaction_id: input.interaction_id,
      correlation_id: input.correlation_id,
      cause: input.cause,
      current_state: input.current_state,
      resume_state: input.resume_state,
      value: input.value,
      attempts: [...this.attempts],
      created_at: new Date().toISOString(),
      status: 'pending_human',
    };
  }

  resolveWithHuman<U extends EscalationRecord<T>>(
    escalation: U,
    correction: T,
    humanEventRef: string,
  ): U {
    escalation.value = correction;
    escalation.status = 'resolved';
    escalation.human_event_ref = humanEventRef;
    return escalation;
  }

  cancel<U extends EscalationRecord<T>>(escalation: U, humanEventRef: string): U {
    escalation.status = 'cancelled';
    escalation.human_event_ref = humanEventRef;
    return escalation;
  }
}
