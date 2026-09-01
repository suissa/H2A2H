export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface ProtocolExtension {
  namespace: string;
  critical: boolean;
}

export function parseVersion(version: string): SemanticVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`version.invalid:${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isProtocolCompatible(local: string, remote: string): boolean {
  return parseVersion(local).major === parseVersion(remote).major;
}

export function negotiateVersion(local: readonly string[], remote: readonly string[]): string {
  const exact = local.filter((version) => remote.includes(version));
  if (exact.length) {
    return exact.sort(compareVersions).at(-1)!;
  }

  const candidates: string[] = [];
  for (const localVersion of local) {
    for (const remoteVersion of remote) {
      if (localVersion.endsWith('.x') || remoteVersion.endsWith('.x')) {
        const localMajor = Number(localVersion.split('.')[0]);
        const remoteMajor = Number(remoteVersion.split('.')[0]);
        if (Number.isFinite(localMajor) && localMajor === remoteMajor) {
          const concrete = localVersion.endsWith('.x') ? remoteVersion : localVersion;
          if (!concrete.endsWith('.x')) candidates.push(concrete);
        }
      } else if (isProtocolCompatible(localVersion, remoteVersion)) {
        candidates.push(compareVersions(localVersion, remoteVersion) <= 0 ? localVersion : remoteVersion);
      }
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
