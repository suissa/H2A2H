import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  EmployeeAgentDefinition,
  EmployeeToolCallContext,
  EmployeeToolExecutor,
} from './employee-agent.js';
import type { MaybePromise } from './types.js';

export type EmployeeToolProviderKind =
  | 'in-memory'
  | 'http-json'
  | 'mcp'
  | 'injected'
  | 'internal';

export type EmployeeToolEffect = 'read-only' | 'side-effect' | 'protocol-control';

export interface EmployeeToolCapability {
  canonical_label: string;
  domain: string;
  employee_departments: string[];
  operation: string;
  effect: EmployeeToolEffect;
  side_effect: boolean;
  delegation_required: boolean;
  human_approval: 'none' | 'employee-policy' | 'protocol-defined';
  input_schema: string;
  output_schema: string;
  provider_required: boolean;
  provider_bindings: EmployeeToolProviderKind[];
  events: { success: 'Ok'; failure: 'Error' };
}

interface RawDepartmentCapabilities {
  tools: string[];
  side_effects: string[];
}

interface RawEmployeeToolCatalog {
  protocol: 'h2a2h.employee-tools';
  version: string;
  defaults: {
    delegation_required: boolean;
    provider_required: boolean;
    provider_bindings: EmployeeToolProviderKind[];
    events: { success: 'Ok'; failure: 'Error' };
  };
  departments: Record<string, RawDepartmentCapabilities>;
  internal: Array<{
    canonical_label: string;
    side_effect: boolean;
    delegation_required: boolean;
  }>;
}

export interface ToolProviderInvocationContext {
  employee_canonical_label: string;
  intent_canonical_label: string;
  interaction_id: string;
  correlation_id: string;
  delegation_ref?: string;
  approval_evidence_ref?: string;
  operation: EmployeeToolCallContext['operation'];
  operation_index: number;
  input_digest: string;
  execution_id: string;
  idempotency_key: string;
}

export interface EmployeeToolProvider {
  readonly id: string;
  readonly kind: EmployeeToolProviderKind;
  invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): MaybePromise<unknown>;
}

export interface EmployeeToolResolver {
  assertEmployeeReady(employee: EmployeeAgentDefinition): void;
  resolveExecutor(canonicalLabel: string): EmployeeToolExecutor;
}

export class EmployeeToolCapabilityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EmployeeToolCapabilityError';
  }
}

function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EmployeeToolCapabilityError(code, message);
}

function schemaId(label: string, direction: 'input' | 'output'): string {
  return `h2a2h://capabilities/${label}/${direction}/v1`;
}

function normalize(raw: RawEmployeeToolCatalog): EmployeeToolCapability[] {
  ensure(raw.protocol === 'h2a2h.employee-tools', 'tool.catalog.protocol', 'Invalid Employee Tool catalog protocol');
  ensure(typeof raw.version === 'string' && raw.version.length > 0, 'tool.catalog.version', 'Employee Tool catalog version is required');

  const capabilities: EmployeeToolCapability[] = [];
  for (const [department, definition] of Object.entries(raw.departments)) {
    ensure(Array.isArray(definition.tools), 'tool.catalog.tools', `Department ${department} must declare tools`);
    const sideEffects = new Set(definition.side_effects ?? []);
    for (const label of definition.tools) {
      const parts = label.split('.');
      ensure(parts.length >= 2, 'tool.canonical_label', `Tool ${label} is not a semantic dotted identity`);
      const sideEffect = sideEffects.has(label);
      capabilities.push({
        canonical_label: label,
        domain: parts[0]!,
        employee_departments: [department],
        operation: parts.at(-1)!,
        effect: sideEffect ? 'side-effect' : 'read-only',
        side_effect: sideEffect,
        delegation_required: raw.defaults.delegation_required,
        human_approval: sideEffect ? 'employee-policy' : 'none',
        input_schema: schemaId(label, 'input'),
        output_schema: schemaId(label, 'output'),
        provider_required: raw.defaults.provider_required,
        provider_bindings: [...raw.defaults.provider_bindings],
        events: { ...raw.defaults.events },
      });
    }
  }

  for (const internal of raw.internal) {
    const parts = internal.canonical_label.split('.');
    capabilities.push({
      canonical_label: internal.canonical_label,
      domain: parts[0]!,
      employee_departments: ['*'],
      operation: parts.at(-1)!,
      effect: 'protocol-control',
      side_effect: internal.side_effect,
      delegation_required: internal.delegation_required,
      human_approval: 'protocol-defined',
      input_schema: schemaId(internal.canonical_label, 'input'),
      output_schema: schemaId(internal.canonical_label, 'output'),
      provider_required: false,
      provider_bindings: ['internal'],
      events: { success: 'Ok', failure: 'Error' },
    });
  }

  return capabilities;
}

export class EmployeeToolRegistry implements EmployeeToolResolver {
  private readonly capabilities = new Map<string, EmployeeToolCapability>();
  private readonly providers = new Map<string, EmployeeToolProvider>();

  constructor(capabilities: EmployeeToolCapability[]) {
    for (const capability of capabilities) {
      ensure(!this.capabilities.has(capability.canonical_label), 'tool.catalog.duplicate', `Duplicate capability ${capability.canonical_label}`);
      this.capabilities.set(capability.canonical_label, capability);
    }
  }

  static async load(path = 'capabilities/employee-tools/catalog.json'): Promise<EmployeeToolRegistry> {
    const raw = JSON.parse(await readFile(resolve(path), 'utf8')) as RawEmployeeToolCatalog;
    return new EmployeeToolRegistry(normalize(raw));
  }

  list(): EmployeeToolCapability[] {
    return [...this.capabilities.values()];
  }

