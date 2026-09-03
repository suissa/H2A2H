import { sha256 } from './security.js';
import type { EntityRef, IntentRef, LifecycleState } from './types.js';

export interface IntentTraceReason {
  canonical_label: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface IntentTransitionTraceInput {
  trace_id: string;
  interaction_id: string;
  intent: IntentRef;
  actor: EntityRef;
  transition: {
    from: LifecycleState | null;
    to: LifecycleState;
  };
  reason: IntentTraceReason;
  failed_constraints?: string[];
  alternatives_available?: boolean;
  disclosure?: {
    share_with_counterparty: boolean;
    allowed_fields?: string[];
  };
  occurred_at: string;
}

export interface IntentTransitionTrace extends IntentTransitionTraceInput {
  protocol: 'h2a2h.intent-trace';
  version: '1.0.0';
  trace_hash: string;
}

export function createIntentTransitionTrace(input: IntentTransitionTraceInput): IntentTransitionTrace {
  const payload = {
    trace_id: input.trace_id,
    interaction_id: input.interaction_id,
    intent: input.intent,
    actor: input.actor,
    transition: input.transition,
    reason: input.reason,
    failed_constraints: [...(input.failed_constraints ?? [])].sort(),
    alternatives_available: input.alternatives_available ?? false,
    ...(input.disclosure ? { disclosure: input.disclosure } : {}),
    occurred_at: input.occurred_at,
  };
  return {
    protocol: 'h2a2h.intent-trace',
    version: '1.0.0',
    ...input,
    ...(input.failed_constraints ? { failed_constraints: [...input.failed_constraints].sort() } : {}),
    trace_hash: sha256(payload),
  };
}

export interface HumanChallengeInput {
  challenge_id: string;
  canonical_label: string;
  interaction_id: string;
  action_commitment_hash: string;
  subject: EntityRef;
  provider: EntityRef;
  presented_payload: unknown;
  created_at: string;
  expires_at: string;
}

export interface HumanChallenge extends Omit<HumanChallengeInput, 'presented_payload'> {
  protocol: 'h2a2h.challenge';
  version: '1.0.0';
  status: 'required' | 'presented' | 'satisfied' | 'rejected' | 'expired';
  presented_hash: string;
}

export function createHumanChallenge(input: HumanChallengeInput): HumanChallenge {
  return {
    protocol: 'h2a2h.challenge',
    version: '1.0.0',
    status: 'required',
    challenge_id: input.challenge_id,
    canonical_label: input.canonical_label,
    interaction_id: input.interaction_id,
    action_commitment_hash: input.action_commitment_hash,
    subject: input.subject,
    provider: input.provider,
    created_at: input.created_at,
    expires_at: input.expires_at,
    presented_hash: sha256(input.presented_payload),
  };
}

export interface HumanChallengeProof {
  challenge_id: string;
  canonical_label: string;
  action_commitment_hash: string;
  presented_hash: string;
  response_hash: string;
  subject: EntityRef;
  satisfied_at: string;
  proof_ref: string;
}

export function satisfyHumanChallenge(
  challenge: HumanChallenge,
  response: unknown,
  options: { satisfied_at: string; proof_ref: string },
): HumanChallengeProof {
  if (challenge.status === 'expired' || challenge.status === 'rejected') {
    throw new Error(`challenge.not_satisfiable:${challenge.status}`);
  }
  const expires = new Date(challenge.expires_at).getTime();
  const satisfied = new Date(options.satisfied_at).getTime();
  if (!Number.isFinite(expires) || !Number.isFinite(satisfied) || satisfied > expires) {
    throw new Error('challenge.expired');
  }
  return {
    challenge_id: challenge.challenge_id,
    canonical_label: challenge.canonical_label,
    action_commitment_hash: challenge.action_commitment_hash,
    presented_hash: challenge.presented_hash,
    response_hash: sha256(response),
    subject: challenge.subject,
    satisfied_at: options.satisfied_at,
    proof_ref: options.proof_ref,
  };
}
