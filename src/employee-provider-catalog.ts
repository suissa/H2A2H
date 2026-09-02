import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  EmployeeProviderPackRegistry,
  loadEmployeeProviderPackManifest,
  type ActiveEmployeeProviderPack,
  type EmployeeProviderPackFactory,
  type EmployeeProviderPackKind,
  type EmployeeProviderPackManifest,
} from './employee-provider-pack.js';
import {
  EmployeeToolCapabilityError,
  type EmployeeToolRegistry,
} from './employee-tool-registry.js';
import type { MaybePromise } from './types.js';

export interface EmployeeProviderPackCatalogEntry {
  path: string;
  manifest: EmployeeProviderPackManifest;
}

export interface EmployeeProviderActivationPlan {
  selected: EmployeeProviderPackCatalogEntry[];
  required_capabilities: string[];
  covered_capabilities: string[];
  alternatives: Record<string, string[]>;
}

export interface EmployeeProviderActivationResolver {
  factory(entry: EmployeeProviderPackCatalogEntry): MaybePromise<EmployeeProviderPackFactory>;
  config(entry: EmployeeProviderPackCatalogEntry): MaybePromise<Record<string, unknown>>;
  secrets(entry: EmployeeProviderPackCatalogEntry): MaybePromise<Record<string, string>>;
}

const DEFAULT_KIND_PREFERENCE: EmployeeProviderPackKind[] = [
  'http-json',
  'in-memory',
  'mcp',
  'injected',
];

function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EmployeeToolCapabilityError(code, message);
}

async function discoverManifestPaths(directory: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === 'manifest.json') found.push(path);
    }
  }
  await visit(directory);
  return found.sort();
}

export async function discoverEmployeeProviderPacks(
  tools: EmployeeToolRegistry,
  providersDirectory = resolve(process.cwd(), 'providers'),
): Promise<EmployeeProviderPackCatalogEntry[]> {
  const paths = await discoverManifestPaths(resolve(providersDirectory));
  ensure(paths.length > 0, 'provider_catalog.empty', 'No providers/**/manifest.json files were discovered');

  const identities = new Set<string>();
  const catalog: EmployeeProviderPackCatalogEntry[] = [];
  for (const path of paths) {
    const manifest = await loadEmployeeProviderPackManifest(path, tools);
    ensure(
      !identities.has(manifest.canonical_label),
      'provider_catalog.identity.duplicate',
      `Duplicate Provider Pack canonical label ${manifest.canonical_label}`,
    );
    identities.add(manifest.canonical_label);
    catalog.push({ path, manifest });
  }
  return catalog;
}

function kindRank(kind: EmployeeProviderPackKind, preference: readonly EmployeeProviderPackKind[]): number {
  const index = preference.indexOf(kind);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function planEmployeeProviderActivation(
  catalog: EmployeeProviderPackCatalogEntry[],
  requiredCapabilities: Iterable<string>,
  kindPreference: readonly EmployeeProviderPackKind[] = DEFAULT_KIND_PREFERENCE,
): EmployeeProviderActivationPlan {
  const required = [...new Set(requiredCapabilities)].sort();
  ensure(required.length > 0, 'provider_plan.capabilities.empty', 'Provider activation plan requires capabilities');

  const alternatives: Record<string, string[]> = {};
  for (const capability of required) {
    const owners = catalog
      .filter((entry) => entry.manifest.capabilities.includes(capability))
      .map((entry) => entry.manifest.canonical_label)
      .sort();
    ensure(
      owners.length > 0,
      'provider_plan.capability.uncovered',
      `No Provider Pack covers required capability ${capability}`,
    );
    if (owners.length > 1) alternatives[capability] = owners;
  }

  const uncovered = new Set(required);
  const owned = new Set<string>();
  const selected: EmployeeProviderPackCatalogEntry[] = [];

  while (uncovered.size > 0) {
    const candidates = catalog
      .filter((entry) => {
        const labels = entry.manifest.capabilities;
        return labels.some((label) => uncovered.has(label)) && labels.every((label) => !owned.has(label));
      })
      .sort((left, right) => {
        const leftCoverage = left.manifest.capabilities.filter((label) => uncovered.has(label)).length;
        const rightCoverage = right.manifest.capabilities.filter((label) => uncovered.has(label)).length;
        if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;
        const kindDifference = kindRank(left.manifest.provider_kind, kindPreference)
          - kindRank(right.manifest.provider_kind, kindPreference);
        if (kindDifference !== 0) return kindDifference;
        return left.manifest.canonical_label.localeCompare(right.manifest.canonical_label);
      });

    const next = candidates[0];
    ensure(
      next,
      'provider_plan.ambiguous',
      `No non-overlapping Provider Pack activation plan can cover: ${[...uncovered].sort().join(', ')}`,
    );
    selected.push(next);
    for (const capability of next.manifest.capabilities) {
      owned.add(capability);
      uncovered.delete(capability);
    }
  }

  const covered = required.filter((capability) => owned.has(capability));
  ensure(
    covered.length === required.length,
    'provider_plan.incomplete',
    'Provider activation plan did not cover every required capability',
  );

  return {
    selected,
    required_capabilities: required,
    covered_capabilities: covered,
    alternatives,
  };
}

export async function activateEmployeeProviderPlan(
  registry: EmployeeProviderPackRegistry,
  plan: EmployeeProviderActivationPlan,
  resolver: EmployeeProviderActivationResolver,
): Promise<ActiveEmployeeProviderPack[]> {
  for (const entry of plan.selected) {
    registry.register(entry.manifest, await resolver.factory(entry));
  }

  const active: ActiveEmployeeProviderPack[] = [];
  for (const entry of plan.selected) {
    active.push(await registry.activate(
      entry.manifest.canonical_label,
      await resolver.config(entry),
      await resolver.secrets(entry),
    ));
  }
  return active;
}