  listByDomain(domain: string): EmployeeToolCapability[] {
    return this.list().filter((capability) => capability.domain === domain);
  }

  get(canonicalLabel: string): EmployeeToolCapability {
    const capability = this.capabilities.get(canonicalLabel);
    ensure(capability, 'tool.capability.not_found', `Unknown Employee Tool capability ${canonicalLabel}`);
    return capability;
  }

  bind(canonicalLabel: string, provider: EmployeeToolProvider): this {
    const capability = this.get(canonicalLabel);
    ensure(
      capability.provider_bindings.includes(provider.kind),
      'tool.provider.kind_not_allowed',
      `Provider kind ${provider.kind} is not allowed for ${canonicalLabel}`,
    );
    this.providers.set(canonicalLabel, provider);
    return this;
  }

  bindMany(canonicalLabels: string[], provider: EmployeeToolProvider): this {
    for (const label of canonicalLabels) this.bind(label, provider);
    return this;
  }

  validateEmployeeCoverage(employee: EmployeeAgentDefinition): void {
    for (const declared of employee.contract.tools) {
      const capability = this.get(declared.name);
      ensure(
        capability.employee_departments.includes('*') || capability.employee_departments.includes(employee.contract.identity.department),
        'tool.capability.department_mismatch',
        `${declared.name} is not available to department ${employee.contract.identity.department}`,
      );
      ensure(
        capability.side_effect === declared.side_effect,
        'tool.capability.effect_mismatch',
        `${declared.name} side_effect differs between Employee contract and capability contract`,
      );
    }
  }

  assertEmployeeReady(employee: EmployeeAgentDefinition): void {
    this.validateEmployeeCoverage(employee);
    for (const declared of employee.contract.tools.filter((tool) => tool.permission === 'allow')) {
      const capability = this.get(declared.name);
      if (capability.provider_required) {
        ensure(
          this.providers.has(declared.name),
          'tool.provider.unbound',
          `No provider bound for required capability ${declared.name}`,
        );
      }
    }
  }

  resolveExecutor(canonicalLabel: string): EmployeeToolExecutor {
    const capability = this.get(canonicalLabel);
    return async (input, callContext) => {
      const provider = this.providers.get(canonicalLabel);
      ensure(provider, 'tool.provider.unbound', `No provider bound for capability ${canonicalLabel}`);

      const context: ToolProviderInvocationContext = {
        employee_canonical_label: callContext.employee.contract.identity.canonical_label,
        intent_canonical_label: callContext.interaction.intent.ref.canonical_label,
        interaction_id: callContext.interaction.interaction_id,
        correlation_id: callContext.interaction.correlation_id,
        operation: callContext.operation,
        operation_index: callContext.execution.operation_index,
        input_digest: callContext.execution.input_digest,
        execution_id: callContext.execution.execution_id,
        idempotency_key: callContext.execution.idempotency_key,
        ...(callContext.interaction.input.delegation_ref
          ? { delegation_ref: callContext.interaction.input.delegation_ref }
          : {}),
        ...(callContext.validated_human_approval?.evidence_ref
          ? { approval_evidence_ref: callContext.validated_human_approval.evidence_ref }
          : {}),
      };
      return provider.invoke(capability, input, context);
    };
  }
}

export type InMemoryToolHandler = (
  input: unknown,
  context: ToolProviderInvocationContext,
  capability: EmployeeToolCapability,
) => MaybePromise<unknown>;

export class InMemoryEmployeeToolProvider implements EmployeeToolProvider {
  readonly kind = 'in-memory' as const;

  constructor(
    readonly id: string,
    private readonly handlers: Record<string, InMemoryToolHandler>,
  ) {}

  invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): MaybePromise<unknown> {
    const handler = this.handlers[capability.canonical_label];
    ensure(handler, 'tool.provider.handler_missing', `${this.id} has no handler for ${capability.canonical_label}`);
    return handler(input, context, capability);
  }
}

export class InjectedEmployeeToolProvider implements EmployeeToolProvider {
  readonly kind = 'injected' as const;

  constructor(
    readonly id: string,
    private readonly handler: (
      capability: EmployeeToolCapability,
      input: unknown,
      context: ToolProviderInvocationContext,
    ) => MaybePromise<unknown>,
  ) {}

  invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): MaybePromise<unknown> {
    return this.handler(capability, input, context);
  }
}

export interface McpToolDriver {
  callTool(
    name: string,
    args: unknown,
    metadata: ToolProviderInvocationContext,
  ): MaybePromise<unknown>;
}

export class McpEmployeeToolProvider implements EmployeeToolProvider {
  readonly kind = 'mcp' as const;

  constructor(readonly id: string, private readonly driver: McpToolDriver) {}

  invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): MaybePromise<unknown> {
    return this.driver.callTool(capability.canonical_label, input, context);
  }
}

export type ToolEndpointResolver = (capability: EmployeeToolCapability) => string;

export class HttpJsonEmployeeToolProvider implements EmployeeToolProvider {
  readonly kind = 'http-json' as const;

  constructor(
    readonly id: string,
    private readonly endpointFor: ToolEndpointResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): Promise<unknown> {
    const response = await this.fetchImpl(this.endpointFor(capability), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-h2a2h-capability': capability.canonical_label,
        'x-h2a2h-execution-id': context.execution_id,
        'Idempotency-Key': context.idempotency_key,
      },
      body: JSON.stringify({ capability: capability.canonical_label, input, context }),
    });
    if (!response.ok) {
      throw new EmployeeToolCapabilityError(
        'tool.provider.http_error',
        `${capability.canonical_label} provider returned HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? response.json() : response.text();
  }
}
