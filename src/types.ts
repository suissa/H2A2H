export type EntityKind =
  | 'Human'
  | 'Agent'
  | 'Organization'
  | 'Service'
  | 'Device'
  | 'Government'
  | 'Hospital'
  | 'School'
  | 'Business'
  | (string & {});

export interface EntityRef {
  entity_id: string;
  kind: EntityKind;
  canonical_label?: string;
}

export interface IntentRef {
  canonical_label: string;
  version: string;
}

export type MessageKind =
  | 'request'
  | 'response'
  | 'event'
  | 'acknowledgement'
  | 'escalation'
  | 'proof';

export interface H2A2HEnvelope<T = unknown> {
  protocol: 'h2a2h';
  version: string;
  message_id: string;
  interaction_id: string;
  correlation_id: string;
  causation_id?: string;
  idempotency_key?: string;
  kind: MessageKind;
  intent: IntentRef;
  sender: EntityRef;
  receiver: EntityRef;
  timestamp: string;
  expires_at?: string;
  delegation?: {
    delegation_id: string;
    chain_digest?: string;
  };
  responsibility_chain_ref?: string;
  payload: {
    schema: string;
    media_type?: string;
    value: T;
  };
  proofs?: Array<{ type: string; ref: string }>;
  trace?: { trace_id?: string; span_id?: string };
  channel?: { profile: string; metadata?: Record<string, unknown> };
  extensions?: Record<string, unknown>;
}

export type LifecycleState =
  | 'CREATED'
  | 'INTENT_CAPTURED'
  | 'AUTHORITY_VALIDATED'
  | 'PARTICIPANTS_RESOLVED'
  | 'CHANNEL_BOUND'
  | 'EXECUTING'
  | 'RETURN_PENDING'
  | 'HUMAN_RETURNED'
  | 'ACKNOWLEDGED'
  | 'CLOSED'
  | 'HEALING_REQUIRED'
  | 'HUMAN_ESCALATION_REQUIRED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'FAILED_TERMINAL';

export interface TransitionRecord {
  interaction_id: string;
  from: LifecycleState | null;
  to: LifecycleState;
  event: string;
  actor?: EntityRef;
  correlation_id: string;
  causation_id?: string;
  timestamp: string;
  evidence: string[];
}

export interface ResolvedIntent {
  ref: IntentRef;
  input_schema: string;
  output_schema: string;
  acknowledgement_required?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DelegationValidation {
  valid: boolean;
  delegation_id?: string;
  evidence?: string[];
  reason?: string;
}

export interface ParticipantResolution {
  sender: EntityRef;
  receiver: EntityRef;
  receiving_human: EntityRef;
  responsibility_chain_ref?: string;
}

export interface ChannelBinding {
  profile: string;
  metadata?: Record<string, unknown>;
}

export interface HumanReturnResult {
  proof_ref: string;
  return_state: 'human_presented' | 'human_acknowledged';
}

export interface HumanActionRequest {
  canonical_label: string;
  metadata?: Record<string, unknown>;
}

/**
 * Expected Human-in-the-loop control outcome. This is protocol data, not a
 * technical exception. `resume_state` identifies the lifecycle checkpoint that
 * should be re-entered after the requested Human action has been satisfied.
 */
export interface HumanEscalationRequired {
  kind: 'human_escalation_required';
  code: string;
  reason: string;
  evidence: string[];
  resume_state: LifecycleState;
  human_action: HumanActionRequest;
}

export interface InteractionContext<TInput = unknown, TResult = unknown> {
  interaction_id: string;
  correlation_id: string;
  state: LifecycleState;
  initiating_human: EntityRef;
  intent: ResolvedIntent;
  input: TInput;
  delegation?: DelegationValidation;
  participants?: ParticipantResolution;
  channel?: ChannelBinding;
  result?: TResult;
  human_return?: HumanReturnResult;
  human_escalation?: HumanEscalationRequired;
  transitions: TransitionRecord[];
}

export type MaybePromise<T> = T | Promise<T>;

export interface RuntimeBindings<TInput = unknown, TResult = unknown> {
  resolveIntent(canonicalLabel: string, version?: string): MaybePromise<ResolvedIntent>;
  validateDelegation(context: InteractionContext<TInput, TResult>): MaybePromise<DelegationValidation>;
  resolveParticipants(context: InteractionContext<TInput, TResult>): MaybePromise<ParticipantResolution>;
  resolveChannel(context: InteractionContext<TInput, TResult>): MaybePromise<ChannelBinding>;
  execute(context: InteractionContext<TInput, TResult>): MaybePromise<TResult | HumanEscalationRequired>;
  returnToHuman(context: InteractionContext<TInput, TResult>): MaybePromise<HumanReturnResult>;
  acknowledge?(context: InteractionContext<TInput, TResult>): MaybePromise<void>;
  onTransition?(transition: TransitionRecord, context: InteractionContext<TInput, TResult>): MaybePromise<void>;
}

export interface RunRequest<TInput = unknown> {
  initiating_human: EntityRef;
  intent: { canonical_label: string; version?: string };
  input: TInput;
  interaction_id?: string;
  correlation_id?: string;
}
