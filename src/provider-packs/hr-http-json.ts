import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';
import { createDeclarativeHttpJsonProviderPackFactory } from './http-json-domain.js';

/**
 * Compatibility export. All Human Resources routing, authorization and header
 * mappings are declared in providers/hr-http-json/manifest.json.
 */
export function createHrHttpJsonProviderPackFactory(
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return createDeclarativeHttpJsonProviderPackFactory(fetchImpl);
}
