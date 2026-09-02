import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';
import { createDeclarativeHttpJsonProviderPackFactory } from './http-json-domain.js';

/**
 * Compatibility export. All Engineering/IT routing, authorization and header
 * mappings are declared in providers/engineering-http-json/manifest.json.
 */
export function createEngineeringHttpJsonProviderPackFactory(
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return createDeclarativeHttpJsonProviderPackFactory(fetchImpl);
}
