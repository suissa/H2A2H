import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { humanEscalationRequired, isHumanEscalationRequired } from './runtime.js';
import type {
  ChannelBinding,
  DelegationValidation,
  HumanEscalationRequired,
  HumanReturnResult,
  InteractionContext,
  MaybePromise,
  ParticipantResolution,
  RuntimeBindings,
  TransitionRecord,
} from './types.js';

export interface A2AAgentInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
}

export interface A2AAgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface A2AAgentCard {
  name: string;
  description?: string;
  supportedInterfaces: A2AAgentInterface[];
  version: string;
  skills: A2AAgentSkill[];
  capabilities?: Record<string, unknown>;
  [key: string]: unknown;
}

export type EmployeeIntentEffect = 'read-only' | 'draft' | 'side-effect' | 'return-to-human';
export type EmployeePoHRRequirement = 'optional' | 'required';

export interface EmployeeIntentDefinition {
  canonical_label: string;
  effect: EmployeeIntentEffect;
  pohr: EmployeePoHRRequirement;
}

export interface EmployeeToolDefinition {
  name: string;
  permission: 'allow' | 'required' | 'required-on-human-return' | 'required-on-uncertainty' | string;
  side_effect: boolean;
}

export interface EmployeeAgentContract {
  identity: {
    canonical_label: string;
    human_role: string;
    department: string;
    entity_kind: 'Agent';
    a2a_agent_card: string;
    identity_model: string;
  };
  purpose: string;
  responsibilities: string[];
  authority: {
    accountable_human_role: string;
    delegation_required: boolean;
    default_session_ttl: string;
    maximum_session_ttl: string;
    scope: string[];
    self_extension_forbidden: boolean;
    self_approval_forbidden: boolean;
  };
  intents: EmployeeIntentDefinition[];
  tools: EmployeeToolDefinition[];
  systems_of_record: string[];
  inputs: { required: string[]; optional?: string[] };
  outputs: { required: string[]; human_boundary?: string[] };
  events: Record<string, string>;
  risk: {
    class: string;
    human_approval_required_for: string[];
    deny: string[];
  };
  channels: Record<string, string>;
  proof_of_human_return: {
    required_for: string[];
    minimum_evidence: string[];
    acknowledgement_required_when: string[];
  };
  memory: Record<string, unknown>;
  security: Record<string, unknown>;
  observability: string[];
  acceptance_tests: string[];
}

export interface EmployeeAgentDefinition {
  directory: string;
  agentCard: A2AAgentCard;
  contract: EmployeeAgentContract;
}

export interface EmployeeToolOperation {
  tool: string;
  input?: unknown;
  /**
   * @deprecated Informational compatibility field only. Human approval
   * requirements are resolved by EmployeeAgentRuntimeOptions.humanApproval and
   * this value never grants, suppresses or creates authority.
   */
  risk_triggers?: string[];
}

export interface EmployeeAgentInput {
  delegation_ref?: string;
  request_payload: unknown;
  operations?: EmployeeToolOperation[];
  human_approval?: {
    granted: boolean;
    approved_by?: string;
    evidence_ref?: string;
  };
}

export interface EmployeeValidatedHumanApproval {
  evidence_ref: string;
  approved_by: string;
  risk_triggers: string[];
}

export interface EmployeeToolCallContext {
  employee: EmployeeAgentDefinition;
  interaction: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>;
  operation: EmployeeToolOperation;
  validated_human_approval?: EmployeeValidatedHumanApproval;
}

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

export interface EmployeeHumanApprovalGovernance {
  resolveRequiredTriggers(context: EmployeeToolCallContext): MaybePromise<string[]>;
  verifyEvidence(binding: EmployeeHumanApprovalEvidenceBinding): MaybePromise<boolean>;
}

export type EmployeeToolExecutor = (
  input: unknown,
  context: EmployeeToolCallContext,
) => MaybePromise<unknown>;

export interface EmployeeAgentOutput {
  status: 'Ok';
  result_or_artifact: unknown;
  provenance: string[];
  audit_ref: string;
  tool_results: Array<{ tool: string; result: unknown }>;
}

