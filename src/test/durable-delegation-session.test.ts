import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DelegationSessionCoordinator,
  DelegationSessionError,
  DelegationSessionStore,
  InMemoryDelegationSessionRecordStore,
  type DelegationSession,
} from '../delegation-session.js';

const baseNow = new Date('2026-09-02T17:00:00.000Z');

function authority(delegationId: string, overrides: Record<string, unknown> = {}) {
  return {
    delegation_id: delegationId,
    delegation_expires_at: '2026-09-02T19:00:00.000Z',
    max_session_ms: 60 * 60 * 1000,
    idle_timeout_ms: 5 * 60 * 1000,
    scopes: ['commerce.purchase.create'],
    intents: ['Commerce.PurchaseProducts'],
    now: baseNow,
    ...overrides,
  };
}

test('caller cannot extend Human-authorized idle timeout through touch', () => {
  const sessions = new DelegationSessionStore();
  const session = sessions.create(authority('delegation:idle'));

  assert.equal(session.idle_timeout_ms, 5 * 60 * 1000);
  assert.throws(
    () => sessions.touch(session.session_id, 10 * 60 * 1000, new Date('2026-09-02T17:01:00.000Z')),
    (error: unknown) => error instanceof DelegationSessionError && error.code === 'session.idle_extension_denied',
  );

  const stricter = sessions.touch(
    session.session_id,
    2 * 60 * 1000,
    new Date('2026-09-02T17:01:00.000Z'),
  );
  assert.equal(stricter.idle_timeout_ms, 2 * 60 * 1000);
  assert.equal(stricter.idle_expires_at, '2026-09-02T17:03:00.000Z');
  assert.equal(stricter.revision, 2);
});

test('revocation is immediately visible across coordinators sharing a durable record store', async () => {
  const records = new InMemoryDelegationSessionRecordStore();
  const first = new DelegationSessionCoordinator(records);
  const second = new DelegationSessionCoordinator(records);
  const session = await first.create(authority('delegation:shared'));

  const observed = await second.assertActive(session.session_id, { scope: 'commerce.purchase.create' }, baseNow);
  assert.equal(observed.status, 'active');

  const revoked = await first.revoke(
    session.session_id,
    'human.revoked',
    new Date('2026-09-02T17:01:00.000Z'),
  );
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revision, 2);

  await assert.rejects(
    () => second.assertActive(session.session_id, {}, new Date('2026-09-02T17:01:01.000Z')),
    (error: unknown) => error instanceof DelegationSessionError && error.code === 'session.revoked',
  );
});

test('expiration is persisted with a monotonic CAS revision', async () => {
  const records = new InMemoryDelegationSessionRecordStore();
  const first = new DelegationSessionCoordinator(records);
  const second = new DelegationSessionCoordinator(records);
  const session = await first.create(authority('delegation:expiry', { idle_timeout_ms: 60_000 }));

  const expired = await second.get(session.session_id, new Date('2026-09-02T17:02:00.000Z'));
  assert.equal(expired.status, 'expired');
  assert.equal(expired.revision, 2);

  const seenByFirst = await first.get(session.session_id, new Date('2026-09-02T17:02:01.000Z'));
  assert.equal(seenByFirst.status, 'expired');
  assert.equal(seenByFirst.revision, 2);
});

class ConflictOnceStore extends InMemoryDelegationSessionRecordStore {
  private conflict = true;

  override compareAndSet(
    sessionId: string,
    expectedRevision: number,
    next: DelegationSession,
  ): boolean {
    if (this.conflict) {
      this.conflict = false;
      return false;
    }
    return super.compareAndSet(sessionId, expectedRevision, next);
  }
}

test('coordinator retries a compare-and-set conflict without losing authority invariants', async () => {
  const records = new ConflictOnceStore();
  const coordinator = new DelegationSessionCoordinator(records);
  const session = await coordinator.create(authority('delegation:cas-retry'));

  const touched = await coordinator.touch(
    session.session_id,
    undefined,
    new Date('2026-09-02T17:01:00.000Z'),
  );
  assert.equal(touched.revision, 2);
  assert.equal(touched.last_activity_at, '2026-09-02T17:01:00.000Z');
  assert.equal(touched.idle_expires_at, '2026-09-02T17:06:00.000Z');
});

