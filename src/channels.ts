import type { H2A2HEnvelope } from './types.js';
import { negotiateVersion, parseVersion } from './versioning.js';

export type ChannelTransport =
  | 'in-memory'
  | 'http'
  | 'https'
  | 'websocket'
  | 'sse'
  | 'grpc'
  | 'quic'
  | 'nats'
  | 'mcp'
  | (string & {});

export interface ChannelDeclaration {
  channel_id: string;
  transport: ChannelTransport;
  mode: 'request_reply' | 'pub_sub' | 'stream' | 'datagram';
  endpoint?: Record<string, unknown>;
  versions: string[];
  security: { profile: string };
  capabilities?: {
    ordered?: boolean;
    reliable?: boolean;
    streaming?: boolean;
    max_payload_bytes?: number;
  };
}

export interface ChannelCapabilities {
  mode: ChannelDeclaration['mode'];
  ordered: boolean;
  reliable: boolean;
  streaming: boolean;
}

export type ChannelHandler = (envelope: H2A2HEnvelope) => void | Promise<void>;

export interface ChannelAdapter {
  readonly declaration: ChannelDeclaration;
  capabilities(): ChannelCapabilities;
  send(envelope: H2A2HEnvelope): Promise<void>;
  request(envelope: H2A2HEnvelope): Promise<H2A2HEnvelope>;
  subscribe?(handler: ChannelHandler): Promise<() => void> | (() => void);
  close(): Promise<void>;
}

export interface TransportDriver {
  send(declaration: ChannelDeclaration, envelope: H2A2HEnvelope): Promise<void>;
  request(declaration: ChannelDeclaration, envelope: H2A2HEnvelope): Promise<H2A2HEnvelope>;
  subscribe?(declaration: ChannelDeclaration, handler: ChannelHandler): Promise<() => void> | (() => void);
  close?(declaration: ChannelDeclaration): Promise<void> | void;
}

export type AdapterFactory = (declaration: ChannelDeclaration) => ChannelAdapter;

const MODES = new Set<ChannelDeclaration['mode']>(['request_reply', 'pub_sub', 'stream', 'datagram']);
const WILDCARD_VERSION = /^(?:0|[1-9]\d*)\.x$/;

