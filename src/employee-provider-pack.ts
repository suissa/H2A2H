import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  EmployeeToolCapabilityError,
  HttpJsonEmployeeToolProvider,
  InMemoryEmployeeToolProvider,
  InjectedEmployeeToolProvider,
  McpEmployeeToolProvider,
  type EmployeeToolProvider,
  type EmployeeToolProviderKind,
  type EmployeeToolRegistry,
  type InMemoryToolHandler,
  type McpToolDriver,
  type ToolEndpointResolver,
  type ToolProviderInvocationContext,
  type EmployeeToolCapability,
} from './employee-tool-registry.js';
import type { MaybePromise } from './types.js';

export type EmployeeProviderPackKind = Exclude<EmployeeToolProviderKind, 'internal'>;
export type ProviderPackConfigValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface EmployeeProviderPackManifest {
  canonical_label: string;
  version: string;
  domain: string;
  provider_kind: EmployeeProviderPackKind;
  capabilities: string[];
  config_schema: {
    type: 'object';
    required?: string[];
    properties: Record<string, { type: ProviderPackConfigValueType }>;
    additionalProperties: boolean;
  };
  secrets: Array<{ name: string; required: boolean }>;
  runtime: {
    network: boolean;
    protocols: string[];
  };
}

export interface EmployeeProviderPackContext {
  manifest: EmployeeProviderPackManifest;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface EmployeeProviderPackBinding {
  defaultProvider?: EmployeeToolProvider;
  capabilityProviders?: Record<string, EmployeeToolProvider>;
}

export type EmployeeProviderPackFactory = (
  context: EmployeeProviderPackContext,
) => MaybePromise<EmployeeProviderPackBinding>;

export interface ActiveEmployeeProviderPack {
  manifest: EmployeeProviderPackManifest;
  capabilityProviders: ReadonlyMap<string, EmployeeToolProvider>;
}

function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EmployeeToolCapabilityError(code, message);
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function valueMatchesType(value: unknown, expected: ProviderPackConfigValueType): boolean {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === expected;
}

export function validateEmployeeProviderPackManifest(
  manifest: EmployeeProviderPackManifest,
  tools: EmployeeToolRegistry,
): EmployeeProviderPackManifest {
  ensure(
    /^ProviderPack\.[A-Za-z0-9_.-]+$/.test(manifest.canonical_label),
    'provider_pack.identity.invalid',
    `Invalid Provider Pack canonical label ${manifest.canonical_label}`,
  );
  ensure(isVersion(manifest.version), 'provider_pack.version.invalid', `Invalid Provider Pack version ${manifest.version}`);
  ensure(manifest.domain.length > 0, 'provider_pack.domain.missing', 'Provider Pack domain is required');
  ensure(
    ['in-memory', 'http-json', 'mcp', 'injected'].includes(manifest.provider_kind),
    'provider_pack.kind.invalid',
    `Unsupported Provider Pack kind ${manifest.provider_kind}`,
  );
  ensure(manifest.capabilities.length > 0, 'provider_pack.capabilities.empty', 'Provider Pack must cover capabilities');
  ensure(
    new Set(manifest.capabilities).size === manifest.capabilities.length,
    'provider_pack.capabilities.duplicate',
    `Provider Pack ${manifest.canonical_label} declares duplicate capabilities`,
  );

  for (const label of manifest.capabilities) {
    const capability = tools.get(label);
    ensure(
      capability.domain === manifest.domain,
      'provider_pack.capability.domain_mismatch',
      `${label} belongs to ${capability.domain}, not ${manifest.domain}`,
    );
    ensure(capability.provider_required, 'provider_pack.capability.internal', `${label} is not a provider-bound business capability`);
    ensure(
      capability.provider_bindings.includes(manifest.provider_kind),
      'provider_pack.capability.kind_not_allowed',
      `${label} does not allow ${manifest.provider_kind} providers`,
    );
  }

  const declaredSecrets = manifest.secrets.map((entry) => entry.name);
  ensure(
    new Set(declaredSecrets).size === declaredSecrets.length,
    'provider_pack.secrets.duplicate',
    `Provider Pack ${manifest.canonical_label} declares duplicate secrets`,
  );
  const requiredConfig = manifest.config_schema.required ?? [];
  ensure(
    requiredConfig.every((key) => key in manifest.config_schema.properties),
    'provider_pack.config_schema.required_unknown',
    'Provider Pack config schema requires undeclared properties',
  );
  return manifest;
}

export async function loadEmployeeProviderPackManifest(
  manifestPath: string,
  tools: EmployeeToolRegistry,
): Promise<EmployeeProviderPackManifest> {
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')) as EmployeeProviderPackManifest;
  return validateEmployeeProviderPackManifest(manifest, tools);
}

export class EmployeeProviderPackRegistry {
  private readonly packs = new Map<string, { manifest: EmployeeProviderPackManifest; factory: EmployeeProviderPackFactory }>();
  private readonly active = new Map<string, ActiveEmployeeProviderPack>();
  private readonly capabilityOwners = new Map<string, string>();

  constructor(readonly tools: EmployeeToolRegistry) {}

  register(manifest: EmployeeProviderPackManifest, factory: EmployeeProviderPackFactory): this {
    validateEmployeeProviderPackManifest(manifest, this.tools);
    ensure(
      !this.packs.has(manifest.canonical_label),
      'provider_pack.identity.duplicate',
      `Provider Pack ${manifest.canonical_label} is already registered`,
    );
    this.packs.set(manifest.canonical_label, { manifest, factory });
    return this;
  }