test('concurrent revoke and touch cannot revive revoked authority', async () => {
  const records = new InMemoryDelegationSessionRecordStore();
  const first = new DelegationSessionCoordinator(records);
  const second = new DelegationSessionCoordinator(records);
  const session = await first.create(authority('delegation:revoke-race'));
  const now = new Date('2026-09-02T17:01:00.000Z');

  const outcomes = await Promise.allSettled([
    first.touch(session.session_id, undefined, now),
    second.revoke(session.session_id, 'human.revoked', now),
  ]);
  assert.ok(outcomes.some((outcome) => outcome.status === 'fulfilled'));

  const final = await first.get(session.session_id, new Date('2026-09-02T17:01:01.000Z'));
  assert.equal(final.status, 'revoked');
  await assert.rejects(
    () => first.touch(session.session_id, undefined, new Date('2026-09-02T17:01:02.000Z')),
    (error: unknown) => error instanceof DelegationSessionError && error.code === 'session.revoked',
  );
});

test('atomic renewal creates exactly one successor under concurrent attempts', async () => {
  const records = new InMemoryDelegationSessionRecordStore();
  const first = new DelegationSessionCoordinator(records);
  const second = new DelegationSessionCoordinator(records);
  const prior = await first.create(authority('delegation:prior'));
  const renewAt = new Date('2026-09-02T17:10:00.000Z');

  const outcomes = await Promise.allSettled([
    first.renew(prior.session_id, authority('delegation:new-a', { now: renewAt }), renewAt),
    second.renew(prior.session_id, authority('delegation:new-b', { now: renewAt }), renewAt),
  ]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const successor = fulfilled[0]?.status === 'fulfilled' ? fulfilled[0].value : undefined;
  assert.ok(successor);
  const updatedPrior = await records.load(prior.session_id);
  assert.equal(updatedPrior?.superseded_by_session_id, successor.session_id);
  assert.equal(updatedPrior?.status, 'revoked');
  assert.equal(successor.predecessor_session_id, prior.session_id);
  assert.ok(
    rejected[0]?.status === 'rejected'
    && rejected[0].reason instanceof DelegationSessionError
    && rejected[0].reason.code === 'session.already_superseded',
  );
});

test('renewal cannot reuse the same delegation identity as silent authority extension', async () => {
  const records = new InMemoryDelegationSessionRecordStore();
  const coordinator = new DelegationSessionCoordinator(records);
  const session = await coordinator.create(authority('delegation:same'));

  await assert.rejects(
    () => coordinator.renew(
      session.session_id,
      authority('delegation:same', { delegation_expires_at: '2026-09-02T20:00:00.000Z' }),
      new Date('2026-09-02T17:10:00.000Z'),
    ),
    (error: unknown) => error instanceof DelegationSessionError && error.code === 'session.reauthorization_required',
  );
});

test('durable record boundaries are cloned and caller mutation cannot alter authority', async () => {
  const records = new InMemoryDelegationSessionRecordStore();
  const coordinator = new DelegationSessionCoordinator(records);
  const session = await coordinator.create(authority('delegation:clone'));

  const copy = await records.load(session.session_id);
  assert.ok(copy);
  copy.scopes.push('forged.scope');
  copy.status = 'revoked';

  const canonical = await coordinator.get(session.session_id, baseNow);
  assert.equal(canonical.status, 'active');
  assert.deepEqual(canonical.scopes, ['commerce.purchase.create']);
});

test('non-finite or non-positive session durations fail closed', async () => {
  const coordinator = new DelegationSessionCoordinator(new InMemoryDelegationSessionRecordStore());
  await assert.rejects(
    () => coordinator.create(authority('delegation:nan', { max_session_ms: Number.NaN })),
    (error: unknown) => error instanceof DelegationSessionError && error.code === 'session.invalid_duration',
  );
  await assert.rejects(
    () => coordinator.create(authority('delegation:infinite-idle', { idle_timeout_ms: Number.POSITIVE_INFINITY })),
    (error: unknown) => error instanceof DelegationSessionError && error.code === 'session.invalid_idle_timeout',
  );
});
