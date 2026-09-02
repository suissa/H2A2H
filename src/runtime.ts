import { randomUUID } from 'node:crypto';
import type {
  EntityRef,
  HumanEscalationRequired,
  InteractionContext,
  LifecycleState,
  ResumeRequest,
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

const RESUMABLE = new Set<LifecycleState>([
  'INTENT_CAPTURED',
  'AUTHORITY_VALIDATED',
  'PARTICIPANTS_RESOLVED',
  'CHANNEL_BOUND',
  'EXECUTING',
  'RETURN_PENDING',
  'HUMAN_RETURNED',
]);

const ALLOWED: Record<LifecycleState, ReadonlySet<LifecycleState>> = {
  CREATED: new Set(['INTENT_CAPTURED', 'REJECTED', 'FAILED_TERMINAL']),
  INTENT_CAPTURED: new Set(['AUTHORITY_VALIDATED', 'HEALING_REQUIRED', 'HUMAN_ESCALATION_REQUIRED', 'EXPIRED', 'REJECTED']),
  AUTHORITY_VALIDATED: new Set(['PARTICIPANTS_RESOLVED', 'HUMAN_ESCALATION_REQUIRED', 'EXPIRED', 'REJECTED']),
  PARTICIPANTS_RESOLVED: new Set(['CHANNEL_BOUND', 'SUSPENDED', 'HUMAN_ESCALATION_REQUIRED', 'FAILED_TERMINAL']),
  CHANNEL_BOUND: new Set(['EXECUTING', 'SUSPENDED', 'FAILED_TERMINAL']),
  EXECUTING: new Set(['RETURN_PENDING', 'HEALING_REQUIRED', 'HUMAN_ESCALATION_REQUIRED', 'SUSPENDED', 'FAILED_TERMINAL']),
  RETURN_PENDING: new Set(['HUMAN_RETURNED', 'HUMAN_ESCALATION_REQUIRED', 'SUSPENDED', 'FAILED_TERMINAL']),
  HUMAN_RETURNED: new Set(['ACKNOWLEDGED', 'CLOSED', 'HUMAN_ESCALATION_REQUIRED', 'FAILED_TERMINAL']),
  ACKNOWLEDGED: new Set(['CLOSED']),
  CLOSED: new Set(),
  HEALING_REQUIRED: new Set(['INTENT_CAPTURED', 'AUTHORITY_VALIDATED', 'PARTICIPANTS_RESOLVED', 'CHANNEL_BOUND', 'EXECUTING', 'RETURN_PENDING', 'HUMAN_ESCALATION_REQUIRED', 'FAILED_TERMINAL']),
  HUMAN_ESCALATION_REQUIRED: new Set(['HUMAN_ESCALATION_REQUIRED', 'INTENT_CAPTURED', 'AUTHORITY_VALIDATED', 'PARTICIPANTS_RESOLVED', 'CHANNEL_BOUND', 'EXECUTING', 'RETURN_PENDING', 'HUMAN_RETURNED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FAILED_TERMINAL']),
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
    return this.continueFrom(context, 'INTENT_CAPTURED');
  }

  async resume(
    context: InteractionContext<TInput, TResult>,
    request: ResumeRequest<TInput>,
  ): Promise<InteractionContext<TInput, TResult>> {
    if (context.state !== 'HUMAN_ESCALATION_REQUIRED') {
      throw new H2A2HRuntimeError(
        'human.resume.not_escalated',
        `Interaction ${context.interaction_id} is not awaiting a Human action`,
        context.interaction_id,
      );
    }

    const escalation = context.human_escalation;
    if (!escalation) {
      throw new H2A2HRuntimeError(
        'human.resume.missing_escalation',
        'Human escalation state has no escalation contract',
        context.interaction_id,
      );
    }

    if (!RESUMABLE.has(escalation.resume_state)) {
      throw new H2A2HRuntimeError(
        'human.resume.unsupported_checkpoint',
        `Cannot resume H2A2H interaction from ${escalation.resume_state}`,
        context.interaction_id,
      );
    }

    const validateHumanAction = this.bindings.validateHumanAction;
    if (!validateHumanAction) {
      throw new H2A2HRuntimeError(
        'human.resume.validator_missing',
        'Human resume requires validateHumanAction binding',
        context.interaction_id,
      );
    }

    const action = request.human_action;
    if (
      action.actor.kind !== 'Human'
      || action.canonical_label !== escalation.human_action.canonical_label
    ) {
      await this.transition(
        context,
        'HUMAN_ESCALATION_REQUIRED',
        'h2a2h.human.resume_rejected',
        action.evidence,
        action.actor,
      );
      return context;
    }

    const validation = await validateHumanAction(context, action, escalation.human_action);
    if (!validation.valid) {
      await this.transition(
        context,
        'HUMAN_ESCALATION_REQUIRED',
        `h2a2h.${validation.reason ?? 'human.resume.evidence_invalid'}`,
        validation.evidence ?? action.evidence,
        action.actor,
      );
      return context;
    }

    if ('input' in request) {
      context.input = request.input as TInput;
    }

    const resumeState = escalation.resume_state;
    const resumeEvidence = validation.evidence ?? action.evidence;
    delete context.human_escalation;

    await this.transition(
      context,
      resumeState,
      'h2a2h.lifecycle.resumed',
      resumeEvidence,
      action.actor,
    );

    if (
      resumeState === 'HUMAN_RETURNED'
      && action.canonical_label === 'Human.Acknowledgement.Provide'
    ) {
      if (context.human_return) {
        context.human_return = {
          ...context.human_return,
          return_state: 'human_acknowledged',
        };
      }
      if (context.intent.acknowledgement_required) {
        await this.transition(
          context,
          'ACKNOWLEDGED',
          'h2a2h.lifecycle.acknowledged',
          resumeEvidence,
          action.actor,
        );
      }
      await this.transition(context, 'CLOSED', 'h2a2h.lifecycle.closed', resumeEvidence, action.actor);
      return context;
    }

    return this.continueFrom(context, resumeState);
  }

  private async continueFrom(
    context: InteractionContext<TInput, TResult>,
    checkpoint: LifecycleState,
  ): Promise<InteractionContext<TInput, TResult>> {
    switch (checkpoint) {
      case 'INTENT_CAPTURED':
        return this.afterIntentCaptured(context);
      case 'AUTHORITY_VALIDATED':
        return this.afterAuthorityValidated(context);
      case 'PARTICIPANTS_RESOLVED':
        return this.afterParticipantsResolved(context);
      case 'CHANNEL_BOUND':
        return this.afterChannelBound(context);
      case 'EXECUTING':
        return this.afterExecuting(context);
      case 'RETURN_PENDING':
        return this.afterReturnPending(context);
      case 'HUMAN_RETURNED':
        return this.afterHumanReturned(context);
      default:
        throw new H2A2HRuntimeError(
          'human.resume.unsupported_checkpoint',
          `Cannot continue H2A2H interaction from ${checkpoint}`,
          context.interaction_id,
        );
    }
  }

  private async afterIntentCaptured(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
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

    await this.transition(
      context,
      'AUTHORITY_VALIDATED',
      'h2a2h.lifecycle.authority_validated',
      delegation.evidence ?? [],
    );
    return this.afterAuthorityValidated(context);
  }

  private async afterAuthorityValidated(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
    context.participants = await this.bindings.resolveParticipants(context);
    await this.transition(context, 'PARTICIPANTS_RESOLVED', 'h2a2h.lifecycle.participants_resolved');
    return this.afterParticipantsResolved(context);
  }

  private async afterParticipantsResolved(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
    context.channel = await this.bindings.resolveChannel(context);
    await this.transition(context, 'CHANNEL_BOUND', 'h2a2h.lifecycle.channel_bound');
    return this.afterChannelBound(context);
  }

  private async afterChannelBound(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
    await this.transition(context, 'EXECUTING', 'h2a2h.lifecycle.executing');
    return this.afterExecuting(context);
  }

  private async afterExecuting(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
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
    return this.afterReturnPending(context);
  }

  private async afterReturnPending(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
    context.human_return = await this.bindings.returnToHuman(context);
    await this.transition(
      context,
      'HUMAN_RETURNED',
      'h2a2h.lifecycle.human_returned',
      [context.human_return.proof_ref],
    );
    return this.afterHumanReturned(context);
  }

  private async afterHumanReturned(
    context: InteractionContext<TInput, TResult>,
  ): Promise<InteractionContext<TInput, TResult>> {
    if (context.intent.acknowledgement_required) {
      if (context.human_return?.return_state !== 'human_acknowledged') {
        if (!this.bindings.acknowledge) {
          context.human_escalation = humanEscalationRequired({
            code: 'human.acknowledgement_required',
            reason: 'Intent requires Human acknowledgement',
            evidence: context.human_return ? [context.human_return.proof_ref] : [],
            resume_state: 'HUMAN_RETURNED',
            human_action: {
              canonical_label: 'Human.Acknowledgement.Provide',
              metadata: context.human_return
                ? { proof_ref: context.human_return.proof_ref }
                : {},
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
