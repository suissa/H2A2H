import type { EmployeeProviderPackFactory } from '../employee-provider-pack.js';
import { createDeclarativeHttpJsonProviderPackFactory } from './http-json-domain.js';

export interface FinanceHttpJsonConfig {
  base_url: string;
  tenant_id?: string;
  timeout_ms?: number;
}

/**
 * Compatibility export. All Finance routing, authorization and header
 * mappings are declared in providers/finance-http-json/manifest.json.
 */
export function createFinanceHttpJsonProviderPackFactory(
  fetchImpl: typeof fetch = fetch,
): EmployeeProviderPackFactory {
  return createDeclarativeHttpJsonProviderPackFactory(fetchImpl);
}
