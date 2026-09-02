import { randomUUID } from 'node:crypto';
import type {
  EntityRef,
  HumanEscalationRequired,
  InteractionContext,
  LifecycleState,
  RunRequest,
  RuntimeBindings,
  TransitionRecord,
} from './types.js';

const TERMINAL = new Set<LifecycleState>([
  'CLOSED',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
  'FAILED_TERMINAL',
]);

const ALLOWED: Record<LifecycleState, ReadonlySet<LifecycleState>> = {
  CREATED: new Set(['INTENT_CAPTURED', 'REJECTED', 'FAILED_TERMINAL']),
  INTENT_CAPTURED: new Set(['AUTHORITY_VALIDATED', 'HEALING_REQUIRED', 'HUMAN_ESCALATION_REQUIRED', 'REJECTED']),
  AUTHORITY_VALIDATED: new Set(['PARTICIPANTS_RESOLVED', 'HUMAN_ESCALATION_REQUIRED', 'EXPIRED', 'REJECTED']),
  PARTICIPANTS_RESOLVED: new Set(['CHANNEL_BOUND', 'SUSPENDED', 'HUMAN_ESCALATION_REQUIRED', 'FAILED_TERMINAL']),
  CHANNEL_BOUND: new Set(['EXECUTING', 'SUSPENDED', 'FAILED_TERMINAL']),
  EXECUTING: new Set(['RETURN_PENDING', 'HEALING_REQUIRED', 'HUMAN_ESCALATION_REQUIRED', 'SUSPENDED', 'FAILED_TERMINAL']),
  RETURN_PENDING: new Set(['HUMAN_RETURNED', 'HUMAN_ESCALATION_REQUIRED', 'SUSPENDED', 'FAILED_TERMINAL']),
  HUMAN_RETURNED: new Set(['ACKNOWLEDGED', 'CLOSED', 'HUMAN_ESCALATION_REQUIRED', 'FAILED_TERMINAL']),
  ACKNOWLEDGED: new Set(['CLOSED']),
  CLOSED: new Set(),
  HEALING_REQUIRED: new Set(['INTENT_CAPTURED', 'AUTHORITY_VALIDATED', 'PARTICIPANTS_RESOLVED', 'CHANNEL_BOUND', 'EXECUTING', 'RETURN_PENDING', 'HUMAN_ESCALATION_REQUIRED', 'FAILED_TERMINAL']),
  HUMAN_ESCALATION_REQUIRED: new Set(['INTENT_CAPTURED', 'AUTHORITY_VALIDATED', 'PARTICIPANTS_RESOLVED', 'CHANNEL_BOUND', 'EXECUTING', 'RETURN_PENDING', 'HUMAN_RETURNED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FAILED_TERMINAL']),
  SUSPENDED: new Set(['PARTICIPANTS_RESOLVED', 'CHANNEL_BOUND', 'EXECUTING', 'RETURN_PENDING', 'CANCELLED', 'EXPIRED', 'FAILED_TERMINAL']),
  CANCELLED: new Set(),
  EXPIRED: new Set(),
  REJECTED: new Set(),
  FAILED_TERMINAL: new Set(),
};

export class H2A2HRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly interactionId?: string,
  ) {
    super(message);
    this.name = 'H2A2HRuntimeError';
  }
}

