import { sha256 } from './security.js';
import type { EntityRef, IntentRef, MaybePromise } from './types.js';

export type ConstraintOperator = 'equals' | 'one_of' | 'max' | 'min' | 'contains' | 'exists';

export interface SemanticConstraint {
  canonical_label: string;
  path: string;
  operator: ConstraintOperator;
  value?: unknown;
  critical?: boolean;
}

export interface DelegationMandate {
  protocol: 'h2a2h.vaal';
  version: '1.0.0';
  type: 'delegation_mandate';
  mandate_id: string;
  principal: EntityRef;
  delegate: EntityRef;
  allowed_actions: string[];
  constraints: SemanticConstraint[];
  human_confirmation_required_for?: string[];
  issued_at: string;
  not_before?: string;
  expires_at: string;
  parent_mandate_hash?: string;
  proof_ref: string;
}

export interface ActionCommitmentInput {
  commitment_id: string;
  canonical_action: string;
  principal: EntityRef;
  agent: EntityRef;
  provider: EntityRef;
  target: Record<string, unknown>;
  parameters: Record<string, unknown>;
  intent: IntentRef;
  negotiated_capabilities_hash: string;
  state?: {
    before_hash: string;
    version?: string;
    proposed_after_hash?: string;
  };
  created_at: string;
}

export interface ActionCommitment extends ActionCommitmentInput {
  protocol: 'h2a2h.vaal';
  version: '1.0.0';
  type: 'action_commitment';
  request_hash: string;
}

export interface ActionMandate {
  protocol: 'h2a2h.vaal';
  version: '1.0.0';
  type: 'action_mandate';
  mandate_id: string;
  principal: EntityRef;
  agent: EntityRef;
  canonical_action: string;
  delegation_mandate_hash: string;
  action_commitment_hash: string;
  audience: string[];
  nonce: string;
  issued_at: string;
  expires_at: string;
  max_uses: number;
  proof_ref: string;
}

export type AuthorizationDecision =
  | { decision: 'ALLOW'; evidence: string[] }
  | { decision: 'DENY'; code: string; reason: string; evidence: string[] }
  | {
      decision: 'CHALLENGE';
      code: string;
      reason: string;
      evidence: string[];
      challenge: { canonical_label: string; action_commitment_hash: string };
    };

export interface AuthorizationBindings {
  verifyDelegationProof(mandate: DelegationMandate): MaybePromise<boolean>;
  verifyActionProof(mandate: ActionMandate): MaybePromise<boolean>;
  consume?(mandateId: string, nonce: string, maxUses: number): MaybePromise<boolean>;
}

export interface VerifyAuthorizationRequest {
  delegation: DelegationMandate;
  mandate: ActionMandate;
  commitment: ActionCommitment;
  bindings: AuthorizationBindings;
  now?: Date;
}

function entityMatches(left: EntityRef, right: EntityRef): boolean {
  return left.entity_id === right.entity_id && left.kind === right.kind;
}

function validInstant(value: string): number | undefined {
  const parsed = new Date(value);
  const epoch = parsed.getTime();
  return Number.isFinite(epoch) ? epoch : undefined;
}

function getPath(root: unknown, path: string): { exists: boolean; value: unknown } {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return { exists: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return { exists: false, value: undefined };
    current = (current as Record<string, unknown>)[segment];
  }
  return { exists: true, value: current };
}

