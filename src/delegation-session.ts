import { randomUUID } from 'node:crypto';
import type { MaybePromise } from './types.js';

export type DelegationSessionStatus = 'active' | 'revoked' | 'expired';

export interface DelegationSession {
  session_id: string;
  delegation_id: string;
  /** Monotonic optimistic-concurrency revision. */
  revision: number;
  created_at: string;
  /** Original authority expiry, distinct from the shorter session expiry. */
  delegation_expires_at: string;
  expires_at: string;
  /** Human-authorized inactivity window; callers may only make it stricter. */
  idle_timeout_ms?: number;
  idle_expires_at?: string;
  last_activity_at: string;
  status: DelegationSessionStatus;
  scopes: string[];
  intents: string[];
  revoked_at?: string;
  revocation_reason?: string;
  predecessor_session_id?: string;
  superseded_by_session_id?: string;
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

function positiveFinite(value: number, code: string, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DelegationSessionError(code, `${label} must be a positive finite number of milliseconds`);
  }
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))];
}

function createSessionRecord(
  input: CreateDelegationSessionInput,
  now: Date,
  options: { session_id?: string; predecessor_session_id?: string } = {},
): DelegationSession {
  if (!input.delegation_id.trim()) {
    throw new DelegationSessionError('delegation.id_required', 'Delegation id is required');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new DelegationSessionError('session.now_invalid', 'Session clock value is invalid');
  }

  const delegationExpiry = new Date(input.delegation_expires_at);
  if (!Number.isFinite(delegationExpiry.getTime()) || delegationExpiry <= now) {
    throw new DelegationSessionError('delegation.expired', 'Cannot create a session from expired delegation authority');
  }
  positiveFinite(input.max_session_ms, 'session.invalid_duration', 'Session duration');
  if (input.idle_timeout_ms !== undefined) {
    positiveFinite(input.idle_timeout_ms, 'session.invalid_idle_timeout', 'Idle timeout');
  }

  const desiredExpiry = new Date(now.getTime() + input.max_session_ms);
  const expiresAt = desiredExpiry < delegationExpiry ? desiredExpiry : delegationExpiry;
  const idleExpiry = input.idle_timeout_ms !== undefined
    ? new Date(Math.min(now.getTime() + input.idle_timeout_ms, expiresAt.getTime()))
    : undefined;

  return {
    session_id: options.session_id ?? `session:${randomUUID()}`,
    delegation_id: input.delegation_id,
    revision: 1,
    created_at: now.toISOString(),
    delegation_expires_at: delegationExpiry.toISOString(),
    expires_at: expiresAt.toISOString(),
    ...(input.idle_timeout_ms !== undefined ? { idle_timeout_ms: input.idle_timeout_ms } : {}),
    ...(idleExpiry ? { idle_expires_at: idleExpiry.toISOString() } : {}),
    last_activity_at: now.toISOString(),
    status: 'active',
    scopes: normalizeList(input.scopes),
    intents: normalizeList(input.intents),
    ...(options.predecessor_session_id ? { predecessor_session_id: options.predecessor_session_id } : {}),
  };
}

function isExpired(session: DelegationSession, now: Date): boolean {
  const absoluteExpired = now >= new Date(session.expires_at);
  const idleExpired = session.idle_expires_at ? now >= new Date(session.idle_expires_at) : false;
  return absoluteExpired || idleExpired;
}

function assertRenewalAuthority(prior: DelegationSession, next: CreateDelegationSessionInput): void {
  // With this API there is no proof/version field capable of proving that the
  // same delegation id was re-issued. Requiring a new delegation id is the only
  // fail-closed way to prevent an Agent from repeatedly extending one grant.
  if (next.delegation_id === prior.delegation_id) {
    throw new DelegationSessionError(
      'session.reauthorization_required',
      'Renewal requires newly identifiable delegation authority and cannot reuse the previous delegation id',
    );
  }
}

function applyTouch(
  session: DelegationSession,
  requestedIdleTimeoutMs: number | undefined,
  now: Date,
): DelegationSession {
  if (session.status !== 'active') {
    throw new DelegationSessionError(`session.${session.status}`, `Cannot touch a ${session.status} session`);
  }
  if (requestedIdleTimeoutMs !== undefined) {
    positiveFinite(requestedIdleTimeoutMs, 'session.invalid_idle_timeout', 'Idle timeout');
    if (
      session.idle_timeout_ms !== undefined
      && requestedIdleTimeoutMs > session.idle_timeout_ms
    ) {
      throw new DelegationSessionError(
        'session.idle_extension_denied',
        'Caller cannot extend the Human-authorized idle timeout',
      );
    }
  }

  const effectiveIdleTimeout = requestedIdleTimeoutMs ?? session.idle_timeout_ms;
  const next = structuredClone(session);
  next.revision += 1;
  next.last_activity_at = now.toISOString();
  if (effectiveIdleTimeout !== undefined) {
    next.idle_timeout_ms = effectiveIdleTimeout;
    const absoluteExpiry = new Date(next.expires_at).getTime();
    next.idle_expires_at = new Date(
      Math.min(now.getTime() + effectiveIdleTimeout, absoluteExpiry),
    ).toISOString();
  }
  return next;
}

