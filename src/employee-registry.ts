import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  EmployeeAgentContractError,
  EmployeeAgentRuntime,
  loadEmployeeAgent,
  type EmployeeAgentDefinition,
  type EmployeeAgentRuntimeOptions,
} from './employee-agent.js';
import type { MaybePromise } from './types.js';

export interface EmployeeCatalogEntry {
  department: string;
  slug: string;
  name: string;
  path: string;
  canonical_label: string;
}

export type EmployeeRuntimeOptionsFactory = (
  employee: EmployeeAgentDefinition,
  catalogEntry: EmployeeCatalogEntry,
) => MaybePromise<EmployeeAgentRuntimeOptions>;

function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EmployeeAgentContractError(code, message);
}

function assertUnique(entries: EmployeeCatalogEntry[], selector: (entry: EmployeeCatalogEntry) => string, code: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const value = selector(entry);
    assert(!seen.has(value), code, `Duplicate Employee Agent catalog value: ${value}`);
    seen.add(value);
  }
}

export function validateEmployeeCatalog(value: unknown): EmployeeCatalogEntry[] {
  assert(Array.isArray(value), 'employee.catalog.invalid', 'Employee Agent catalog must be an array');
  const entries = value as EmployeeCatalogEntry[];
  assert(entries.length > 0, 'employee.catalog.empty', 'Employee Agent catalog cannot be empty');

  for (const entry of entries) {
    assert(entry && typeof entry === 'object', 'employee.catalog.entry', 'Employee Agent catalog entry must be an object');
    assert(typeof entry.department === 'string' && entry.department.length > 0, 'employee.catalog.department', 'Employee Agent department is required');
    assert(typeof entry.slug === 'string' && entry.slug.length > 0, 'employee.catalog.slug', 'Employee Agent slug is required');
    assert(typeof entry.name === 'string' && entry.name.length > 0, 'employee.catalog.name', 'Employee Agent name is required');
    assert(typeof entry.path === 'string' && entry.path.startsWith('employees/'), 'employee.catalog.path', `Employee Agent path must be under employees/: ${entry.path}`);
    assert(
      typeof entry.canonical_label === 'string' && entry.canonical_label.startsWith('Enterprise.Employee.'),
      'employee.catalog.canonical_label',
      `Invalid Employee Agent canonical label: ${entry.canonical_label}`,
    );
  }

  assertUnique(entries, (entry) => entry.canonical_label, 'employee.catalog.duplicate_canonical_label');
  assertUnique(entries, (entry) => entry.path, 'employee.catalog.duplicate_path');
  assertUnique(entries, (entry) => `${entry.department}/${entry.slug}`, 'employee.catalog.duplicate_role');
  return entries;
}

export async function loadEmployeeCatalog(
  catalogPath = resolve(process.cwd(), 'employees/catalog.json'),
): Promise<EmployeeCatalogEntry[]> {
  return validateEmployeeCatalog(JSON.parse(await readFile(catalogPath, 'utf8')) as unknown);
}

export class EmployeeAgentRegistry {
  private readonly byCanonicalLabel = new Map<string, EmployeeCatalogEntry>();
  private readonly byRole = new Map<string, EmployeeCatalogEntry>();

  constructor(
    readonly entries: EmployeeCatalogEntry[],
    readonly baseDirectory = process.cwd(),
  ) {
    validateEmployeeCatalog(entries);
    for (const entry of entries) {
      this.byCanonicalLabel.set(entry.canonical_label, entry);
      this.byRole.set(`${entry.department}/${entry.slug}`, entry);
    }
  }

  static async fromCatalog(
    catalogPath = resolve(process.cwd(), 'employees/catalog.json'),
    baseDirectory = process.cwd(),
  ): Promise<EmployeeAgentRegistry> {
    return new EmployeeAgentRegistry(await loadEmployeeCatalog(catalogPath), baseDirectory);
  }

  list(filter: { department?: string } = {}): EmployeeCatalogEntry[] {
    return this.entries.filter((entry) => !filter.department || entry.department === filter.department);
  }

  get(canonicalLabel: string): EmployeeCatalogEntry {
    const entry = this.byCanonicalLabel.get(canonicalLabel);
    if (!entry) {
      throw new EmployeeAgentContractError(
        'employee.registry.not_found',
        `Employee Agent ${canonicalLabel} is not present in the catalog`,
      );
    }
    return entry;
  }

  getByRole(department: string, slug: string): EmployeeCatalogEntry {
    const entry = this.byRole.get(`${department}/${slug}`);
    if (!entry) {
      throw new EmployeeAgentContractError(
        'employee.registry.role_not_found',
        `Employee Agent role ${department}/${slug} is not present in the catalog`,
      );
    }
    return entry;
  }

  async load(canonicalLabel: string): Promise<EmployeeAgentDefinition> {
    const entry = this.get(canonicalLabel);
    const employee = await loadEmployeeAgent(resolve(this.baseDirectory, entry.path));
    if (employee.contract.identity.canonical_label !== entry.canonical_label) {
      throw new EmployeeAgentContractError(
        'employee.registry.identity_mismatch',
        `Catalog identity ${entry.canonical_label} does not match contract identity ${employee.contract.identity.canonical_label}`,
      );
    }
    return employee;
  }

  async createRuntime(
    canonicalLabel: string,
    optionsFactory: EmployeeRuntimeOptionsFactory,
  ): Promise<EmployeeAgentRuntime> {
    const entry = this.get(canonicalLabel);
    const employee = await this.load(canonicalLabel);
    const options = await optionsFactory(employee, entry);
    return new EmployeeAgentRuntime(employee, options);
  }

  async createRuntimeByRole(
    department: string,
    slug: string,
    optionsFactory: EmployeeRuntimeOptionsFactory,
  ): Promise<EmployeeAgentRuntime> {
    const entry = this.getByRole(department, slug);
    return this.createRuntime(entry.canonical_label, optionsFactory);
  }
}
