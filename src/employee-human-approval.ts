import {
  EmployeeAgentPolicyError,
  type EmployeeToolCallContext,
} from './employee-agent.js';
import type { MaybePromise } from './types.js';

export interface EmployeeHumanApprovalEvidenceBinding {
  evidence_ref: string;
  approved_by: string;
  employee_canonical_label: string;
  intent_canonical_label: string;
  tool_canonical_label: string;
  delegation_ref: string;
  correlation_id: string;
  interaction_id: string;
  risk_triggers: string[];
}

export interface EmployeeHumanApprovalGuardOptions {
  resolveRequiredTriggers(context: EmployeeToolCallContext): MaybePromise<string[]>;
  verifyEvidence(binding: EmployeeHumanApprovalEvidenceBinding): MaybePromise<boolean>;
}

function policyError(code: string, message: string): never {
  throw new EmployeeAgentPolicyError(code, message);
}

/**
 * Creates a governance hook that validates Human approval evidence before a
 * side-effecting provider call. Approval requirement discovery and evidence
 * verification stay injected so policy/identity systems remain external to the
 * Employee role runtime and no hidden role-specific authority is introduced.
 */
export function createEmployeeHumanApprovalGuard(
  options: EmployeeHumanApprovalGuardOptions,
): (context: EmployeeToolCallContext) => Promise<void> {
  return async (context) => {
    const tool = context.employee.contract.tools.find(
      (candidate) => candidate.name === context.operation.tool && candidate.permission === 'allow',
    );
    if (!tool?.side_effect) return;

    const requiredTriggers = [...new Set(await options.resolveRequiredTriggers(context))];
    if (requiredTriggers.length === 0) return;

    const declaredTriggers = new Set(context.employee.contract.risk.human_approval_required_for);
    for (const trigger of requiredTriggers) {
      if (!declaredTriggers.has(trigger)) {
        policyError(
          'human.approval.trigger_not_declared',
          `Approval trigger ${trigger} is not declared by ${context.employee.contract.identity.canonical_label}`,
        );
      }
    }

    const claim = context.interaction.input.human_approval;
    if (claim?.granted !== true) {
      policyError('human.approval_required', `Human approval required for: ${requiredTriggers.join(', ')}`);
    }
    if (!claim.evidence_ref || !claim.approved_by) {
      policyError(
        'human.approval.evidence_missing',
        'Human approval must include approved_by and evidence_ref',
      );
    }
    const delegationRef = context.interaction.input.delegation_ref;
    if (!delegationRef) {
      policyError('human.approval.delegation_missing', 'Human approval cannot be validated without delegation_ref');
    }

    const binding: EmployeeHumanApprovalEvidenceBinding = {
      evidence_ref: claim.evidence_ref,
      approved_by: claim.approved_by,
      employee_canonical_label: context.employee.contract.identity.canonical_label,
      intent_canonical_label: context.interaction.intent.ref.canonical_label,
      tool_canonical_label: context.operation.tool,
      delegation_ref: delegationRef,
      correlation_id: context.interaction.correlation_id,
      interaction_id: context.interaction.interaction_id,
      risk_triggers: requiredTriggers,
    };

    if (!await options.verifyEvidence(binding)) {
      policyError(
        'human.approval.evidence_invalid',
        `Human approval evidence ${claim.evidence_ref} is not valid for this delegated action`,
      );
    }
  };
}
