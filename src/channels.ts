import type { H2A2HEnvelope } from './types.js';

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

function defaultCapabilities(declaration: ChannelDeclaration): ChannelCapabilities {
  return {
    mode: declaration.mode,
    ordered: declaration.capabilities?.ordered ?? false,
    reliable: declaration.capabilities?.reliable ?? false,
    streaming: declaration.capabilities?.streaming ?? declaration.mode === 'stream',
  };
}

export class InjectedTransportAdapter implements ChannelAdapter {
  constructor(
    readonly declaration: ChannelDeclaration,
    private readonly driver: TransportDriver,
  ) {}

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
  private readonly address: string;

  constructor(
    readonly declaration: ChannelDeclaration,
    private readonly hub: InMemoryHub = globalInMemoryHub,
  ) {
    this.address = String(declaration.endpoint?.['address'] ?? declaration.channel_id);
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
  private readonly url: string;

  constructor(readonly declaration: ChannelDeclaration) {
    const url = declaration.endpoint?.['url'];
    if (typeof url !== 'string' || !url) throw new Error('channel.http.url_required');
    this.url = url;
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
    this.factories.set(transport, factory);
  }

  forge(declaration: ChannelDeclaration): ChannelAdapter {
    this.validateDeclaration(declaration);
    const factory = this.factories.get(declaration.transport);
    if (!factory) throw new Error(`channel.adapter_unavailable:${declaration.transport}`);
    return factory(declaration);
  }

  resolve(
    requiredProfiles: readonly string[],
    declarations: readonly ChannelDeclaration[],
  ): ChannelAdapter {
    for (const declaration of declarations) {
      if (!requiredProfiles.some((profile) => this.versionMatches(profile, declaration.versions))) continue;
      if (!this.factories.has(declaration.transport)) continue;
      return this.forge(declaration);
    }
    throw new Error('channel.no_compatible_binding');
  }

  private validateDeclaration(declaration: ChannelDeclaration): void {
    if (!declaration.channel_id) throw new Error('channel.id_required');
    if (!declaration.transport) throw new Error('channel.transport_required');
    if (!declaration.versions.length) throw new Error('channel.version_required');
    if (!declaration.security?.profile) throw new Error('channel.security_profile_required');
  }

  private versionMatches(required: string, supported: readonly string[]): boolean {
    const requiredMajor = required.split('.')[0];
    return supported.some((version) => version === required || version === `${requiredMajor}.x` || version.split('.')[0] === requiredMajor);
  }
}
