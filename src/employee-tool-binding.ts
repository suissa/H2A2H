import {
  businessTools,
  type EmployeeAgentDefinition,
  type EmployeeAgentRuntimeOptions,
} from './employee-agent.js';
import type {
  EmployeeCatalogEntry,
  EmployeeRuntimeOptionsFactory,
} from './employee-registry.js';
import { EmployeeToolRegistry } from './employee-tool-registry.js';
import type { MaybePromise } from './types.js';

export type EmployeeLifecycleBindings = Omit<EmployeeAgentRuntimeOptions, 'toolExecutors'>;

export type EmployeeLifecycleBindingsFactory = (
  employee: EmployeeAgentDefinition,
  catalogEntry: EmployeeCatalogEntry,
) => MaybePromise<EmployeeLifecycleBindings>;

export function createToolBoundEmployeeOptions(
  employee: EmployeeAgentDefinition,
  toolRegistry: EmployeeToolRegistry,
  lifecycle: EmployeeLifecycleBindings,
): EmployeeAgentRuntimeOptions {
  toolRegistry.assertEmployeeReady(employee);
  const toolExecutors = Object.fromEntries(
    businessTools(employee).map((tool) => [tool.name, toolRegistry.resolveExecutor(tool.name)]),
  );
  return { ...lifecycle, toolExecutors };
}

export function createCapabilityBackedOptionsFactory(
  toolRegistry: EmployeeToolRegistry,
  lifecycleFactory: EmployeeLifecycleBindingsFactory,
): EmployeeRuntimeOptionsFactory {
  return async (employee, catalogEntry) => createToolBoundEmployeeOptions(
    employee,
    toolRegistry,
    await lifecycleFactory(employee, catalogEntry),
  );
}
