import { sha256 } from './security.js';
import type { EntityRef } from './types.js';

export interface SemanticCapability {
  canonical_label: string;
  versions: string[];
  schema?: string;
  spec?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticExtensionDeclaration {
  canonical_label: string;
  version: string;
  extends: string[];
  schema?: string;
  spec?: string;
  critical?: boolean;
}

export interface CapabilityHandlerDeclaration {
  id: string;
  canonical_label: string;
  capability: string;
  version: string;
  spec: string;
  config_schema: string;
  input_schema: string;
  output_schema: string;
  channels: string[];
  authorization_profiles: string[];
  config: Record<string, unknown>;
}

export interface EntityDiscoveryDocument {
  protocol: {
    name: 'h2a2h';
    version: string;
    supported_versions: string[];
  };
  entity: EntityRef;
  transports: string[];
  capabilities: SemanticCapability[];
  extensions?: SemanticExtensionDeclaration[];
  handlers?: CapabilityHandlerDeclaration[];
  documentation_url?: string;
}

export interface CapabilityRequirement {
  canonical_label: string;
  required?: boolean;
  acceptable_versions?: string[];
}

export interface CapabilityNegotiationRequest {
  requester: EntityRef;
  provider: EntityRef;
  requester_capabilities: SemanticCapability[];
  provider_capabilities: SemanticCapability[];
  intent_requirements?: CapabilityRequirement[];
  authorization_requirements?: CapabilityRequirement[];
  forbidden_capabilities?: string[];
}

export interface NegotiatedCapability {
  canonical_label: string;
  selected_version: string;
  requester_versions: string[];
  provider_versions: string[];
}

export interface CapabilityNegotiationResult {
  status: 'compatible' | 'incompatible';
  selected: NegotiatedCapability[];
  missing_required: string[];
  rejected: string[];
  hashes: {
    requester_capabilities_hash: string;
    provider_capabilities_hash: string;
    requirements_hash: string;
    negotiation_hash: string;
  };
}

function parseSemver(version: string): [number, number, number, string] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
}

function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let index = 0; index < 3; index += 1) {
    const left = pa[index] as number;
    const right = pb[index] as number;
    if (left !== right) return left - right;
  }
  return pa[3].localeCompare(pb[3]);
}

function normalizeCapabilities(capabilities: SemanticCapability[]): SemanticCapability[] {
  return [...capabilities]
    .map((capability) => ({
      ...capability,
      versions: [...new Set(capability.versions)].sort(compareVersions),
    }))
    .sort((a, b) => a.canonical_label.localeCompare(b.canonical_label));
}

function requirementMap(request: CapabilityNegotiationRequest): Map<string, CapabilityRequirement> {
  const map = new Map<string, CapabilityRequirement>();
  for (const requirement of [
    ...(request.intent_requirements ?? []),
    ...(request.authorization_requirements ?? []),
  ]) {
    const current = map.get(requirement.canonical_label);
    if (!current) {
      map.set(requirement.canonical_label, requirement);
      continue;
    }
    const currentRequired = current.required !== false;
    const nextRequired = requirement.required !== false;
    const acceptable = current.acceptable_versions && requirement.acceptable_versions
      ? current.acceptable_versions.filter((version) => requirement.acceptable_versions?.includes(version))
      : current.acceptable_versions ?? requirement.acceptable_versions;
    map.set(requirement.canonical_label, {
      canonical_label: requirement.canonical_label,
      required: currentRequired || nextRequired,
      ...(acceptable ? { acceptable_versions: acceptable } : {}),
    });
  }
  return map;
}

