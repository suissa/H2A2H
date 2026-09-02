import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  AuditTrail,
  AuditTrailError,
  InMemoryAuditRecordStore,
  auditInputFromTransition,
  createAuditRecord,
  type AuditRecordStore,
} from './audit.js';
import {
  InMemoryInteractionCheckpointStore,
  type InteractionCheckpointOwnership,
  type InteractionCheckpointStore,
} from './interaction-checkpoint.js';
import { H2A2HRuntime, H2A2HRuntimeError } from './runtime.js';
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

export interface SDKOptions<TInput = unknown, TResult = unknown> {
  protocol_version?: string;
  registry?: ProtocolRegistry;
  /** Optional hydrated local audit view retained for source compatibility. */
  audit?: AuditTrail;
  /** Durable audit authority. Defaults to an in-memory atomic store. */
  audit_store?: AuditRecordStore;
  checkpoint_store?: InteractionCheckpointStore<TInput, TResult>;
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

function isFencedOwnership(ownership: InteractionCheckpointOwnership | undefined): boolean {
  return ownership?.fence !== undefined;
}

export class H2A2HSDK<TInput = unknown, TResult = unknown> {
  readonly protocolVersion: string;
  readonly registry: ProtocolRegistry;
  readonly checkpoints: InteractionCheckpointStore<TInput, TResult>;
  readonly runtime: H2A2HRuntime<TInput, TResult>;
  private readonly auditTrail: AuditTrail;
  private readonly auditStore: AuditRecordStore;
  private readonly checkpointOwnership = new AsyncLocalStorage<InteractionCheckpointOwnership>();

  constructor(
    bindings: RuntimeBindings<TInput, TResult>,
    options: SDKOptions<TInput, TResult> = {},
  ) {
    this.protocolVersion = options.protocol_version ?? '1.0.0';
    this.registry = options.registry ?? new ProtocolRegistry();
    this.auditTrail = options.audit ?? new AuditTrail();
    this.auditStore = options.audit_store ?? new InMemoryAuditRecordStore(this.auditTrail.export());
    this.checkpoints = options.checkpoint_store ?? new InMemoryInteractionCheckpointStore<TInput, TResult>();

    const wrapped: RuntimeBindings<TInput, TResult> = {
      ...bindings,
      onTransition: async (transition, context) => {
        const ownership = this.checkpointOwnership.getStore();
        if (isFencedOwnership(ownership)) {
          const saveOwned = this.checkpoints.saveOwned;
          if (!saveOwned) {
            throw new H2A2HRuntimeError(
              'interaction.checkpoint_fenced_save_unsupported',
              'Checkpoint store issued fenced Interaction ownership without supporting atomic owned checkpoint writes',
              context.interaction_id,
            );
          }
          const saved = await saveOwned.call(this.checkpoints, context, ownership!);
          if (!saved) {
            throw new H2A2HRuntimeError(
              'interaction.checkpoint_fenced',
              `Interaction ${context.interaction_id} lost canonical checkpoint ownership to a newer recovery fence`,
              context.interaction_id,
            );
          }
        } else {
          await this.checkpoints.save(context);
        }

        // Checkpoint persistence is the canonical state gate. Only after it
        // succeeds may the transition enter the durable audit chain.
        const sequence = context.transitions.length - 1;
        const previous = sequence > 0
          ? this.auditTrail.get(context.interaction_id, sequence - 1)
          : undefined;
        const record = createAuditRecord(
          auditInputFromTransition(transition, sequence, { intent: context.intent.ref }),
          previous,
        );
        const persisted = await this.auditStore.append(record);
        this.auditTrail.appendRecord(persisted.record);

        await bindings.onTransition?.(transition, context);
      },
    };
    this.runtime = new H2A2HRuntime(wrapped);
  }

  private async hydrateAudit(interactionId: string): Promise<void> {
    const records = await this.auditStore.load(interactionId);
    this.auditTrail.hydrate(records);
  }

  /**
   * Reconciles the durable audit chain against canonical checkpoint history.
   * This closes the crash window where the checkpoint commit succeeded but the
   * process died before its corresponding audit append completed.
   */
  private async reconcileAudit(
    context: InteractionContext<TInput, TResult>,
  ): Promise<void> {
    await this.hydrateAudit(context.interaction_id);
    const persistedCount = this.auditTrail.size(context.interaction_id);
    if (persistedCount > context.transitions.length) {
      throw new AuditTrailError(
        'audit.ahead_of_checkpoint',
        `Audit chain for ${context.interaction_id} contains more transitions than its canonical checkpoint`,
      );
    }

    for (let sequence = 0; sequence < context.transitions.length; sequence += 1) {
      const transition = context.transitions[sequence]!;
      const previous = sequence > 0
        ? this.auditTrail.get(context.interaction_id, sequence - 1)
        : undefined;
      const expected = createAuditRecord(
        auditInputFromTransition(transition, sequence, { intent: context.intent.ref }),
        previous,
      );
      const existing = this.auditTrail.get(context.interaction_id, sequence);
      if (existing) {
        if (existing.digest !== expected.digest) {
          throw new AuditTrailError(
            'audit.checkpoint_conflict',
            `Audit sequence ${sequence} does not match canonical checkpoint transition`,
          );
        }
        continue;
      }

      const persisted = await this.auditStore.append(expected);
      this.auditTrail.appendRecord(persisted.record);
    }
  }