export interface EmployeeAgentRuntimeOptions {
  toolExecutors: Record<string, EmployeeToolExecutor>;
  humanApproval: EmployeeHumanApprovalGovernance;
  validateDelegation(
    context: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>,
    employee: EmployeeAgentDefinition,
  ): MaybePromise<DelegationValidation>;
  resolveParticipants(
    context: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>,
    employee: EmployeeAgentDefinition,
  ): MaybePromise<ParticipantResolution>;
  resolveChannel(
    context: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>,
    employee: EmployeeAgentDefinition,
  ): MaybePromise<ChannelBinding>;
  returnToHuman(
    context: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>,
    employee: EmployeeAgentDefinition,
  ): MaybePromise<HumanReturnResult>;
  onTransition?(
    transition: TransitionRecord,
    context: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>,
  ): MaybePromise<void>;
  onToolCall?(context: EmployeeToolCallContext): MaybePromise<void>;
}

export class EmployeeAgentContractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EmployeeAgentContractError';
  }
}

export class EmployeeAgentPolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EmployeeAgentPolicyError';
  }
}

function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EmployeeAgentContractError(code, message);
}

function policyAssert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EmployeeAgentPolicyError(code, message);
}

function unique(values: string[], code: string): void {
  assert(new Set(values).size === values.length, code, `${code}: values must be unique`);
}

export function validateEmployeeAgentDefinition(definition: EmployeeAgentDefinition): EmployeeAgentDefinition {
  const { agentCard, contract } = definition;
  assert(agentCard && typeof agentCard === 'object', 'agent_card.invalid', 'Agent Card must be an object');
  assert(typeof agentCard.name === 'string' && agentCard.name.length > 0, 'agent_card.name', 'Agent Card name is required');
  assert(Array.isArray(agentCard.supportedInterfaces) && agentCard.supportedInterfaces.length > 0, 'agent_card.interfaces', 'Agent Card must declare supportedInterfaces');
  for (const entry of agentCard.supportedInterfaces) {
    assert(typeof entry.url === 'string' && entry.url.length > 0, 'agent_card.interface.url', 'A2A interface url is required');
    assert(typeof entry.protocolBinding === 'string' && entry.protocolBinding.length > 0, 'agent_card.interface.binding', 'A2A interface protocolBinding is required');
    assert(typeof entry.protocolVersion === 'string' && entry.protocolVersion.length > 0, 'agent_card.interface.version', 'A2A interface protocolVersion is required');
  }
  assert(Array.isArray(agentCard.skills) && agentCard.skills.length > 0, 'agent_card.skills', 'Agent Card must advertise at least one skill');
  unique(agentCard.skills.map((skill) => skill.id), 'agent_card.skill_ids');

  assert(contract?.identity?.entity_kind === 'Agent', 'employee.identity.kind', 'Employee contract entity_kind must be Agent');
  assert(contract.identity.canonical_label.startsWith('Enterprise.Employee.'), 'employee.identity.canonical_label', 'Employee canonical_label must use Enterprise.Employee.*');
  assert(contract.authority?.delegation_required === true, 'employee.authority.delegation', 'Employee Agent must require explicit delegation');
  assert(contract.authority.self_extension_forbidden === true, 'employee.authority.self_extension', 'Employee Agent cannot extend its own delegation');
  assert(contract.authority.self_approval_forbidden === true, 'employee.authority.self_approval', 'Employee Agent cannot approve itself');
  assert(Array.isArray(contract.intents) && contract.intents.length > 0, 'employee.intents', 'Employee Agent must declare Intents');
  assert(Array.isArray(contract.tools) && contract.tools.length > 0, 'employee.tools', 'Employee Agent must declare tools');
  unique(contract.intents.map((intent) => intent.canonical_label), 'employee.intent_labels');
  unique(contract.tools.map((tool) => tool.name), 'employee.tool_names');
  for (const intent of contract.intents) {
    assert(intent.canonical_label.startsWith(`${contract.identity.canonical_label}.`), 'employee.intent.namespace', `Intent ${intent.canonical_label} is outside the employee namespace`);
  }
  return definition;
}