export function negotiateCapabilities(request: CapabilityNegotiationRequest): CapabilityNegotiationResult {
  const requester = normalizeCapabilities(request.requester_capabilities);
  const provider = normalizeCapabilities(request.provider_capabilities);
  const providerByLabel = new Map(provider.map((capability) => [capability.canonical_label, capability]));
  const requirements = requirementMap(request);
  const forbidden = new Set(request.forbidden_capabilities ?? []);
  const selected: NegotiatedCapability[] = [];

  for (const requesterCapability of requester) {
    const providerCapability = providerByLabel.get(requesterCapability.canonical_label);
    if (!providerCapability || forbidden.has(requesterCapability.canonical_label)) continue;

    const requirement = requirements.get(requesterCapability.canonical_label);
    const acceptableVersions = requirement?.acceptable_versions;
    const commonVersions = requesterCapability.versions.filter(
      (version) => providerCapability.versions.includes(version)
        && (!acceptableVersions || acceptableVersions.includes(version)),
    );
    if (commonVersions.length === 0) continue;

    const selectedVersion = [...commonVersions].sort(compareVersions).at(-1);
    if (!selectedVersion) continue;
    selected.push({
      canonical_label: requesterCapability.canonical_label,
      selected_version: selectedVersion,
      requester_versions: [...requesterCapability.versions],
      provider_versions: [...providerCapability.versions],
    });
  }

  selected.sort((a, b) => a.canonical_label.localeCompare(b.canonical_label));
  const selectedLabels = new Set(selected.map((capability) => capability.canonical_label));
  const missingRequired = [...requirements.values()]
    .filter((requirement) => requirement.required !== false && !selectedLabels.has(requirement.canonical_label))
    .map((requirement) => requirement.canonical_label)
    .sort();

  const allOfferedLabels = new Set([
    ...requester.map((capability) => capability.canonical_label),
    ...provider.map((capability) => capability.canonical_label),
  ]);
  const rejected = [...allOfferedLabels]
    .filter((label) => !selectedLabels.has(label))
    .sort();

  const normalizedRequirements = [...requirements.values()].sort(
    (a, b) => a.canonical_label.localeCompare(b.canonical_label),
  );
  const requesterCapabilitiesHash = sha256(requester);
  const providerCapabilitiesHash = sha256(provider);
  const requirementsHash = sha256({
    requirements: normalizedRequirements,
    forbidden: [...forbidden].sort(),
  });
  const negotiationPayload = {
    requester: request.requester,
    provider: request.provider,
    selected,
    missing_required: missingRequired,
    rejected,
    requester_capabilities_hash: requesterCapabilitiesHash,
    provider_capabilities_hash: providerCapabilitiesHash,
    requirements_hash: requirementsHash,
  };

  return {
    status: missingRequired.length === 0 ? 'compatible' : 'incompatible',
    selected,
    missing_required: missingRequired,
    rejected,
    hashes: {
      requester_capabilities_hash: requesterCapabilitiesHash,
      provider_capabilities_hash: providerCapabilitiesHash,
      requirements_hash: requirementsHash,
      negotiation_hash: sha256(negotiationPayload),
    },
  };
}

export interface ExtensionResolutionResult {
  active: SemanticExtensionDeclaration[];
  missing_critical: string[];
}

export function resolveSemanticExtensions(
  requested: string[],
  providerExtensions: SemanticExtensionDeclaration[],
  required: string[] = [],
): ExtensionResolutionResult {
  const requestedSet = new Set(requested);
  const providerByLabel = new Map(providerExtensions.map((extension) => [extension.canonical_label, extension]));
  const active = [...requestedSet]
    .map((label) => providerByLabel.get(label))
    .filter((extension): extension is SemanticExtensionDeclaration => Boolean(extension))
    .sort((a, b) => a.canonical_label.localeCompare(b.canonical_label));
  const activeLabels = new Set(active.map((extension) => extension.canonical_label));
  const implicitCritical = providerExtensions
    .filter((extension) => extension.critical === true && requestedSet.has(extension.canonical_label))
    .map((extension) => extension.canonical_label);
  const missingCritical = [...new Set([...required, ...implicitCritical])]
    .filter((label) => !activeLabels.has(label))
    .sort();
  return { active, missing_critical: missingCritical };
}

export interface HandlerResolutionRequest {
  negotiated_capabilities: NegotiatedCapability[];
  handlers: CapabilityHandlerDeclaration[];
  channel?: string;
  authorization_profile?: string;
}

export function resolveCapabilityHandlers(request: HandlerResolutionRequest): CapabilityHandlerDeclaration[] {
  const capabilityLabels = new Set(request.negotiated_capabilities.map((capability) => capability.canonical_label));
  return request.handlers
    .filter((handler) => capabilityLabels.has(handler.capability))
    .filter((handler) => !request.channel || handler.channels.includes(request.channel))
    .filter(
      (handler) => !request.authorization_profile
        || handler.authorization_profiles.includes(request.authorization_profile),
    )
    .sort((a, b) => a.canonical_label.localeCompare(b.canonical_label) || a.id.localeCompare(b.id));
}