  async run(request: RunRequest<TInput>): Promise<InteractionContext<TInput, TResult>> {
    const interactionId = request.interaction_id ?? `interaction:${randomUUID()}`;
    const correlationId = request.correlation_id ?? `correlation:${randomUUID()}`;
    await this.hydrateAudit(interactionId);

    const claimStart = this.checkpoints.claimStart;
    const releaseStart = this.checkpoints.releaseStart;
    if (!claimStart || !releaseStart) {
      throw new H2A2HRuntimeError(
        'interaction.start_claim_unsupported',
        'Checkpoint store must support atomic interaction start claiming',
        interactionId,
      );
    }

    const claim = await claimStart.call(this.checkpoints, interactionId);
    if (claim.status === 'exists') {
      throw new H2A2HRuntimeError(
        'interaction.already_exists',
        `Canonical H2A2H interaction ${interactionId} already exists`,
        interactionId,
      );
    }
    if (claim.status === 'conflict') {
      throw new H2A2HRuntimeError(
        'interaction.start_conflict',
        `Interaction ${interactionId} is already being created`,
        interactionId,
      );
    }

    const claimId = claim.lease.claim_id;
    const ownership: InteractionCheckpointOwnership = {
      kind: 'start',
      claim_id: claimId,
      ...(claim.lease.fence !== undefined ? { fence: claim.lease.fence } : {}),
    };
    let primaryError: unknown;
    try {
      if (this.auditTrail.size(interactionId) > 0) {
        throw new AuditTrailError(
          'audit.orphan_chain',
          `Audit records exist for ${interactionId} but no canonical checkpoint owns that interaction`,
        );
      }
      return await this.checkpointOwnership.run(
        ownership,
        () => this.runtime.run({
          ...request,
          interaction_id: interactionId,
          correlation_id: correlationId,
        }),
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const released = await releaseStart.call(this.checkpoints, interactionId, claimId);
      if (!released && primaryError === undefined) {
        throw new H2A2HRuntimeError(
          'interaction.start_release_failed',
          `Atomic interaction start claim could not be released for ${interactionId}`,
          interactionId,
        );
      }
    }
  }

  async resume(
    interactionId: string,
    request: ResumeRequest<TInput>,
  ): Promise<InteractionContext<TInput, TResult>> {
    const claimResume = this.checkpoints.claimResume;
    const releaseResume = this.checkpoints.releaseResume;
    if (!claimResume || !releaseResume) {
      throw new H2A2HRuntimeError(
        'interaction.resume_claim_unsupported',
        'Checkpoint store must support atomic Human resume claiming',
        interactionId,
      );
    }

    const claim = await claimResume.call(this.checkpoints, interactionId);
    if (claim.status === 'not_found') {
      throw new H2A2HRuntimeError(
        'interaction.checkpoint_not_found',
        `No canonical H2A2H checkpoint exists for ${interactionId}`,
        interactionId,
      );
    }
    if (claim.status === 'conflict') {
      throw new H2A2HRuntimeError(
        'interaction.resume_conflict',
        `Interaction ${interactionId} already has an active Human resume claim`,
        interactionId,
      );
    }

    const { lease_id: leaseId, context } = claim.lease;
    const ownership: InteractionCheckpointOwnership = {
      kind: 'resume',
      lease_id: leaseId,
      ...(claim.lease.fence !== undefined ? { fence: claim.lease.fence } : {}),
    };
    let primaryError: unknown;
    try {
      await this.reconcileAudit(context);
      return await this.checkpointOwnership.run(ownership, async () => {
        const hasReplacementInput = Object.prototype.hasOwnProperty.call(request, 'input');
        const resumeMetadata = hasReplacementInput
          ? {
              proposed_input: request.input,
              proposed_input_digest: sha256(request.input),
              ...(claim.lease.recovered ? { lease_recovered: true } : {}),
              ...(claim.lease.fence !== undefined ? { lease_fence: claim.lease.fence } : {}),
            }
          : {
              proposed_input_supplied: false,
              ...(claim.lease.recovered ? { lease_recovered: true } : {}),
              ...(claim.lease.fence !== undefined ? { lease_fence: claim.lease.fence } : {}),
            };
        const humanAction = {
          ...request.human_action,
          metadata: {
            ...(request.human_action.metadata ?? {}),
            h2a2h_resume: resumeMetadata,
          },
        };
        const canonicalRequest: ResumeRequest<TInput> = hasReplacementInput
          ? { human_action: humanAction, input: request.input as TInput }
          : { human_action: humanAction };

        return this.runtime.resume(context, canonicalRequest);
      });
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const released = await releaseResume.call(this.checkpoints, interactionId, leaseId);
      if (!released && primaryError === undefined) {
        throw new H2A2HRuntimeError(
          'interaction.resume_release_failed',
          `Atomic Human resume lease could not be released for ${interactionId}`,
          interactionId,
        );
      }
    }
  }

  async getInteraction(
    interactionId: string,
  ): Promise<InteractionContext<TInput, TResult> | undefined> {
    return this.checkpoints.load(interactionId);
  }

  async loadAudit(interactionId: string) {
    await this.hydrateAudit(interactionId);
    return this.auditTrail.export(interactionId);
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
      result_digest: { algorithm: 'sha-256', value: sha256(input.result) },
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

  getAudit(interactionId?: string) {
    return this.auditTrail.export(interactionId);
  }

  verifyAudit(interactionId?: string) {
    return this.auditTrail.verify(interactionId);
  }
}
