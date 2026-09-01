import { resolve } from 'node:path';
import {
  EmployeeAgentContractError,
  EmployeeAgentRuntime,
  loadEmployeeAgent,
  type EmployeeAgentRuntimeOptions,
} from './employee-agent.js';

export const PERSONAL_SHOPPER_CANONICAL_LABEL = 'Enterprise.Employee.PersonalShopperAgent';
export const PERSONAL_SHOPPER_DIRECTORY = 'employees/personal-services/personal-shopper';

export async function createPersonalShopperAgent(
  options: EmployeeAgentRuntimeOptions,
  directory = resolve(process.cwd(), PERSONAL_SHOPPER_DIRECTORY),
): Promise<EmployeeAgentRuntime> {
  const employee = await loadEmployeeAgent(directory);
  if (employee.contract.identity.canonical_label !== PERSONAL_SHOPPER_CANONICAL_LABEL) {
    throw new EmployeeAgentContractError(
      'personal_shopper.identity_mismatch',
      `Expected ${PERSONAL_SHOPPER_CANONICAL_LABEL}, received ${employee.contract.identity.canonical_label}`,
    );
  }
  return new EmployeeAgentRuntime(employee, options);
}