function expiredVersion(session: DelegationSession): DelegationSession {
  const next = structuredClone(session);
  next.revision += 1;
  next.status = 'expired';
  return next;
}

/**
 * Backward-compatible single-process reference API.
 *
 * For multi-process authority use `DelegationSessionCoordinator` with an
 * explicit `DelegationSessionRecordStore` implementation below.
 */
export class DelegationSessionStore {
  private readonly sessions = new Map<string, DelegationSession>();

  create(input: CreateDelegationSessionInput): DelegationSession {
    const now = input.now ?? new Date();
    const session = createSessionRecord(input, now);
    this.sessions.set(session.session_id, structuredClone(session));
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
    const next = applyTouch(session, idleTimeoutMs, now);
    this.sessions.set(sessionId, next);
    return structuredClone(next);
  }

  revoke(sessionId: string, reason = 'delegation.revoked', now: Date = new Date()): DelegationSession {
    const session = this.requireSession(sessionId);
    this.refreshStatus(session, now);
    if (session.status === 'expired' || session.status === 'revoked') {
      return structuredClone(session);
    }
    session.revision += 1;
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
    if (prior.superseded_by_session_id) {
      throw new DelegationSessionError('session.already_superseded', 'Delegation session already has a renewal successor');
    }
    assertRenewalAuthority(prior, newAuthority);
    const successor = createSessionRecord(
      { ...newAuthority, now },
      now,
      { predecessor_session_id: prior.session_id },
    );

    prior.revision += 1;
    prior.superseded_by_session_id = successor.session_id;
    if (prior.status === 'active') {
      prior.status = 'revoked';
      prior.revoked_at = now.toISOString();
      prior.revocation_reason = 'session.superseded';
    }
    this.sessions.set(successor.session_id, structuredClone(successor));
    return structuredClone(successor);
  }

  private requireSession(sessionId: string): DelegationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DelegationSessionError('session.not_found', `Unknown delegation session ${sessionId}`);
    }
    return session;
  }

  private refreshStatus(session: DelegationSession, now: Date): void {
    if (session.status !== 'active' || !isExpired(session, now)) return;
    const expired = expiredVersion(session);
    this.sessions.set(session.session_id, expired);
    Object.assign(session, expired);
  }
}

export type DelegationSessionCreateResult =
  | { status: 'created'; session: DelegationSession }
  | { status: 'exists'; session: DelegationSession };

/**
 * Durable persistence boundary for delegation authority state.
 *
 * `compareAndSet` and `replace` MUST be atomic in durable implementations.
 * `replace` updates the predecessor and creates its successor in one
 * transaction so concurrent renewals can never create two valid successors.
 */
export interface DelegationSessionRecordStore {
  load(sessionId: string): MaybePromise<DelegationSession | undefined>;
  create(session: DelegationSession): MaybePromise<DelegationSessionCreateResult>;
  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: DelegationSession,
  ): MaybePromise<boolean>;
  replace(
    priorSessionId: string,
    expectedPriorRevision: number,
    nextPrior: DelegationSession,
    successor: DelegationSession,
  ): MaybePromise<boolean>;
}

export class InMemoryDelegationSessionRecordStore implements DelegationSessionRecordStore {
  private readonly sessions = new Map<string, DelegationSession>();

  constructor(initial: readonly DelegationSession[] = []) {
    for (const session of initial) this.sessions.set(session.session_id, structuredClone(session));
  }

  load(sessionId: string): DelegationSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  create(session: DelegationSession): DelegationSessionCreateResult {
    const existing = this.sessions.get(session.session_id);
    if (existing) return { status: 'exists', session: structuredClone(existing) };
    this.sessions.set(session.session_id, structuredClone(session));
    return { status: 'created', session: structuredClone(session) };
  }

  compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: DelegationSession,
  ): boolean {
    const current = this.sessions.get(sessionId);
    if (!current || current.revision !== expectedRevision) return false;
    if (next.session_id !== sessionId || next.revision !== expectedRevision + 1) {
      throw new DelegationSessionError(
        'session.revision_invalid',
        'CAS update must preserve session identity and increment revision exactly once',
      );
    }
    this.sessions.set(sessionId, structuredClone(next));
    return true;
  }

  replace(
    priorSessionId: string,
    expectedPriorRevision: number,
    nextPrior: DelegationSession,
    successor: DelegationSession,
  ): boolean {
    const current = this.sessions.get(priorSessionId);
    if (!current || current.revision !== expectedPriorRevision) return false;
    if (this.sessions.has(successor.session_id)) return false;
    if (
      nextPrior.session_id !== priorSessionId
      || nextPrior.revision !== expectedPriorRevision + 1
      || nextPrior.superseded_by_session_id !== successor.session_id
      || successor.predecessor_session_id !== priorSessionId
    ) {
      throw new DelegationSessionError(
        'session.replacement_invalid',
        'Atomic renewal replacement has inconsistent predecessor/successor identity',
      );
    }
    this.sessions.set(priorSessionId, structuredClone(nextPrior));
    this.sessions.set(successor.session_id, structuredClone(successor));
    return true;
  }
}