  list(filter: { domain?: string } = {}): EmployeeProviderPackManifest[] {
    return [...this.packs.values()]
      .map((entry) => entry.manifest)
      .filter((manifest) => !filter.domain || manifest.domain === filter.domain);
  }

  get(canonicalLabel: string): EmployeeProviderPackManifest {
    const entry = this.packs.get(canonicalLabel);
    ensure(entry, 'provider_pack.not_found', `Provider Pack ${canonicalLabel} is not registered`);
    return entry.manifest;
  }

  getActive(canonicalLabel: string): ActiveEmployeeProviderPack {
    const entry = this.active.get(canonicalLabel);
    ensure(entry, 'provider_pack.not_active', `Provider Pack ${canonicalLabel} is not active`);
    return entry;
  }

  async activate(
    canonicalLabel: string,
    config: Record<string, unknown> = {},
    secrets: Record<string, string> = {},
  ): Promise<ActiveEmployeeProviderPack> {
    const registered = this.packs.get(canonicalLabel);
    ensure(registered, 'provider_pack.not_found', `Provider Pack ${canonicalLabel} is not registered`);
    ensure(!this.active.has(canonicalLabel), 'provider_pack.already_active', `Provider Pack ${canonicalLabel} is already active`);

    this.validateConfiguration(registered.manifest, config, secrets);
    for (const capability of registered.manifest.capabilities) {
      const owner = this.capabilityOwners.get(capability);
      ensure(
        !owner,
        'provider_pack.capability.ambiguous',
        `Capability ${capability} is already provided by ${owner}`,
      );
    }

    const binding = await registered.factory({ manifest: registered.manifest, config, secrets });
    const resolved = new Map<string, EmployeeToolProvider>();
    for (const capability of registered.manifest.capabilities) {
      const provider = binding.capabilityProviders?.[capability] ?? binding.defaultProvider;
      ensure(provider, 'provider_pack.binding.missing', `${canonicalLabel} did not bind ${capability}`);
      ensure(
        provider.kind === registered.manifest.provider_kind,
        'provider_pack.binding.kind_mismatch',
        `${capability} expected ${registered.manifest.provider_kind}, received ${provider.kind}`,
      );
      resolved.set(capability, provider);
    }

    for (const [capability, provider] of resolved) {
      this.tools.bind(capability, provider);
      this.capabilityOwners.set(capability, canonicalLabel);
    }
    const active: ActiveEmployeeProviderPack = {
      manifest: registered.manifest,
      capabilityProviders: resolved,
    };
    this.active.set(canonicalLabel, active);
    return active;
  }

  private validateConfiguration(
    manifest: EmployeeProviderPackManifest,
    config: Record<string, unknown>,
    secrets: Record<string, string>,
  ): void {
    for (const key of manifest.config_schema.required ?? []) {
      ensure(key in config, 'provider_pack.config.missing', `${manifest.canonical_label} requires config ${key}`);
    }
    for (const [key, value] of Object.entries(config)) {
      const property = manifest.config_schema.properties[key];
      ensure(
        Boolean(property) || manifest.config_schema.additionalProperties,
        'provider_pack.config.undeclared',
        `${manifest.canonical_label} does not declare config ${key}`,
      );
      if (property) {
        ensure(
          valueMatchesType(value, property.type),
          'provider_pack.config.type',
          `${manifest.canonical_label} config ${key} must be ${property.type}`,
        );
      }
    }

    const declaredSecrets = new Set(manifest.secrets.map((entry) => entry.name));
    for (const secret of manifest.secrets.filter((entry) => entry.required)) {
      ensure(Boolean(secrets[secret.name]), 'provider_pack.secret.missing', `${manifest.canonical_label} requires secret ${secret.name}`);
    }
    for (const key of Object.keys(secrets)) {
      ensure(declaredSecrets.has(key), 'provider_pack.secret.undeclared', `${manifest.canonical_label} does not declare secret ${key}`);
    }
  }
}

export function createInMemoryProviderPackFactory(
  id: string,
  handlers: Record<string, InMemoryToolHandler>,
): EmployeeProviderPackFactory {
  return ({ manifest }) => ({
    defaultProvider: new InMemoryEmployeeToolProvider(id, handlers),
    capabilityProviders: Object.fromEntries(
      manifest.capabilities.map((label) => [label, new InMemoryEmployeeToolProvider(id, handlers)]),
    ),
  });
}

export function createHttpJsonProviderPackFactory(
  id: string,
  endpointFor: ToolEndpointResolver,
  fetchImpl?: typeof fetch,
): EmployeeProviderPackFactory {
  return () => ({
    defaultProvider: new HttpJsonEmployeeToolProvider(id, endpointFor, fetchImpl ?? fetch),
  });
}

export function createMcpProviderPackFactory(
  id: string,
  driver: McpToolDriver,
): EmployeeProviderPackFactory {
  return () => ({ defaultProvider: new McpEmployeeToolProvider(id, driver) });
}

export function createInjectedProviderPackFactory(
  id: string,
  handler: (
    capability: EmployeeToolCapability,
    input: unknown,
    context: ToolProviderInvocationContext,
  ) => MaybePromise<unknown>,
): EmployeeProviderPackFactory {
  return () => ({ defaultProvider: new InjectedEmployeeToolProvider(id, handler) });
}
