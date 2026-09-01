import {
  EmployeeToolCapabilityError,
  type EmployeeToolCapability,
  type EmployeeToolProvider,
  type ToolProviderInvocationContext,
} from '../employee-tool-registry.js';
import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';

export interface HttpJsonDomainPackDefinition {
  id: string;
  paths: Record<string, string>;
  token_secret: string;
  config_headers?: Record<string, string>;
}

function fail(code: string, message: string): never {
  throw new EmployeeToolCapabilityError(code, message);
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return fail('http_domain_provider.base_url.protocol', 'Provider Pack base_url must use HTTP or HTTPS');
    }
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    if (error instanceof EmployeeToolCapabilityError) throw error;
    return fail('http_domain_provider.base_url.invalid', `Invalid Provider Pack base_url: ${value}`);
  }
}

export class HttpJsonDomainProvider implements EmployeeToolProvider {
  readonly kind = 'http-json' as const;
  readonly id: string;
  private readonly baseUrl: string;

  constructor(
    private readonly definition: HttpJsonDomainPackDefinition,
    private readonly config: Record<string, unknown>,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.id = definition.id;
    const baseUrl = config.base_url;
    if (typeof baseUrl !== 'string') {
      fail('http_domain_provider.config.base_url', 'Provider Pack base_url must be a string');
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (!token) {
      fail('http_domain_provider.secret.missing', `Provider Pack requires ${definition.token_secret}`);
    }
  }

  async invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): Promise<unknown> {
    const path = this.definition.paths[capability.canonical_label];
    if (!path) {
      fail(
        'http_domain_provider.capability.unsupported',
        `${this.id} does not implement ${capability.canonical_label}`,
      );
    }
    if (!context.delegation_ref) {
      fail(
        'http_domain_provider.delegation.missing',
        `${capability.canonical_label} requires an H2A2H delegation reference before provider invocation`,
      );
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      'content-type': 'application/json',
      'x-h2a2h-capability': capability.canonical_label,
      'x-h2a2h-interaction-id': context.interaction_id,
      'x-h2a2h-correlation-id': context.correlation_id,
      'x-h2a2h-delegation-ref': context.delegation_ref,
    };
    if (context.approval_evidence_ref) {
      headers['x-h2a2h-approval-evidence'] = context.approval_evidence_ref;
    }
    for (const [configKey, headerName] of Object.entries(this.definition.config_headers ?? {})) {
      const value = this.config[configKey];
      if (typeof value === 'string' && value.length > 0) headers[headerName] = value;
    }

    const timeout = this.config.timeout_ms;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        capability: capability.canonical_label,
        input,
        context: {
          employee_canonical_label: context.employee_canonical_label,
          intent_canonical_label: context.intent_canonical_label,
          interaction_id: context.interaction_id,
          correlation_id: context.correlation_id,
          delegation_ref: context.delegation_ref,
          ...(context.approval_evidence_ref
            ? { approval_evidence_ref: context.approval_evidence_ref }
            : {}),
        },
      }),
      ...(typeof timeout === 'number' && timeout > 0
        ? { signal: AbortSignal.timeout(Math.floor(timeout)) }
        : {}),
    });

    if (!response.ok) {
      throw new EmployeeToolCapabilityError(
        'http_domain_provider.http_error',
        `${capability.canonical_label} provider returned HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? response.json() : response.text();
  }
}

export function createHttpJsonDomainProviderPackFactory(
  definition: HttpJsonDomainPackDefinition,
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return ({ config, secrets }) => ({
    defaultProvider: new HttpJsonDomainProvider(
      definition,
      config,
      secrets[definition.token_secret] ?? '',
      fetchImpl,
    ),
  });
}
