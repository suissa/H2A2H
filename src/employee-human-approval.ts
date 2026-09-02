import type {
  EmployeeHumanApprovalEvidenceBinding,
  EmployeeHumanApprovalGovernance,
  EmployeeToolCallContext,
} from './employee-agent.js';
import type { MaybePromise } from './types.js';

export interface EmployeeHumanApprovalGovernanceOptions {
  resolveRequiredTriggers(context: EmployeeToolCallContext): MaybePromise<string[]>;
  verifyEvidence(binding: EmployeeHumanApprovalEvidenceBinding): MaybePromise<boolean>;
}

/**
 * Creates the mandatory Human-approval governance dependency consumed directly
 * by EmployeeAgentRuntime. Requirement resolution and evidence verification are
 * injected so enterprise policy/identity systems remain external to role code.
 */
export function createEmployeeHumanApprovalGovernance(
  options: EmployeeHumanApprovalGovernanceOptions,
): EmployeeHumanApprovalGovernance {
  return {
    resolveRequiredTriggers: options.resolveRequiredTriggers,
    verifyEvidence: options.verifyEvidence,
  };
}

export type { EmployeeHumanApprovalEvidenceBinding } from './employee-agent.js';