export interface DelegationSessionCoordinatorOptions {
  max_cas_retries?: number;
}

/** Durable, multi-process-safe delegation session domain coordinator. */
export class DelegationSessionCoordinator {
  private readonly maxCasRetries: number;

  constructor(
    private readonly store: DelegationSessionRecordStore,
    options: DelegationSessionCoordinatorOptions = {},
  ) {
    this.maxCasRetries = options.max_cas_retries ?? 16;
    if (!Number.isSafeInteger(this.maxCasRetries) || this.maxCasRetries <= 0) {
      throw new DelegationSessionError('session.cas_retries_invalid', 'CAS retry count must be a positive safe integer');
    }
  }

  async create(input: CreateDelegationSessionInput): Promise<DelegationSession> {
    const now = input.now ?? new Date();
    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const session = createSessionRecord(input, now);
      const created = await this.store.create(session);
      if (created.status === 'created') return structuredClone(created.session);
    }
    throw new DelegationSessionError('session.id_collision', 'Unable to allocate a unique delegation session id');
  }

  async get(sessionId: string, now: Date = new Date()): Promise<DelegationSession> {
    return this.refresh(sessionId, now);
  }

  async assertActive(
    sessionId: string,
    request: { scope?: string; intent?: string } = {},
    now: Date = new Date(),
  ): Promise<DelegationSession> {
    const session = await this.refresh(sessionId, now);
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

  async touch(
    sessionId: string,
    idleTimeoutMs?: number,
    now: Date = new Date(),
  ): Promise<DelegationSession> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const current = await this.refresh(sessionId, now);
      const next = applyTouch(current, idleTimeoutMs, now);
      if (await this.store.compareAndSet(sessionId, current.revision, next)) {
        return structuredClone(next);
      }
    }
    throw new DelegationSessionError('session.concurrent_update', 'Delegation session changed too many times while touching');
  }

  async revoke(
    sessionId: string,
    reason = 'delegation.revoked',
    now: Date = new Date(),
  ): Promise<DelegationSession> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const current = await this.refresh(sessionId, now);
      if (current.status === 'expired' || current.status === 'revoked') return structuredClone(current);
      const next = structuredClone(current);
      next.revision += 1;
      next.status = 'revoked';
      next.revoked_at = now.toISOString();
      next.revocation_reason = reason;
      if (await this.store.compareAndSet(sessionId, current.revision, next)) return structuredClone(next);
    }
    throw new DelegationSessionError('session.concurrent_update', 'Delegation session changed too many times while revoking');
  }

  async requestRenewal(sessionId: string, now: Date = new Date()): Promise<RenewalRequest> {
    const session = await this.refresh(sessionId, now);
    return {
      renewal_request_id: `renewal:${randomUUID()}`,
      session_id: session.session_id,
      delegation_id: session.delegation_id,
      requested_at: now.toISOString(),
      requested_scopes: [...session.scopes],
      requested_intents: [...session.intents],
    };
  }

  async renew(
    priorSessionId: string,
    newAuthority: CreateDelegationSessionInput,
    now: Date = new Date(),
  ): Promise<DelegationSession> {
    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const prior = await this.refresh(priorSessionId, now);
      if (prior.superseded_by_session_id) {
        throw new DelegationSessionError('session.already_superseded', 'Delegation session already has a renewal successor');
      }
      assertRenewalAuthority(prior, newAuthority);

      const successor = createSessionRecord(
        { ...newAuthority, now },
        now,
        { predecessor_session_id: prior.session_id },
      );
      const nextPrior = structuredClone(prior);
      nextPrior.revision += 1;
      nextPrior.superseded_by_session_id = successor.session_id;
      if (nextPrior.status === 'active') {
        nextPrior.status = 'revoked';
        nextPrior.revoked_at = now.toISOString();
        nextPrior.revocation_reason = 'session.superseded';
      }

      if (await this.store.replace(prior.session_id, prior.revision, nextPrior, successor)) {
        return structuredClone(successor);
      }
    }
    throw new DelegationSessionError('session.concurrent_update', 'Delegation session changed too many times while renewing');
  }

  private async requireSession(sessionId: string): Promise<DelegationSession> {
    const session = await this.store.load(sessionId);
    if (!session) {
      throw new DelegationSessionError('session.not_found', `Unknown delegation session ${sessionId}`);
    }
    return session;
  }

  private async refresh(sessionId: string, now: Date): Promise<DelegationSession> {
    if (!Number.isFinite(now.getTime())) {
      throw new DelegationSessionError('session.now_invalid', 'Session clock value is invalid');
    }
    for (let attempt = 0; attempt < this.maxCasRetries; attempt += 1) {
      const current = await this.requireSession(sessionId);
      if (current.status !== 'active' || !isExpired(current, now)) return structuredClone(current);
      const next = expiredVersion(current);
      if (await this.store.compareAndSet(sessionId, current.revision, next)) return structuredClone(next);
    }
    throw new DelegationSessionError('session.concurrent_update', 'Delegation session changed too many times while expiring');
  }
}