export async function loadEmployeeAgent(directory: string): Promise<EmployeeAgentDefinition> {
  const absolute = resolve(directory);
  const contractRaw = await readFile(resolve(absolute, 'h2a2h.employee.yml'), 'utf8');
  const parsed = parseYaml(contractRaw) as { employee_agent?: EmployeeAgentContract };
  assert(parsed?.employee_agent, 'employee.contract.root', 'h2a2h.employee.yml must contain employee_agent');

  const cardPath = parsed.employee_agent.identity?.a2a_agent_card ?? './agent-card.json';
  const agentCard = JSON.parse(await readFile(resolve(absolute, cardPath), 'utf8')) as A2AAgentCard;
  return validateEmployeeAgentDefinition({ directory: absolute, agentCard, contract: parsed.employee_agent });
}

export function businessTools(employee: EmployeeAgentDefinition): EmployeeToolDefinition[] {
  return employee.contract.tools.filter((tool) => tool.permission === 'allow');
}

export function assertBusinessToolCoverage(
  employee: EmployeeAgentDefinition,
  executors: Record<string, EmployeeToolExecutor>,
): void {
  const missing = businessTools(employee)
    .map((tool) => tool.name)
    .filter((name) => typeof executors[name] !== 'function');
  assert(missing.length === 0, 'employee.tools.unbound', `Missing tool executors: ${missing.join(', ')}`);
}

export class EmployeeAgentRuntime {
  constructor(
    readonly employee: EmployeeAgentDefinition,
    private readonly options: EmployeeAgentRuntimeOptions,
  ) {
    validateEmployeeAgentDefinition(employee);
    assertBusinessToolCoverage(employee, options.toolExecutors);
    assert(
      typeof options.humanApproval?.resolveRequiredTriggers === 'function' &&
      typeof options.humanApproval?.verifyEvidence === 'function',
      'employee.human_approval.governance_missing',
      'Employee Agent runtime requires Human approval governance',
    );
  }

  bindings(): RuntimeBindings<EmployeeAgentInput, EmployeeAgentOutput> {
    return {
      resolveIntent: async (canonicalLabel) => {
        const intent = this.employee.contract.intents.find((candidate) => candidate.canonical_label === canonicalLabel);
        if (!intent) {
          throw new EmployeeAgentPolicyError('employee.intent.not_declared', `Intent ${canonicalLabel} is not declared for ${this.employee.contract.identity.canonical_label}`);
        }
        return {
          ref: { canonical_label: canonicalLabel, version: this.employee.agentCard.version },
          input_schema: 'h2a2h://employee-agent/input/v1',
          output_schema: 'h2a2h://employee-agent/output/v1',
          metadata: { effect: intent.effect, pohr: intent.pohr },
        };
      },
      validateDelegation: async (context) => {
        if (this.employee.contract.authority.delegation_required && !context.input.delegation_ref) {
          return { valid: false, reason: 'delegation.missing' };
        }
        return this.options.validateDelegation(context, this.employee);
      },
      resolveParticipants: (context) => this.options.resolveParticipants(context, this.employee),
      resolveChannel: (context) => this.options.resolveChannel(context, this.employee),
      execute: (context) => this.execute(context),
      returnToHuman: (context) => this.options.returnToHuman(context, this.employee),
      ...(this.options.onTransition ? { onTransition: this.options.onTransition } : {}),
    };
  }

  private approvalEscalation(
    context: EmployeeToolCallContext,
    requiredTriggers: string[],
    code: string,
    reason: string,
    actionCanonicalLabel: string,
  ): HumanEscalationRequired {
    const claim = context.interaction.input.human_approval;
    return humanEscalationRequired({
      code,
      reason,
      evidence: [],
      resume_state: 'EXECUTING',
      human_action: {
        canonical_label: actionCanonicalLabel,
        metadata: {
          employee_canonical_label: this.employee.contract.identity.canonical_label,
          intent_canonical_label: context.interaction.intent.ref.canonical_label,
          tool_canonical_label: context.operation.tool,
          risk_triggers: [...requiredTriggers],
          ...(claim?.evidence_ref ? { submitted_evidence_ref: claim.evidence_ref } : {}),
        },
      },
    });
  }

