import assert from 'node:assert/strict';
import test from 'node:test';
import { HealingCoordinator, healingFingerprint } from '../healing.js';

test('healing fingerprint includes complete nested semantic value and ignores object insertion order', () => {
  const first = healingFingerprint({ outer: { a: 1, b: 2 }, list: [{ x: 'one' }] });
  const reordered = healingFingerprint({ list: [{ x: 'one' }], outer: { b: 2, a: 1 } });
  const nestedChange = healingFingerprint({ outer: { a: 1, b: 3 }, list: [{ x: 'one' }] });

  assert.equal(first, reordered);
  assert.notEqual(first, nestedChange);
  assert.ok(first.length >= 32);
});

test('reusing one coordinator starts every heal invocation with isolated visited and attempt state', async () => {
  const coordinator = new HealingCoordinator<{ value: number }>();
  const steps = [{
    canonical_label: 'Healing.Increment',
    apply: (input: { value: number }) => ({ value: input.value + 1 }),
  }];

  const first = await coordinator.heal({ value: 1 }, steps);
  const second = await coordinator.heal({ value: 1 }, steps);

  assert.deepEqual(first.value, { value: 2 });
  assert.deepEqual(second.value, { value: 2 });
  assert.equal(first.attempts.length, 1);
  assert.equal(second.attempts.length, 1);
  assert.equal(first.attempts[0]?.input_fingerprint, second.attempts[0]?.input_fingerprint);
});

test('duplicate step plus identical input within one invocation remains a cycle', async () => {
  const coordinator = new HealingCoordinator<{ value: string }>();
  const identity = {
    canonical_label: 'Healing.Identity',
    apply: (input: { value: string }) => ({ ...input }),
  };

  await assert.rejects(
    () => coordinator.heal({ value: 'same' }, [identity, identity]),
    /healing\.cycle_detected:Healing\.Identity/,
  );
});

test('returned attempts and escalations are isolated from caller mutation', async () => {
  const coordinator = new HealingCoordinator<{ value: number }>();
  const healed = await coordinator.heal({ value: 1 }, [{
    canonical_label: 'Healing.Increment',
    apply: (input) => ({ value: input.value + 1 }),
  }]);
  const canonicalFingerprint = healed.attempts[0]?.input_fingerprint;

  const escalation = coordinator.escalate({
    interaction_id: 'interaction:healing',
    correlation_id: 'correlation:healing',
    cause: { code: 'validation.failed', message: 'needs Human' },
    current_state: 'HEALING_REQUIRED',
    resume_state: 'EXECUTING',
    value: healed.value,
    attempts: healed.attempts,
  });

  healed.attempts[0]!.input_fingerprint = 'forged';
  healed.value.value = 999;

  assert.equal(escalation.attempts[0]?.input_fingerprint, canonicalFingerprint);
  assert.deepEqual(escalation.value, { value: 2 });
});

test('resolveWithHuman and cancel return new escalation values without mutating caller-owned record', () => {
  const coordinator = new HealingCoordinator<{ value: number }>();
  const original = coordinator.escalate({
    interaction_id: 'interaction:immutable-escalation',
    correlation_id: 'correlation:immutable-escalation',
    cause: { code: 'validation.failed', message: 'Human required' },
    current_state: 'HEALING_REQUIRED',
    resume_state: 'EXECUTING',
    value: { value: 1 },
    attempts: [],
  });

  const resolved = coordinator.resolveWithHuman(original, { value: 2 }, 'human-event:1');
  assert.notEqual(resolved, original);
  assert.equal(original.status, 'pending_human');
  assert.deepEqual(original.value, { value: 1 });
  assert.equal(original.human_event_ref, undefined);
  assert.equal(resolved.status, 'resolved');
  assert.deepEqual(resolved.value, { value: 2 });

  const cancelled = coordinator.cancel(original, 'human-event:2');
  assert.notEqual(cancelled, original);
  assert.equal(original.status, 'pending_human');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.human_event_ref, 'human-event:2');
});
