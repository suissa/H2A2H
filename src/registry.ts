import { canonicalJson } from './security.js';
import { parseVersion } from './versioning.js';

export interface ProtocolArtifact {
  protocol: string;
  version: string;
  [key: string]: unknown;
}

export class ProtocolRegistryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ProtocolRegistryError';
  }
}

function validateArtifact(id: string, artifact: ProtocolArtifact): void {
  if (!id.trim()) throw new ProtocolRegistryError('artifact.id_required', 'Artifact id is required');
  if (!artifact.protocol?.trim()) throw new ProtocolRegistryError('artifact.protocol_required', 'Artifact protocol is required');
  if (!artifact.version?.trim()) throw new ProtocolRegistryError('artifact.version_required', 'Artifact version is required');
  try {
    parseVersion(artifact.version);
  } catch {
    throw new ProtocolRegistryError('artifact.version_invalid', `Artifact ${id} has invalid semantic version ${artifact.version}`);
  }
}

export class ProtocolRegistry {
  private readonly artifacts = new Map<string, ProtocolArtifact>();
  private sealed = false;

  constructor(initial: Readonly<Record<string, ProtocolArtifact>> = {}) {
    for (const id of Object.keys(initial).sort()) {
      this.register(id, initial[id]!);
    }
  }

  /**
   * Register one canonical protocol artifact.
   *
   * Artifact ids are write-once. Re-registering the exact same canonical
   * artifact is idempotent, while any replacement with different semantic
   * content fails closed.
   */
  register(id: string, artifact: ProtocolArtifact): void {
    if (this.sealed) {
      throw new ProtocolRegistryError('registry.sealed', 'Protocol registry is sealed and cannot be modified');
    }
    validateArtifact(id, artifact);

    const existing = this.artifacts.get(id);
    if (existing) {
      if (canonicalJson(existing) === canonicalJson(artifact)) return;
      throw new ProtocolRegistryError('artifact.already_registered', `Artifact ${id} is already registered with different content`);
    }

    this.artifacts.set(id, structuredClone(artifact));
  }

  seal(): void {
    this.sealed = true;
  }

  isSealed(): boolean {
    return this.sealed;
  }

  get<T extends ProtocolArtifact = ProtocolArtifact>(id: string): T {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new ProtocolRegistryError('artifact.not_found', `Unknown protocol artifact ${id}`);
    return structuredClone(artifact) as T;
  }

  requireProtocol<T extends ProtocolArtifact = ProtocolArtifact>(
    id: string,
    protocol: string,
    compatibleMajor: number,
  ): T {
    if (!protocol.trim()) {
      throw new ProtocolRegistryError('artifact.protocol_required', 'Required protocol is required');
    }
    if (!Number.isSafeInteger(compatibleMajor) || compatibleMajor < 0) {
      throw new ProtocolRegistryError('artifact.compatible_major_invalid', 'Compatible protocol major must be a non-negative safe integer');
    }

    const artifact = this.get<T>(id);
    if (artifact.protocol !== protocol) {
      throw new ProtocolRegistryError('artifact.protocol_mismatch', `Expected ${protocol}, received ${artifact.protocol}`);
    }

    let major: number;
    try {
      major = parseVersion(artifact.version).major;
    } catch {
      throw new ProtocolRegistryError('artifact.version_invalid', `Artifact ${id} has invalid semantic version ${artifact.version}`);
    }
    if (major !== compatibleMajor) {
      throw new ProtocolRegistryError('artifact.version_incompatible', `Artifact ${id} is not compatible with ${compatibleMajor}.x`);
    }
    return artifact;
  }

  list(protocol?: string): Array<{ id: string; protocol: string; version: string }> {
    return [...this.artifacts.entries()]
      .filter(([, artifact]) => !protocol || artifact.protocol === protocol)
      .map(([id, artifact]) => ({ id, protocol: artifact.protocol, version: artifact.version }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
