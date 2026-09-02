export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface ProtocolExtension {
  namespace: string;
  critical: boolean;
}

// SemVer 2.0.0 core + prerelease/build metadata. Numeric core identifiers and
// numeric prerelease identifiers cannot contain leading zeroes.
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MAJOR_WILDCARD_PATTERN = /^(0|[1-9]\d*)\.x$/;

export function parseVersion(version: string): SemanticVersion {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) throw new Error(`version.invalid:${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function parseMajorWildcard(version: string): number | undefined {
  const match = MAJOR_WILDCARD_PATTERN.exec(version);
  return match ? Number(match[1]) : undefined;
}

export function assertVersionSelector(version: string): void {
  if (parseMajorWildcard(version) !== undefined) return;
  parseVersion(version);
}

export function isProtocolCompatible(local: string, remote: string): boolean {
  return parseVersion(local).major === parseVersion(remote).major;
}

function selectorMajor(version: string): number {
  const wildcard = parseMajorWildcard(version);
  return wildcard ?? parseVersion(version).major;
}

export function negotiateVersion(local: readonly string[], remote: readonly string[]): string {
  for (const version of local) assertVersionSelector(version);
  for (const version of remote) assertVersionSelector(version);

  const exactConcrete = local.filter((version) => !version.endsWith('.x') && remote.includes(version));
  if (exactConcrete.length) {
    return exactConcrete.sort(compareVersions).at(-1)!;
  }

  const candidates: string[] = [];
  for (const localVersion of local) {
    for (const remoteVersion of remote) {
      if (selectorMajor(localVersion) !== selectorMajor(remoteVersion)) continue;

      const localWildcard = parseMajorWildcard(localVersion) !== undefined;
      const remoteWildcard = parseMajorWildcard(remoteVersion) !== undefined;
      if (localWildcard && remoteWildcard) continue; // no concrete version can be selected
      if (localWildcard) {
        candidates.push(remoteVersion);
        continue;
      }
      if (remoteWildcard) {
        candidates.push(localVersion);
        continue;
      }

      // H2A2H v1 compatibility is major-based. Select the highest concrete
      // version that both peers can safely interpret within that major by
      // choosing the lower concrete endpoint.
      candidates.push(compareVersions(localVersion, remoteVersion) <= 0 ? localVersion : remoteVersion);
    }
  }
  if (!candidates.length) throw new Error('version.no_common_version');
  return [...new Set(candidates)].sort(compareVersions).at(-1)!;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function assertExtensionsSupported(
  received: readonly ProtocolExtension[],
  supportedNamespaces: readonly string[],
): void {
  for (const extension of received) {
    if (extension.critical && !supportedNamespaces.includes(extension.namespace)) {
      throw new Error(`version.extension_unsupported:${extension.namespace}`);
    }
  }
}
