import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';
import { createHttpJsonDomainProviderPackFactory } from './http-json-domain.js';

export const ENGINEERING_HTTP_PATHS = {
  'engineering.scm.read': '/v1/engineering/scm/read',
  'engineering.scm.write': '/v1/engineering/scm/write',
  'engineering.ci.execute': '/v1/engineering/ci/execute',
  'observability.query': '/v1/observability/query',
  'engineering.change.request': '/v1/engineering/change/request',
} as const;

export function createEngineeringHttpJsonProviderPackFactory(
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return createHttpJsonDomainProviderPackFactory(
    {
      id: 'provider-pack:engineering:http-json',
      paths: ENGINEERING_HTTP_PATHS,
      token_secret: 'access_token',
      config_headers: {
        workspace: 'x-h2a2h-workspace',
      },
    },
    fetchImpl,
  );
}
