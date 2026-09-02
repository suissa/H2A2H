import { randomUUID } from 'node:crypto';
import { AuditTrail } from './audit.js';
import { H2A2HRuntime } from './runtime.js';
import { sha256 } from './security.js';
import { ProtocolRegistry } from './registry.js';
import type {
  EntityRef,
  H2A2HEnvelope,
  InteractionContext,
  IntentRef,
  ResumeRequest,
  RunRequest,
  RuntimeBindings,
} from './types.js';

export interface SDKOptions {
  protocol_version?: string;
  registry?: ProtocolRegistry;
  audit?: AuditTrail;
}

export interface CreateEnvelopeInput<T> {
  interaction_id: string;
  correlation_id: string;
  causation_id?: string;
  idempotency_key?: string;
  kind: H2A2HEnvelope<T>['kind'];
  intent: IntentRef;
  sender: EntityRef;
  receiver: EntityRef;
  schema: string;
  value: T;
  delegation_id?: string;
  responsibility_chain_ref?: string;
  channel_profile?: string;
}

export interface ProofOfHumanReturn<T = unknown> {
  protocol: 'h2a2h.pohr';
  version: string;
  proof_id: string;
  interaction_id: string;
  target_human: EntityRef;
  result_digest: { algorithm: 'sha-256'; value: string };
  return_state: 'human_presented' | 'human_acknowledged';
  channel: { profile: string };
  presented_at: string;
  acknowledged_at?: string;
  proof_profile: string;
  evidence_ref: string;
  result?: T;
}

export class H2A2HSDK<TInput = unknown, TResult = unknown> {
  readonly protocolVersion: string;
  readonly registry: ProtocolRegistry;
  readonly audit: AuditTrail;
  readonly runtime: H2A2HRuntime<TInput, TResult>;

  constructor(bindings: RuntimeBindings<TInput, TResult>, options: SDKOptions = {}) {
    this.protocolVersion = options.protocol_version ?? '1.0.0';
    this.registry = options.registry ?? new ProtocolRegistry();
    this.audit = options.audit ?? new AuditTrail();

    const wrapped: RuntimeBindings<TInput, TResult> = {
      ...bindings,
      onTransition: async (transition, context) => {
        this.audit.appendTransition(transition, {
          intent: context.intent.ref,
          ...(context.delegation?.delegation_id ? { delegation_ref: context.delegation.delegation_id } : {}),
          ...(context.channel?.profile ? { channel_profile: context.channel.profile } : {}),
          ...(context.human_return?.proof_ref ? { proof_refs: [context.human_return.proof_ref] } : {}),
        });
        await bindings.onTransition?.(transition, context);
      },
    };
    this.runtime = new H2A2HRuntime(wrapped);
  }

  run(request: RunRequest<TInput>): Promise<InteractionContext<TInput, TResult>> {
    return this.runtime.run(request);
  }

  resume(
    context: InteractionContext<TInput, TResult>,
    request: ResumeRequest<TInput>,
  ): Promise<InteractionContext<TInput, TResult>> {
    return this.runtime.resume(context, request);
  }

  createEnvelope<T>(input: CreateEnvelopeInput<T>): H2A2HEnvelope<T> {
    return {
      protocol: 'h2a2h',
      version: this.protocolVersion,
      message_id: `msg:${randomUUID()}`,
      interaction_id: input.interaction_id,
      correlation_id: input.correlation_id,
      ...(input.causation_id ? { causation_id: input.causation_id } : {}),
      ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
      kind: input.kind,
      intent: input.intent,
      sender: input.sender,
      receiver: input.receiver,
      timestamp: new Date().toISOString(),
      ...(input.delegation_id ? { delegation: { delegation_id: input.delegation_id } } : {}),
      ...(input.responsibility_chain_ref ? { responsibility_chain_ref: input.responsibility_chain_ref } : {}),
      payload: { schema: input.schema, media_type: 'application/json', value: input.value },
      ...(input.channel_profile ? { channel: { profile: input.channel_profile } } : {}),
    };
  }

  finalizeHumanReturn<T>(input: {
    interaction_id: string;
    target_human: EntityRef;
    result: T;
    channel_profile: string;
    return_state: 'human_presented' | 'human_acknowledged';
    evidence_ref: string;
    proof_profile?: string;
    include_result?: boolean;
  }): ProofOfHumanReturn<T> {
    const now = new Date().toISOString();
    return {
      protocol: 'h2a2h.pohr',
      version: this.protocolVersion,
      proof_id: `pohr:${randomUUID()}`,
      interaction_id: input.interaction_id,
      target_human: input.target_human,
      result_digest: { algorithm: 'sha-256'; value: sha256(input.result) },
      return_state: input.return_state,
      channel: { profile: input.channel_profile },
      presented_at: now,
      ...(input.return_state === 'human_acknowledged' ? { acknowledged_at: now } : {}),
      proof_profile: input.proof_profile ?? (
        input.return_state === 'human_acknowledged'
          ? 'h2a2h.pohr.acknowledgement.v1'
          : 'h2a2h.pohr.presentation.v1'
      ),
      evidence_ref: input.evidence_ref,
      ...(input.include_result ? { result: input.result } : {}),
    };
  }

  getAudit() {
    return this.audit.export();
  }

  verifyAudit() {
    return this.audit.verify();
  }
}