function assertVersionSelector(version: string): void {
  if (WILDCARD_VERSION.test(version)) return;
  try {
    parseVersion(version);
  } catch {
    throw new Error(`channel.version_invalid:${version}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateChannelDeclaration(declaration: ChannelDeclaration): void {
  if (!declaration || typeof declaration !== 'object') throw new Error('channel.declaration_required');
  if (!declaration.channel_id?.trim()) throw new Error('channel.id_required');
  if (typeof declaration.transport !== 'string' || !declaration.transport.trim()) throw new Error('channel.transport_required');
  if (!MODES.has(declaration.mode)) throw new Error(`channel.mode_invalid:${String(declaration.mode)}`);
  if (!Array.isArray(declaration.versions) || declaration.versions.length === 0) throw new Error('channel.version_required');
  for (const version of declaration.versions) {
    if (typeof version !== 'string' || !version.trim()) throw new Error('channel.version_required');
    assertVersionSelector(version);
  }
  if (!declaration.security?.profile?.trim()) throw new Error('channel.security_profile_required');

  const maximum = declaration.capabilities?.max_payload_bytes;
  if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum <= 0)) {
    throw new Error('channel.max_payload_bytes_invalid');
  }

  if (declaration.transport === 'in-memory') {
    const address = declaration.endpoint?.['address'];
    if (address !== undefined && (typeof address !== 'string' || !address.trim())) {
      throw new Error('channel.in_memory.address_invalid');
    }
  }

  if (declaration.transport === 'http' || declaration.transport === 'https') {
    const rawUrl = declaration.endpoint?.['url'];
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('channel.http.url_required');
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('channel.http.url_invalid');
    }
    if (url.protocol !== `${declaration.transport}:`) {
      throw new Error('channel.http.transport_mismatch');
    }
  }
}

export function snapshotChannelDeclaration(declaration: ChannelDeclaration): ChannelDeclaration {
  validateChannelDeclaration(declaration);
  try {
    return deepFreeze(structuredClone(declaration));
  } catch {
    throw new Error('channel.declaration_not_cloneable');
  }
}

function defaultCapabilities(declaration: ChannelDeclaration): ChannelCapabilities {
  return {
    mode: declaration.mode,
    ordered: declaration.capabilities?.ordered ?? false,
    reliable: declaration.capabilities?.reliable ?? false,
    streaming: declaration.capabilities?.streaming ?? declaration.mode === 'stream',
  };
}

export class InjectedTransportAdapter implements ChannelAdapter {
  readonly declaration: ChannelDeclaration;

  constructor(
    declaration: ChannelDeclaration,
    private readonly driver: TransportDriver,
  ) {
    this.declaration = snapshotChannelDeclaration(declaration);
  }

  capabilities(): ChannelCapabilities {
    return defaultCapabilities(this.declaration);
  }

  send(envelope: H2A2HEnvelope): Promise<void> {
    return this.driver.send(this.declaration, envelope);
  }

  request(envelope: H2A2HEnvelope): Promise<H2A2HEnvelope> {
    if (this.declaration.mode !== 'request_reply') {
      return Promise.reject(new Error('channel.request_not_supported'));
    }
    return this.driver.request(this.declaration, envelope);
  }

  subscribe(handler: ChannelHandler): Promise<() => void> | (() => void) {
    if (!this.driver.subscribe) throw new Error('channel.subscribe_not_supported');
    return this.driver.subscribe(this.declaration, handler);
  }

  async close(): Promise<void> {
    await this.driver.close?.(this.declaration);
  }
}

class InMemoryHub {
  private readonly handlers = new Map<string, Set<ChannelHandler>>();
  private readonly responders = new Map<string, (envelope: H2A2HEnvelope) => H2A2HEnvelope | Promise<H2A2HEnvelope>>();

  subscribe(address: string, handler: ChannelHandler): () => void {
    const set = this.handlers.get(address) ?? new Set<ChannelHandler>();
    set.add(handler);
    this.handlers.set(address, set);
    return () => set.delete(handler);
  }

  respond(address: string, handler: (envelope: H2A2HEnvelope) => H2A2HEnvelope | Promise<H2A2HEnvelope>): () => void {
    this.responders.set(address, handler);
    return () => this.responders.delete(address);
  }

  async send(address: string, envelope: H2A2HEnvelope): Promise<void> {
    for (const handler of this.handlers.get(address) ?? []) await handler(envelope);
  }

  async request(address: string, envelope: H2A2HEnvelope): Promise<H2A2HEnvelope> {
    const responder = this.responders.get(address);
    if (!responder) throw new Error(`channel.in_memory.no_responder:${address}`);
    return responder(envelope);
  }
}

export const globalInMemoryHub = new InMemoryHub();

export class InMemoryChannelAdapter implements ChannelAdapter {
  readonly declaration: ChannelDeclaration;
  private readonly address: string;

  constructor(
    declaration: ChannelDeclaration,
    private readonly hub: InMemoryHub = globalInMemoryHub,
  ) {
    this.declaration = snapshotChannelDeclaration(declaration);
    this.address = String(this.declaration.endpoint?.['address'] ?? this.declaration.channel_id);
  }

  capabilities(): ChannelCapabilities {
    return { mode: this.declaration.mode, ordered: true, reliable: true, streaming: this.declaration.mode === 'stream' };
  }

  send(envelope: H2A2HEnvelope): Promise<void> {
    return this.hub.send(this.address, envelope);
  }

  request(envelope: H2A2HEnvelope): Promise<H2A2HEnvelope> {
    return this.hub.request(this.address, envelope);
  }

  subscribe(handler: ChannelHandler): () => void {
    return this.hub.subscribe(this.address, handler);
  }

  respond(handler: (envelope: H2A2HEnvelope) => H2A2HEnvelope | Promise<H2A2HEnvelope>): () => void {
    return this.hub.respond(this.address, handler);
  }

  async close(): Promise<void> {}
}

export class HttpChannelAdapter implements ChannelAdapter {
  readonly declaration: ChannelDeclaration;
  private readonly url: string;

  constructor(declaration: ChannelDeclaration) {
    this.declaration = snapshotChannelDeclaration(declaration);
    this.url = String(this.declaration.endpoint?.['url']);
  }

  capabilities(): ChannelCapabilities {
    return { mode: this.declaration.mode, ordered: false, reliable: true, streaming: false };
  }

  async send(envelope: H2A2HEnvelope): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'h2a2h-version': envelope.version },
      body: JSON.stringify(envelope),
    });
    if (!response.ok) throw new Error(`channel.http.${response.status}`);
  }

  async request(envelope: H2A2HEnvelope): Promise<H2A2HEnvelope> {
    if (this.declaration.mode !== 'request_reply') throw new Error('channel.request_not_supported');
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json', 'h2a2h-version': envelope.version },
      body: JSON.stringify(envelope),
    });
    if (!response.ok) throw new Error(`channel.http.${response.status}`);
    return await response.json() as H2A2HEnvelope;
  }

  async close(): Promise<void> {}
}

export class ChannelForger {
  private readonly factories = new Map<string, AdapterFactory>();

  constructor(drivers: Partial<Record<ChannelTransport, TransportDriver>> = {}) {
    this.register('in-memory', (declaration) => new InMemoryChannelAdapter(declaration));
    this.register('http', (declaration) => new HttpChannelAdapter(declaration));
    this.register('https', (declaration) => new HttpChannelAdapter(declaration));

    for (const transport of ['websocket', 'sse', 'grpc', 'quic', 'nats', 'mcp'] as const) {
      const driver = drivers[transport];
      if (driver) this.register(transport, (declaration) => new InjectedTransportAdapter(declaration, driver));
    }
  }

  register(transport: ChannelTransport, factory: AdapterFactory): void {
    if (!String(transport).trim()) throw new Error('channel.transport_required');
    if (this.factories.has(transport)) throw new Error(`channel.factory_already_registered:${transport}`);
    this.factories.set(transport, factory);
  }

  forge(declaration: ChannelDeclaration): ChannelAdapter {
    const snapshot = snapshotChannelDeclaration(declaration);
    const factory = this.factories.get(snapshot.transport);
    if (!factory) throw new Error(`channel.adapter_unavailable:${snapshot.transport}`);
    return factory(snapshot);
  }

  resolve(
    requiredVersions: readonly string[],
    declarations: readonly ChannelDeclaration[],
  ): ChannelAdapter {
    if (requiredVersions.length === 0) throw new Error('channel.required_version_missing');
    for (const version of requiredVersions) assertVersionSelector(version);

    for (const declaration of declarations) {
      const snapshot = snapshotChannelDeclaration(declaration);
      if (!this.factories.has(snapshot.transport)) continue;
      try {
        negotiateVersion(requiredVersions, snapshot.versions);
      } catch (error) {
        if (error instanceof Error && error.message === 'version.no_common_version') continue;
        throw error;
      }
      const factory = this.factories.get(snapshot.transport)!;
      return factory(snapshot);
    }
    throw new Error('channel.no_compatible_binding');
  }
}
