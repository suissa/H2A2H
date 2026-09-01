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

export class ProtocolRegistry {
  private readonly artifacts = new Map<string, ProtocolArtifact>();

  register(id: string, artifact: ProtocolArtifact): void {
    if (!id.trim()) throw new ProtocolRegistryError('artifact.id_required', 'Artifact id is required');
    if (!artifact.protocol?.trim()) throw new ProtocolRegistryError('artifact.protocol_required', 'Artifact protocol is required');
    if (!artifact.version?.trim()) throw new ProtocolRegistryError('artifact.version_required', 'Artifact version is required');
    this.artifacts.set(id, structuredClone(artifact));
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
    const artifact = this.get<T>(id);
    if (artifact.protocol !== protocol) {
      throw new ProtocolRegistryError('artifact.protocol_mismatch', `Expected ${protocol}, received ${artifact.protocol}`);
    }
    const major = Number.parseInt(artifact.version.split('.')[0] ?? '', 10);
    if (!Number.isFinite(major) || major !== compatibleMajor) {
      throw new ProtocolRegistryError('artifact.version_incompatible', `Artifact ${id} is not compatible with ${compatibleMajor}.x`);
    }
    return artifact;
  }

  list(protocol?: string): Array<{ id: string; protocol: string; version: string }> {
    return [...this.artifacts.entries()]
      .filter(([, artifact]) => !protocol || artifact.protocol === protocol)
      .map(([id, artifact]) => ({ id, protocol: artifact.protocol, version: artifact.version }));
  }
}