  private async governToolCall(
    context: EmployeeToolCallContext,
    sideEffect: boolean,
  ): Promise<EmployeeToolCallContext | HumanEscalationRequired> {
    if (!sideEffect) return context;

    const requiredTriggers = [...new Set(await this.options.humanApproval.resolveRequiredTriggers(context))];
    const declaredTriggers = new Set(this.employee.contract.risk.human_approval_required_for);
    for (const trigger of requiredTriggers) {
      policyAssert(
        declaredTriggers.has(trigger),
        'human.approval.trigger_not_declared',
        `Approval trigger ${trigger} is not declared by ${this.employee.contract.identity.canonical_label}`,
      );
    }
    if (requiredTriggers.length === 0) return context;

    const claim = context.interaction.input.human_approval;
    if (claim?.granted !== true) {
      return this.approvalEscalation(
        context,
        requiredTriggers,
        'human.approval_required',
        `Human approval required for: ${requiredTriggers.join(', ')}`,
        'Human.Approval.Provide',
      );
    }
    if (
      typeof claim.approved_by !== 'string' || claim.approved_by.length === 0 ||
      typeof claim.evidence_ref !== 'string' || claim.evidence_ref.length === 0
    ) {
      return this.approvalEscalation(
        context,
        requiredTriggers,
        'human.approval.evidence_missing',
        'Human approval must include approved_by and evidence_ref',
        'Human.Approval.ProvideEvidence',
      );
    }

    const delegationRef = context.interaction.input.delegation_ref;
    if (typeof delegationRef !== 'string' || delegationRef.length === 0) {
      return this.approvalEscalation(
        context,
        requiredTriggers,
        'human.approval.delegation_missing',
        'Human approval cannot be validated without delegation_ref',
        'Human.Delegation.Provide',
      );
    }

    const binding: EmployeeHumanApprovalEvidenceBinding = {
      evidence_ref: claim.evidence_ref,
      approved_by: claim.approved_by,
      employee_canonical_label: this.employee.contract.identity.canonical_label,
      intent_canonical_label: context.interaction.intent.ref.canonical_label,
      tool_canonical_label: context.operation.tool,
      delegation_ref: delegationRef,
      correlation_id: context.interaction.correlation_id,
      interaction_id: context.interaction.interaction_id,
      risk_triggers: requiredTriggers,
    };
    if (!await this.options.humanApproval.verifyEvidence(binding)) {
      return this.approvalEscalation(
        context,
        requiredTriggers,
        'human.approval.evidence_invalid',
        `Human approval evidence ${claim.evidence_ref} is not valid for this delegated action`,
        'Human.Approval.Reissue',
      );
    }

    return {
      ...context,
      validated_human_approval: {
        evidence_ref: binding.evidence_ref,
        approved_by: binding.approved_by,
        risk_triggers: [...binding.risk_triggers],
      },
    };
  }

  private async execute(
    context: InteractionContext<EmployeeAgentInput, EmployeeAgentOutput>,
  ): Promise<EmployeeAgentOutput | HumanEscalationRequired> {
    const declaredIntent = this.employee.contract.intents.find((intent) => intent.canonical_label === context.intent.ref.canonical_label);
    if (!declaredIntent) {
      throw new EmployeeAgentPolicyError('employee.intent.not_declared', 'Resolved Intent is not declared by the employee contract');
    }

    const operations = context.input.operations ?? [];
    const toolResults: Array<{ tool: string; result: unknown }> = [];
    for (const operation of operations) {
      const tool = this.employee.contract.tools.find((candidate) => candidate.name === operation.tool && candidate.permission === 'allow');
      if (!tool) {
        throw new EmployeeAgentPolicyError('employee.tool.not_allowed', `Tool ${operation.tool} is not allowed for this employee`);
      }
      const executor = this.options.toolExecutors[tool.name];
      if (!executor) {
        throw new EmployeeAgentContractError('employee.tool.unbound', `Tool ${tool.name} has no executor`);
      }

      const rawCallContext: EmployeeToolCallContext = {
        employee: this.employee,
        interaction: context,
        operation,
      };
      const callContext = await this.governToolCall(rawCallContext, tool.side_effect);
      if (isHumanEscalationRequired(callContext)) return callContext;

      await this.options.onToolCall?.(callContext);
      toolResults.push({ tool: tool.name, result: await executor(operation.input, callContext) });
    }

    return {
      status: 'Ok',
      result_or_artifact: operations.length === 0 ? context.input.request_payload : toolResults.map((item) => item.result),
      provenance: [this.employee.contract.identity.canonical_label, declaredIntent.canonical_label],
      audit_ref: `audit:${context.interaction_id}`,
      tool_results: toolResults,
    };
  }
}
