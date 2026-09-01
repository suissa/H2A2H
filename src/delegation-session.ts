import { randomUUID } from 'node:crypto';

export type DelegationSessionStatus = 'active' | 'revoked' | 'expired';

export interface DelegationSession {
  session_id: string;
  delegation_id: string;
  created_at: string;
  expires_at: string;
  idle_expires_at?: string;
  last_activity_at: string;
  status: DelegationSessionStatus;
  scopes: string[];
  intents: string[];
  revoked_at?: string;
  revocation_reason?: string;
}

export interface CreateDelegationSessionInput {
  delegation_id: string;
  delegation_expires_at: string;
  max_session_ms: number;
  idle_timeout_ms?: number;
  scopes?: string[];
  intents?: string[];
  now?: Date;
}

export interface RenewalRequest {
  renewal_request_id: string;
  session_id: string;
  delegation_id: string;
  requested_at: string;
  requested_scopes: string[];
  requested_intents: string[];
}

export class DelegationSessionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DelegationSessionError';
  }
}

export class DelegationSessionStore {
  private readonly sessions = new Map<string, DelegationSession>();

  create(input: CreateDelegationSessionInput): DelegationSession {
    const now = input.now ?? new Date();
    const delegationExpiry = new Date(input.delegation_expires_at);
    if (!Number.isFinite(delegationExpiry.getTime()) || delegationExpiry <= now) {
      throw new DelegationSessionError('delegation.expired', 'Cannot create a session from expired delegation authority');
    }
    if (input.max_session_ms <= 0) {
      throw new DelegationSessionError('session.invalid_duration', 'Session duration must be positive');
    }

    const desiredExpiry = new Date(now.getTime() + input.max_session_ms);
    const expiresAt = desiredExpiry < delegationExpiry ? desiredExpiry : delegationExpiry;
    const idleExpiry = input.idle_timeout_ms && input.idle_timeout_ms > 0
      ? new Date(Math.min(now.getTime() + input.idle_timeout_ms, expiresAt.getTime()))
      : undefined;

    const session: DelegationSession = {
      session_id: `session:${randomUUID()}`,
      delegation_id: input.delegation_id,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      last_activity_at: now.toISOString(),
      status: 'active',
      scopes: [...(input.scopes ?? [])],
      intents: [...(input.intents ?? [])],
      ...(idleExpiry ? { idle_expires_at: idleExpiry.toISOString() } : {}),
    };
    this.sessions.set(session.session_id, session);
    return structuredClone(session);
  }

  get(sessionId: string, now: Date = new Date()): DelegationSession {
    const session = this.requireSession(sessionId);
    this.refreshStatus(session, now);
    return structuredClone(session);
  }

  assertActive(
    sessionId: string,
    request: { scope?: string; intent?: string } = {},
    now: Date = new Date(),
  ): DelegationSession {
    const session = this.requireSession(sessionId);
    this.refreshStatus(session, now);
    if (session.status !== 'active') {
      throw new DelegationSessionError(`session.${session.status}`, `Delegation session is ${session.status}`);
    }
    if (request.scope && !session.scopes.includes(request.scope)) {
      throw new DelegationSessionError('session.scope_denied', `Scope ${request.scope} is not authorized by this session`);
    }
    if (request.intent && !session.intents.includes(request.intent)) {
      throw new DelegationSessionError('session.intent_denied', `Intent ${request.intent} is not authorized by this session`);
    }
    return structuredClone(session);
  }

  touch(sessionId: string, idleTimeoutMs?: number, now: Date = new Date()): DelegationSession {
    const session = this.requireSession(sessionId);
    this.refreshStatus(session, now);
    if (session.status !== 'active') {
      throw new DelegationSessionError(`session.${session.status}`, `Cannot touch a ${session.status} session`);
    }
    session.last_activity_at = now.toISOString();
    if (idleTimeoutMs && idleTimeoutMs > 0) {
      const absoluteExpiry = new Date(session.expires_at).getTime();
      session.idle_expires_at = new Date(Math.min(now.getTime() + idleTimeoutMs, absoluteExpiry)).toISOString();
    }
    return structuredClone(session);
  }

  revoke(sessionId: string, reason = 'delegation.revoked', now: Date = new Date()): DelegationSession {
    const session = this.requireSession(sessionId);
    this.refreshStatus(session, now);
    if (session.status === 'expired') {
      return structuredClone(session);
    }
    session.status = 'revoked';
    session.revoked_at = now.toISOString();
    session.revocation_reason = reason;
    return structuredClone(session);
  }

  requestRenewal(sessionId: string, now: Date = new Date()): RenewalRequest {
    const session = this.requireSession(sessionId);
    this.refreshStatus(session, now);
    return {
      renewal_request_id: `renewal:${randomUUID()}`,
      session_id: session.session_id,
      delegation_id: session.delegation_id,
      requested_at: now.toISOString(),
      requested_scopes: [...session.scopes],
      requested_intents: [...session.intents],
    };
  }

  renew(
    priorSessionId: string,
    newAuthority: CreateDelegationSessionInput,
    now: Date = new Date(),
  ): DelegationSession {
    const prior = this.requireSession(priorSessionId);
    this.refreshStatus(prior, now);
    if (newAuthority.delegation_id === prior.delegation_id && new Date(newAuthority.delegation_expires_at) <= new Date(prior.expires_at)) {
      throw new DelegationSessionError(
        'session.reauthorization_required',
        'Renewal must be backed by newly valid authority and cannot silently extend the previous session',
      );
    }
    if (prior.status === 'active') {
      this.revoke(priorSessionId, 'session.superseded', now);
    }
    return this.create({ ...newAuthority, now });
  }

  private requireSession(sessionId: string): DelegationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DelegationSessionError('session.not_found', `Unknown delegation session ${sessionId}`);
    }
    return session;
  }

  private refreshStatus(session: DelegationSession, now: Date): void {
    if (session.status !== 'active') return;
    const absoluteExpired = now >= new Date(session.expires_at);
    const idleExpired = session.idle_expires_at ? now >= new Date(session.idle_expires_at) : false;
    if (absoluteExpired || idleExpired) session.status = 'expired';
  }
}
