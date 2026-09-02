import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryReplayRecordStore,
  ReplayProtectionError,
  ReplayProtector,
  type ReplayAcceptance,
  type ReplayRecord,
  type ReplayRecordStore,
} from '../security.js';
import type { MaybePromise } from '../types.js';

const now = new Date('2026-09-02T17:00:00.000Z');
const expiry = new Date('2026-09-02T17:05:00.000Z');

test('two protectors sharing one store reject the same live replay identity across workers', async () => {
  const store = new InMemoryReplayRecordStore();
  const first = new ReplayProtector(store);
  const second = new ReplayProtector(store);

  await first.accept('msg:shared', expiry, now);
  await assert.rejects(
    () => second.accept('msg:shared', expiry, new Date('2026-09-02T17:00:01.000Z')),
    (error: unknown) => error instanceof ReplayProtectionError && error.code === 'security.replay',
  );
  assert.equal(await second.has('msg:shared', now), true);
});

test('simultaneous acceptance has exactly one winner because uniqueness is one atomic store operation', async () => {
  const store = new InMemoryReplayRecordStore();
  const first = new ReplayProtector(store);
  const second = new ReplayProtector(store);

  const outcomes = await Promise.allSettled([
    first.accept('msg:race', expiry, now),
    second.accept('msg:race', expiry, now),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
});

test('identity may be reused exactly at or after canonical expiry', async () => {
  const store = new InMemoryReplayRecordStore();
  const protector = new ReplayProtector(store);
  await protector.accept('msg:reuse', expiry, now);

  await assert.rejects(
    () => protector.accept('msg:reuse', new Date('2026-09-02T17:10:00.000Z'), new Date('2026-09-02T17:04:59.999Z')),
    (error: unknown) => error instanceof ReplayProtectionError && error.code === 'security.replay',
  );

  const reused = await protector.accept(
    'msg:reuse',
    new Date('2026-09-02T17:10:00.000Z'),
    new Date('2026-09-02T17:05:00.000Z'),
  );
  assert.equal(reused.accepted_at, '2026-09-02T17:05:00.000Z');
  assert.equal(reused.expires_at, '2026-09-02T17:10:00.000Z');
});

test('replay store returns cloned records so caller mutation cannot alter canonical expiry', async () => {
  const store = new InMemoryReplayRecordStore();
  const protector = new ReplayProtector(store);
  const accepted = await protector.accept('msg:clone', expiry, now);
  accepted.expires_at = '2026-09-02T16:00:00.000Z';

  assert.equal(await protector.has('msg:clone', new Date('2026-09-02T17:01:00.000Z')), true);
  const canonical = store.load('msg:clone');
  assert.equal(canonical?.expires_at, expiry.toISOString());
});

class CountingAtomicStore implements ReplayRecordStore {
  calls = 0;
  private readonly inner = new InMemoryReplayRecordStore();

  accept(record: ReplayRecord, at: Date): MaybePromise<ReplayAcceptance> {
    this.calls += 1;
    return this.inner.accept(record, at);
  }
}

test('ReplayProtector does not require a preflight has lookup before atomic accept', async () => {
  const store = new CountingAtomicStore();
  const protector = new ReplayProtector(store);
  await protector.accept('msg:no-preflight', expiry, now);
  assert.equal(store.calls, 1);
});

test('empty identity, invalid dates and expired acceptance fail closed before store mutation', async () => {
  const store = new CountingAtomicStore();
  const protector = new ReplayProtector(store);

  await assert.rejects(
    () => protector.accept('   ', expiry, now),
    (error: unknown) => error instanceof ReplayProtectionError && error.code === 'security.replay.identity_required',
  );
  await assert.rejects(
    () => protector.accept('msg:bad-expiry', new Date(Number.NaN), now),
    (error: unknown) => error instanceof ReplayProtectionError && error.code === 'security.replay.expiry_invalid',
  );
  await assert.rejects(
    () => protector.accept('msg:bad-now', expiry, new Date(Number.NaN)),
    (error: unknown) => error instanceof ReplayProtectionError && error.code === 'security.replay.now_invalid',
  );
  await assert.rejects(
    () => protector.accept('msg:expired', now, now),
    (error: unknown) => error instanceof ReplayProtectionError && error.code === 'security.expired',
  );
  assert.equal(store.calls, 0);
});
