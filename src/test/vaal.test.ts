import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionCommitmentHash,
  createActionCommitment,
  createActionReceipt,
  delegationMandateHash,
  verifyActionAuthorization,
  type ActionMandate,
  type DelegationMandate,
} from '../vaal.js';
import { createHumanChallenge, createIntentTransitionTrace, satisfyHumanChallenge } from '../intent-trace.js';

const principal = { entity_id: 'human:123', kind: 'Human' as const, canonical_label: 'person.student' };
const agent = { entity_id: 'agent:123', kind: 'Agent' as const, canonical_label: 'education.personal_agent' };
const provider = { entity_id: 'school:123', kind: 'School' as const, canonical_label: 'education.school' };

function delegation(humanRequired = false): DelegationMandate {
  return {
    protocol: 'h2a2h.vaal',
    version: '1.0.0',
    type: 'delegation_mandate',
    mandate_id: 'dm-1',
    principal,
    delegate: agent,
    allowed_actions: ['education.course.enroll'],
    constraints: [
      {
        canonical_label: 'education.course.allowed',
        path: 'target.course_id',
        operator: 'one_of',
        value: ['course:distributed-systems', 'course:cryptography'],
      },
      {
        canonical_label: 'education.workload.max',
        path: 'parameters.hours_per_week',
        operator: 'max',
        value: 8,
      },
    ],
    ...(humanRequired ? { human_confirmation_required_for: ['education.course.enroll'] } : {}),
    issued_at: '2026-09-03T07:00:00.000Z',
    expires_at: '2026-09-04T07:00:00.000Z',
    proof_ref: 'proof:delegation',
  };
}

function commitment() {
  return createActionCommitment({
    commitment_id: 'ac-1',
    canonical_action: 'education.course.enroll',
    principal,
    agent,
    provider,
    target: { course_id: 'course:distributed-systems' },
    parameters: { hours_per_week: 6, credits: 4 },
    intent: { canonical_label: 'education.degree.progress', version: '1.0.0' },
    negotiated_capabilities_hash: 'negotiation:abc',
    state: { before_hash: 'state:before', version: '42' },
    created_at: '2026-09-03T08:00:00.000Z',
  });
}

function actionMandate(dm: DelegationMandate, ac = commitment()): ActionMandate {
  return {
    protocol: 'h2a2h.vaal',
    version: '1.0.0',
    type: 'action_mandate',
    mandate_id: 'am-1',
    principal,
    agent,
    canonical_action: 'education.course.enroll',
    delegation_mandate_hash: delegationMandateHash(dm),
    action_commitment_hash: actionCommitmentHash(ac),
    audience: [provider.entity_id],
    nonce: 'nonce-1',
    issued_at: '2026-09-03T08:00:01.000Z',
    expires_at: '2026-09-03T08:10:00.000Z',
    max_uses: 1,
    proof_ref: 'proof:action',
  };
}

test('allows an exact state/request-bound delegated action once', async () => {
  const dm = delegation();
  const ac = commitment();
  const am = actionMandate(dm, ac);
  const consumed = new Set<string>();
  const bindings = {
    verifyDelegationProof: async () => true,
    verifyActionProof: async () => true,
    consume: async (mandateId: string, nonce: string) => {
      const key = `${mandateId}:${nonce}`;
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    },
  };

  const first = await verifyActionAuthorization({
    delegation: dm,
    mandate: am,
    commitment: ac,
    bindings,
    now: new Date('2026-09-03T08:05:00.000Z'),
  });
  assert.equal(first.decision, 'ALLOW');

  const replay = await verifyActionAuthorization({
    delegation: dm,
    mandate: am,
    commitment: ac,
    bindings,
    now: new Date('2026-09-03T08:05:10.000Z'),
  });
  assert.equal(replay.decision, 'DENY');
  if (replay.decision === 'DENY') assert.equal(replay.code, 'vaal.replay.detected');
});

test('denies semantic mutation after the ActionMandate was bound', async () => {
  const dm = delegation();
  const original = commitment();
  const am = actionMandate(dm, original);
  const tampered = {
    ...original,
    target: { course_id: 'course:unapproved' },
  };
  const result = await verifyActionAuthorization({
    delegation: dm,
    mandate: am,
    commitment: tampered,
    bindings: {
      verifyDelegationProof: async () => true,
      verifyActionProof: async () => true,
      consume: async () => true,
    },
    now: new Date('2026-09-03T08:05:00.000Z'),
  });
  assert.equal(result.decision, 'DENY');
});

test('returns CHALLENGE when policy requires Human confirmation', async () => {
  const dm = delegation(true);
  const ac = commitment();
  const am = actionMandate(dm, ac);
  const result = await verifyActionAuthorization({
    delegation: dm,
    mandate: am,
    commitment: ac,
    bindings: {
      verifyDelegationProof: async () => true,
      verifyActionProof: async () => true,
      consume: async () => true,
    },
    now: new Date('2026-09-03T08:05:00.000Z'),
  });
  assert.equal(result.decision, 'CHALLENGE');
  if (result.decision === 'CHALLENGE') {
    assert.equal(result.challenge.canonical_label, 'authorization.human.confirm');
    assert.equal(result.challenge.action_commitment_hash, actionCommitmentHash(ac));
  }
});

test('binds Human challenge presentation and response to the same ActionCommitment', () => {
  const ac = commitment();
  const challenge = createHumanChallenge({
    challenge_id: 'challenge-1',
    canonical_label: 'authorization.human.confirm',
    interaction_id: 'interaction-1',
    action_commitment_hash: actionCommitmentHash(ac),
    subject: principal,
    provider,
    presented_payload: { course: ac.target, hours_per_week: 6 },
    created_at: '2026-09-03T08:05:00.000Z',
    expires_at: '2026-09-03T08:10:00.000Z',
  });
  const proof = satisfyHumanChallenge(challenge, { approved: true }, {
    satisfied_at: '2026-09-03T08:06:00.000Z',
    proof_ref: 'webauthn:proof-1',
  });
  assert.equal(proof.action_commitment_hash, actionCommitmentHash(ac));
  assert.equal(proof.presented_hash, challenge.presented_hash);
});

test('creates auditable semantic Intent traces and Action receipts', () => {
  const trace = createIntentTransitionTrace({
    trace_id: 'trace-1',
    interaction_id: 'interaction-1',
    intent: { canonical_label: 'education.degree.progress', version: '1.0.0' },
    actor: agent,
    transition: { from: 'EXECUTING', to: 'HUMAN_ESCALATION_REQUIRED' },
    reason: { canonical_label: 'authorization.human.required' },
    failed_constraints: ['education.course.human_confirmation'],
    alternatives_available: true,
    occurred_at: '2026-09-03T08:05:00.000Z',
  });
  assert.ok(trace.trace_hash.length > 20);

  const receipt = createActionReceipt({
    receipt_id: 'receipt-1',
    verifier: provider,
    executor: provider,
    principal,
    agent,
    canonical_action: 'education.course.enroll',
    mandate_hash: 'mandate:hash',
    action_commitment_hash: 'commitment:hash',
    executed_at: '2026-09-03T08:07:00.000Z',
    result: 'success',
    result_hash: 'result:hash',
    state: { before_hash: 'state:before', after_hash: 'state:after' },
  });
  assert.ok(receipt.receipt_hash.length > 20);
});