function primitiveComparable(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function constraintSatisfied(constraint: SemanticConstraint, commitment: ActionCommitment): boolean {
  const resolved = getPath(commitment, constraint.path);
  switch (constraint.operator) {
    case 'exists':
      return constraint.value === false ? !resolved.exists : resolved.exists;
    case 'equals':
      return resolved.exists && sha256(resolved.value) === sha256(constraint.value);
    case 'one_of':
      return resolved.exists
        && Array.isArray(constraint.value)
        && constraint.value.some((candidate) => sha256(candidate) === sha256(resolved.value));
    case 'max':
      return resolved.exists
        && primitiveComparable(resolved.value)
        && primitiveComparable(constraint.value)
        && resolved.value <= constraint.value;
    case 'min':
      return resolved.exists
        && primitiveComparable(resolved.value)
        && primitiveComparable(constraint.value)
        && resolved.value >= constraint.value;
    case 'contains':
      return resolved.exists
        && Array.isArray(resolved.value)
        && resolved.value.some((candidate) => sha256(candidate) === sha256(constraint.value));
    default:
      return false;
  }
}

function deny(code: string, reason: string, evidence: string[]): AuthorizationDecision {
  return { decision: 'DENY', code, reason, evidence };
}

export function createActionCommitment(input: ActionCommitmentInput): ActionCommitment {
  const bindingPayload = {
    canonical_action: input.canonical_action,
    principal: input.principal,
    agent: input.agent,
    provider: input.provider,
    target: input.target,
    parameters: input.parameters,
    intent: input.intent,
    negotiated_capabilities_hash: input.negotiated_capabilities_hash,
    ...(input.state ? { state: input.state } : {}),
  };
  return {
    protocol: 'h2a2h.vaal',
    version: '1.0.0',
    type: 'action_commitment',
    ...input,
    request_hash: sha256(bindingPayload),
  };
}

export function actionCommitmentHash(commitment: ActionCommitment): string {
  return sha256(commitment);
}

export function delegationMandateHash(mandate: DelegationMandate): string {
  return sha256(mandate);
}

export async function verifyActionAuthorization(
  request: VerifyAuthorizationRequest,
): Promise<AuthorizationDecision> {
  const { delegation, mandate, commitment, bindings } = request;
  const evidence: string[] = [];
  const now = request.now ?? new Date();
  const nowEpoch = now.getTime();
  if (!Number.isFinite(nowEpoch)) return deny('vaal.time.invalid', 'Verification time is invalid', evidence);

  const delegationIssued = validInstant(delegation.issued_at);
  const delegationNotBefore = delegation.not_before ? validInstant(delegation.not_before) : delegationIssued;
  const delegationExpires = validInstant(delegation.expires_at);
  const actionIssued = validInstant(mandate.issued_at);
  const actionExpires = validInstant(mandate.expires_at);
  if (
    delegationIssued === undefined
    || delegationNotBefore === undefined
    || delegationExpires === undefined
    || actionIssued === undefined
    || actionExpires === undefined
  ) return deny('vaal.time.malformed', 'Mandate timestamps are malformed', evidence);
  if (nowEpoch < delegationNotBefore || nowEpoch > delegationExpires) {
    return deny('vaal.delegation.expired', 'Delegation is outside its validity window', evidence);
  }
  if (nowEpoch < actionIssued || nowEpoch > actionExpires) {
    return deny('vaal.action.expired', 'Action mandate is outside its validity window', evidence);
  }
  if (actionExpires > delegationExpires) {
    return deny('vaal.attenuation.temporal', 'Action mandate outlives its delegation', evidence);
  }
  evidence.push('vaal.time.valid');

  if (!entityMatches(delegation.principal, mandate.principal) || !entityMatches(mandate.principal, commitment.principal)) {
    return deny('vaal.principal.mismatch', 'Principal identity changed across the authorization chain', evidence);
  }
  if (!entityMatches(delegation.delegate, mandate.agent) || !entityMatches(mandate.agent, commitment.agent)) {
    return deny('vaal.agent.mismatch', 'Agent identity changed across the authorization chain', evidence);
  }
  if (mandate.canonical_action !== commitment.canonical_action) {
    return deny('vaal.action.commitment_mismatch', 'Mandate action does not match ActionCommitment', evidence);
  }
  if (!delegation.allowed_actions.includes(mandate.canonical_action)) {
    return deny('vaal.attenuation.action', 'Action is outside delegated authority', evidence);
  }
  if (!mandate.audience.includes(commitment.provider.entity_id)) {
    return deny('vaal.audience.mismatch', 'Action provider is outside mandate audience', evidence);
  }
  evidence.push('vaal.identity.valid', 'vaal.action.valid', 'vaal.audience.valid');

  if (mandate.delegation_mandate_hash !== delegationMandateHash(delegation)) {
    return deny('vaal.delegation.hash_mismatch', 'Action mandate is not bound to the supplied delegation', evidence);
  }
  if (mandate.action_commitment_hash !== actionCommitmentHash(commitment)) {
    return deny('vaal.commitment.hash_mismatch', 'Action mandate is not bound to the supplied ActionCommitment', evidence);
  }
  const recomputedCommitment = createActionCommitment({
    commitment_id: commitment.commitment_id,
    canonical_action: commitment.canonical_action,
    principal: commitment.principal,
    agent: commitment.agent,
    provider: commitment.provider,
    target: commitment.target,
    parameters: commitment.parameters,
    intent: commitment.intent,
    negotiated_capabilities_hash: commitment.negotiated_capabilities_hash,
    ...(commitment.state ? { state: commitment.state } : {}),
    created_at: commitment.created_at,
  });
  if (recomputedCommitment.request_hash !== commitment.request_hash) {
    return deny('vaal.commitment.request_hash_mismatch', 'ActionCommitment semantics were modified after binding', evidence);
  }
  evidence.push('vaal.binding.valid');

  if (!(await bindings.verifyDelegationProof(delegation))) {
    return deny('vaal.delegation.proof_invalid', 'Delegation proof is invalid', evidence);
  }
  if (!(await bindings.verifyActionProof(mandate))) {
    return deny('vaal.action.proof_invalid', 'Action mandate proof is invalid', evidence);
  }
  evidence.push('vaal.proofs.valid');

  for (const constraint of delegation.constraints) {
    if (!constraintSatisfied(constraint, commitment)) {
      return deny(
        'vaal.constraint.failed',
        `Constraint ${constraint.canonical_label} was not satisfied`,
        [...evidence, `constraint:${constraint.canonical_label}`],
      );
    }
  }
  evidence.push('vaal.constraints.valid');

  if (delegation.human_confirmation_required_for?.includes(mandate.canonical_action)) {
    return {
      decision: 'CHALLENGE',
      code: 'vaal.human_confirmation.required',
      reason: 'This Action requires explicit Human authorization',
      evidence,
      challenge: {
        canonical_label: 'authorization.human.confirm',
        action_commitment_hash: actionCommitmentHash(commitment),
      },
    };
  }

  if (!Number.isInteger(mandate.max_uses) || mandate.max_uses < 1) {
    return deny('vaal.replay.max_uses_invalid', 'max_uses must be a positive integer', evidence);
  }
  if (!bindings.consume) {
    return {
      decision: 'CHALLENGE',
      code: 'vaal.replay.store_required',
      reason: 'A durable replay-consumption boundary is required before execution',
      evidence,
      challenge: {
        canonical_label: 'authorization.replay.consume',
        action_commitment_hash: actionCommitmentHash(commitment),
      },
    };
  }
  if (!(await bindings.consume(mandate.mandate_id, mandate.nonce, mandate.max_uses))) {
    return deny('vaal.replay.detected', 'Action mandate has already exhausted its allowed uses', evidence);
  }
  evidence.push('vaal.replay.accepted');

  return { decision: 'ALLOW', evidence };
}

export interface ActionReceiptInput {
  receipt_id: string;
  verifier: EntityRef;
  executor: EntityRef;
  principal: EntityRef;
  agent: EntityRef;
  canonical_action: string;
  mandate_hash: string;
  action_commitment_hash: string;
  executed_at: string;
  result: 'success' | 'failure';
  result_hash: string;
  state?: { before_hash?: string; after_hash?: string };
}

export interface ActionReceipt extends ActionReceiptInput {
  protocol: 'h2a2h.vaal';
  version: '1.0.0';
  type: 'action_receipt';
  receipt_hash: string;
}

export function createActionReceipt(input: ActionReceiptInput): ActionReceipt {
  const payload = {
    ...input,
    ...(input.state ? { state: input.state } : {}),
  };
  return {
    protocol: 'h2a2h.vaal',
    version: '1.0.0',
    type: 'action_receipt',
    ...input,
    receipt_hash: sha256(payload),
  };
}