function id(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

export function humanEscalationRequired(
  value: Omit<HumanEscalationRequired, 'kind'>,
): HumanEscalationRequired {
  return { kind: 'human_escalation_required', ...value };
}

export function isHumanEscalationRequired(value: unknown): value is HumanEscalationRequired {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HumanEscalationRequired>;
  return candidate.kind === 'human_escalation_required'
    && typeof candidate.code === 'string'
    && typeof candidate.reason === 'string'
    && Array.isArray(candidate.evidence)
    && typeof candidate.resume_state === 'string'
    && Boolean(candidate.human_action)
    && typeof candidate.human_action?.canonical_label === 'string';
}

export class H2A2HRuntime<TInput = unknown, TResult = unknown> {
  constructor(private readonly bindings: RuntimeBindings<TInput, TResult>) {}

  async run(request: RunRequest<TInput>): Promise<InteractionContext<TInput, TResult>> {
    const interactionId = request.interaction_id ?? id('interaction');
    const correlationId = request.correlation_id ?? id('correlation');

    const resolvedIntent = await this.bindings.resolveIntent(
      request.intent.canonical_label,
      request.intent.version,
    );

    const context: InteractionContext<TInput, TResult> = {
      interaction_id: interactionId,
      correlation_id: correlationId,
      state: 'CREATED',
      initiating_human: request.initiating_human,
      intent: resolvedIntent,
      input: request.input,
      transitions: [],
    };

    await this.recordInitial(context);
    await this.transition(context, 'INTENT_CAPTURED', 'h2a2h.lifecycle.intent_captured');

    const delegation = await this.bindings.validateDelegation(context);
    context.delegation = delegation;
    if (!delegation.valid) {
      const code = delegation.reason ?? 'delegation.invalid';
      if (code === 'delegation.expired') {
        await this.transition(context, 'EXPIRED', 'h2a2h.delegation.expired', delegation.evidence ?? []);
        return context;
      }

      context.human_escalation = humanEscalationRequired({
        code,
        reason: 'Delegated authority could not be validated',
        evidence: delegation.evidence ?? [],
        resume_state: 'INTENT_CAPTURED',
        human_action: {
          canonical_label: 'Human.Delegation.Provide',
          metadata: { delegation_reason: code },
        },
      });
      await this.transition(
        context,
        'HUMAN_ESCALATION_REQUIRED',
        `h2a2h.${code}`,
        context.human_escalation.evidence,
      );
      return context;
    }
    await this.transition(context, 'AUTHORITY_VALIDATED', 'h2a2h.lifecycle.authority_validated', delegation.evidence ?? []);

    context.participants = await this.bindings.resolveParticipants(context);
    await this.transition(context, 'PARTICIPANTS_RESOLVED', 'h2a2h.lifecycle.participants_resolved');

    context.channel = await this.bindings.resolveChannel(context);
    await this.transition(context, 'CHANNEL_BOUND', 'h2a2h.lifecycle.channel_bound');

    await this.transition(context, 'EXECUTING', 'h2a2h.lifecycle.executing');
    const execution = await this.bindings.execute(context);
    if (isHumanEscalationRequired(execution)) {
      context.human_escalation = execution;
      await this.transition(
        context,
        'HUMAN_ESCALATION_REQUIRED',
        `h2a2h.${execution.code}`,
        execution.evidence,
      );
      return context;
    }
    context.result = execution;

    await this.transition(context, 'RETURN_PENDING', 'h2a2h.lifecycle.return_pending');
    context.human_return = await this.bindings.returnToHuman(context);
    await this.transition(context, 'HUMAN_RETURNED', 'h2a2h.lifecycle.human_returned', [context.human_return.proof_ref]);

    if (context.intent.acknowledgement_required) {
      if (context.human_return.return_state !== 'human_acknowledged') {
        if (!this.bindings.acknowledge) {
          context.human_escalation = humanEscalationRequired({
            code: 'human.acknowledgement_required',
            reason: 'Intent requires Human acknowledgement',
            evidence: [context.human_return.proof_ref],
            resume_state: 'HUMAN_RETURNED',
            human_action: {
              canonical_label: 'Human.Acknowledgement.Provide',
              metadata: { proof_ref: context.human_return.proof_ref },
            },
          });
          await this.transition(
            context,
            'HUMAN_ESCALATION_REQUIRED',
            'h2a2h.human.acknowledgement_required',
            context.human_escalation.evidence,
          );
          return context;
        }
        await this.bindings.acknowledge(context);
      }
      await this.transition(context, 'ACKNOWLEDGED', 'h2a2h.lifecycle.acknowledged');
    }

    await this.transition(context, 'CLOSED', 'h2a2h.lifecycle.closed');
    return context;
  }

  async transition(
    context: InteractionContext<TInput, TResult>,
    to: LifecycleState,
    event: string,
    evidence: string[] = [],
    actor?: EntityRef,
  ): Promise<void> {
    if (TERMINAL.has(context.state)) {
      throw new H2A2HRuntimeError(
        'lifecycle.terminal_state',
        `Cannot transition terminal interaction from ${context.state} to ${to}`,
        context.interaction_id,
      );
    }

    if (!ALLOWED[context.state].has(to)) {
      throw new H2A2HRuntimeError(
        'lifecycle.invalid_transition',
        `Invalid H2A2H lifecycle transition ${context.state} -> ${to}`,
        context.interaction_id,
      );
    }

    const from = context.state;
    context.state = to;
    const transition: TransitionRecord = {
      interaction_id: context.interaction_id,
      from,
      to,
      event,
      correlation_id: context.correlation_id,
      timestamp: new Date().toISOString(),
      evidence,
      ...(actor ? { actor } : {}),
    };
    context.transitions.push(transition);
    await this.bindings.onTransition?.(transition, context);
  }

  private async recordInitial(context: InteractionContext<TInput, TResult>): Promise<void> {
    const transition: TransitionRecord = {
      interaction_id: context.interaction_id,
      from: null,
      to: 'CREATED',
      event: 'h2a2h.lifecycle.created',
      actor: context.initiating_human,
      correlation_id: context.correlation_id,
      timestamp: new Date().toISOString(),
      evidence: [],
    };
    context.transitions.push(transition);
    await this.bindings.onTransition?.(transition, context);
  }
}

export function isTerminalState(state: LifecycleState): boolean {
  return TERMINAL.has(state);
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return ALLOWED[from].has(to);
}
