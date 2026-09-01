import {
  EmployeeToolCapabilityError,
  type EmployeeToolCapability,
  type EmployeeToolProvider,
  type ToolProviderInvocationContext,
} from '../employee-tool-registry.js';
import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';
import type { MaybePromise } from '../types.js';

export const FINANCE_HTTP_PATHS = {
  'finance.erp.read': '/v1/finance/erp/read',
  'finance.erp.write': '/v1/finance/erp/write',
  'finance.ledger.query': '/v1/finance/ledger/query',
  'finance.report.generate': '/v1/finance/report/generate',
  'finance.approval.request': '/v1/finance/approval/request',
} as const;

export type FinanceHttpCapability = keyof typeof FINANCE_HTTP_PATHS;

export interface FinanceHttpJsonConfig {
  base_url: string;
  tenant_id?: string;
  timeout_ms?: number;
}

function fail(code: string, message: string): never {
  throw new EmployeeToolCapabilityError(code, message);
}

function normalizedBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return fail('finance_provider.base_url.protocol', 'Finance Provider Pack base_url must use HTTP or HTTPS');
    }
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    if (error instanceof EmployeeToolCapabilityError) throw error;
    return fail('finance_provider.base_url.invalid', `Invalid Finance Provider Pack base_url: ${value}`);
  }
}

export class FinanceHttpJsonProvider implements EmployeeToolProvider {
  readonly kind = 'http-json' as const;
  readonly id = 'provider-pack:finance:http-json';
  private readonly baseUrl: string;

  constructor(
    private readonly config: FinanceHttpJsonConfig,
    private readonly apiToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = normalizedBaseUrl(config.base_url);
    if (!apiToken) fail('finance_provider.secret.missing', 'Finance Provider Pack requires api_token');
  }

  async invoke(
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ): Promise<unknown> {
    const path = FINANCE_HTTP_PATHS[capability.canonical_label as FinanceHttpCapability];
    if (!path) {
      fail(
        'finance_provider.capability.unsupported',
        `Finance HTTP+JSON Provider does not implement ${capability.canonical_label}`,
      );
    }
    if (!context.delegation_ref) {
      fail(
        'finance_provider.delegation.missing',
        `${capability.canonical_label} requires an H2A2H delegation reference before provider invocation`,
      );
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiToken}`,
      'content-type': 'application/json',
      'x-h2a2h-capability': capability.canonical_label,
      'x-h2a2h-interaction-id': context.interaction_id,
      'x-h2a2h-correlation-id': context.correlation_id,
      'x-h2a2h-delegation-ref': context.delegation_ref,
    };
    if (context.approval_evidence_ref) {
      headers['x-h2a2h-approval-evidence'] = context.approval_evidence_ref;
    }
    if (this.config.tenant_id) {
      headers['x-h2a2h-tenant-id'] = this.config.tenant_id;
    }

    const timeout = this.config.timeout_ms;
    const request: RequestInit = {
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
    };

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, request);
    if (!response.ok) {
      throw new EmployeeToolCapabilityError(
        'finance_provider.http_error',
        `${capability.canonical_label} finance provider returned HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? response.json() : response.text();
  }
}

export function createFinanceHttpJsonProviderPackFactory(
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return ({ config, secrets }): MaybePromise<{ defaultProvider: EmployeeToolProvider }> => {
    const baseUrl = config.base_url;
    if (typeof baseUrl !== 'string') {
      fail('finance_provider.config.base_url', 'Finance Provider Pack base_url must be a string');
    }
    const tenantId = config.tenant_id;
    if (tenantId !== undefined && typeof tenantId !== 'string') {
      fail('finance_provider.config.tenant_id', 'Finance Provider Pack tenant_id must be a string');
    }
    const timeoutMs = config.timeout_ms;
    if (timeoutMs !== undefined && typeof timeoutMs !== 'number') {
      fail('finance_provider.config.timeout_ms', 'Finance Provider Pack timeout_ms must be a number');
    }

    return {
      defaultProvider: new FinanceHttpJsonProvider(
        {
          base_url: baseUrl,
          ...(tenantId !== undefined ? { tenant_id: tenantId } : {}),
          ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
        },
        secrets.api_token ?? '',
        fetchImpl,
      ),
    };
  };
}
