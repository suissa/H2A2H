import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';
import { createHttpJsonDomainProviderPackFactory } from './http-json-domain.js';

export const HR_HTTP_PATHS = {
  'hr.hris.read': '/v1/hr/hris/read',
  'hr.hris.write': '/v1/hr/hris/write',
  'hr.ats.query': '/v1/hr/ats/query',
  'hr.policy.query': '/v1/hr/policy/query',
  'hr.approval.request': '/v1/hr/approval/request',
} as const;

export function createHrHttpJsonProviderPackFactory(
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return createHttpJsonDomainProviderPackFactory(
    {
      id: 'provider-pack:human-resources:http-json',
      paths: HR_HTTP_PATHS,
      token_secret: 'access_token',
      config_headers: {
        organization_id: 'x-h2a2h-organization-id',
      },
    },
    fetchImpl,
  );
}
