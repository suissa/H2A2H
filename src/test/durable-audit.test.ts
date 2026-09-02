import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuditTrail,
  AuditTrailError,
  InMemoryAuditRecordStore,
  createAuditRecord,
  type AuditAppendResult,
  type AuditRecord,
  type AuditRecordStore,
} from '../audit.js';
import { InMemoryInteractionCheckpointStore } from '../interaction-checkpoint.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef, MaybePromise, RuntimeBindings } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:durable-audit-owner',
  kind: 'Human',
  canonical_label: 'Human.DurableAuditOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:durable-audit-worker',
  kind: 'Agent',
  canonical_label: 'Agent.DurableAuditWorker',
};

interface Input {
  delegation_ref?: string;
  value: string;
}

interface Output {
  accepted: string;
}

function bindings(): RuntimeBindings<Input, Output> {
  return {
    resolveIntent: () => ({
      ref: { canonical_label: 'Audit.DurableExample', version: '1.0.0' },
      input_schema: 'schema://audit/input',
      output_schema: 'schema://audit/output',
    }),
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:valid'
      ? { valid: true, delegation_id: 'delegation:valid', evidence: ['delegation-proof:valid'] }
      : { valid: false, reason: 'delegation.missing' },
    resolveParticipants: () => ({
      sender: agent,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:durable-audit-owner',
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    execute: (context) => ({ accepted: context.input.value }),
    returnToHuman: (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
    validateHumanAction: (_context, action, expected) => ({
      valid:
        action.actor.entity_id === human.entity_id
        && action.canonical_label === expected.canonical_label
        && action.evidence.includes('human-proof:valid'),
      evidence: action.evidence,
      reason: 'human.resume.evidence_invalid',
    }),
  };
}

class FailOnceAuditStore implements AuditRecordStore {
  private failed = false;

  constructor(
    private readonly inner: AuditRecordStore,
    private readonly failSequence: number,
  ) {}

  load(interactionId: string): MaybePromise<AuditRecord[]> {
    return this.inner.load(interactionId);
  }

  append(record: AuditRecord): MaybePromise<AuditAppendResult> {
    if (!this.failed && record.sequence === this.failSequence) {
      this.failed = true;
      throw new AuditTrailError('audit.test_crash', 'simulated crash after checkpoint before audit append');
    }
    return this.inner.append(record);
  }
}

test('AuditTrail maintains independent digest chains for multiple interactions', () => {
  const audit = new AuditTrail();
  for (const interaction of ['interaction:a', 'interaction:b']) {
    audit.append({
      interaction_id: interaction,
      correlation_id: `correlation:${interaction.at(-1)}`,
      event: 'h2a2h.lifecycle.created',
      timestamp: '2026-09-02T17:00:00.000Z',
    });
    audit.append({
      interaction_id: interaction,
      correlation_id: `correlation:${interaction.at(-1)}`,
      event: 'h2a2h.lifecycle.closed',
      timestamp: '2026-09-02T17:00:01.000Z',
    });
  }

  assert.equal(audit.export('interaction:a').length, 2);
  assert.equal(audit.export('interaction:b').length, 2);
  assert.equal(audit.export().length, 4);
  assert.deepEqual(audit.verify(), { valid: true });
});

test('durable audit store is idempotent for exact replay and rejects a conflicting record at the same sequence', () => {
  const store = new InMemoryAuditRecordStore();
  const canonical = createAuditRecord({
    interaction_id: 'interaction:store',
    correlation_id: 'correlation:store',
    sequence: 0,
    event: 'h2a2h.lifecycle.created',
    timestamp: '2026-09-02T17:01:00.000Z',
  });

  assert.equal(store.append(canonical).status, 'appended');
  assert.equal(store.append(canonical).status, 'duplicate');

  const conflicting = createAuditRecord({
    interaction_id: 'interaction:store',
    correlation_id: 'correlation:store',
    sequence: 0,
    event: 'forged.lifecycle.created',
    timestamp: '2026-09-02T17:01:00.000Z',
  });
  assert.throws(() => store.append(conflicting), /sequence.*different|sequence_conflict/i);
});

test('one SDK can run multiple interactions while preserving independently valid audit chains', async () => {
  const sdk = new H2A2HSDK(bindings());

  for (const suffix of ['one', 'two']) {
    const result = await sdk.run({
      initiating_human: human,
      interaction_id: `interaction:multi:${suffix}`,
      correlation_id: `correlation:multi:${suffix}`,
      intent: { canonical_label: 'Audit.DurableExample', version: '1.0.0' },
      input: { delegation_ref: 'delegation:valid', value: suffix },
    });
    assert.equal(result.state, 'CLOSED');
  }

  assert.equal(sdk.getAudit('interaction:multi:one').length, 9);
  assert.equal(sdk.getAudit('interaction:multi:two').length, 9);
  assert.equal(sdk.getAudit().length, 18);
  assert.deepEqual(sdk.verifyAudit(), { valid: true });
});

test('a replacement SDK hydrates and continues the same audit chain during Human resume', async () => {
  const checkpoints = new InMemoryInteractionCheckpointStore<Input, Output>();
  const auditStore = new InMemoryAuditRecordStore();
  const first = new H2A2HSDK(bindings(), {
    checkpoint_store: checkpoints,
    audit_store: auditStore,
  });

  const escalated = await first.run({
    initiating_human: human,
    interaction_id: 'interaction:cross-process-audit',
    correlation_id: 'correlation:cross-process-audit',
    intent: { canonical_label: 'Audit.DurableExample', version: '1.0.0' },
    input: { value: 'needs authority' },
  });
  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');
  const before = first.getAudit(escalated.interaction_id);
  assert.ok(before.length > 0);

  const replacement = new H2A2HSDK(bindings(), {
    checkpoint_store: checkpoints,
    audit_store: auditStore,
  });
  const resumed = await replacement.resume(escalated.interaction_id, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:valid'],
    },
    input: { delegation_ref: 'delegation:valid', value: 'resumed' },
  });

  assert.equal(resumed.state, 'CLOSED');
  assert.equal(resumed.interaction_id, escalated.interaction_id);
  assert.equal(resumed.correlation_id, escalated.correlation_id);
  const after = await replacement.loadAudit(escalated.interaction_id);
  assert.ok(after.length > before.length);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(replacement.verifyAudit(escalated.interaction_id), { valid: true });
});

test('replacement SDK reconciles checkpointed transition missing from audit after simulated process crash', async () => {
  const checkpoints = new InMemoryInteractionCheckpointStore<Input, Output>();
  const durableAudit = new InMemoryAuditRecordStore();
  const crashingAudit = new FailOnceAuditStore(durableAudit, 2);
  const first = new H2A2HSDK(bindings(), {
    checkpoint_store: checkpoints,
    audit_store: crashingAudit,
  });

  await assert.rejects(
    () => first.run({
      initiating_human: human,
      interaction_id: 'interaction:audit-crash-window',
      correlation_id: 'correlation:audit-crash-window',
      intent: { canonical_label: 'Audit.DurableExample', version: '1.0.0' },
      input: { value: 'crash before audit append' },
    }),
    /simulated crash/,
  );

  const checkpoint = checkpoints.load('interaction:audit-crash-window');
  assert.equal(checkpoint?.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(checkpoint?.transitions.length, 3);
  assert.equal((await durableAudit.load('interaction:audit-crash-window')).length, 2);

  const replacement = new H2A2HSDK(bindings(), {
    checkpoint_store: checkpoints,
    audit_store: durableAudit,
  });
  const resumed = await replacement.resume('interaction:audit-crash-window', {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:valid'],
    },
    input: { delegation_ref: 'delegation:valid', value: 'reconciled' },
  });

  assert.equal(resumed.state, 'CLOSED');
  const records = await replacement.loadAudit(resumed.interaction_id);
  assert.equal(records.length, resumed.transitions.length);
  assert.equal(records[2]?.event, checkpoint?.transitions[2]?.event);
  assert.deepEqual(replacement.verifyAudit(resumed.interaction_id), { valid: true });
});

test('tampered hydrated audit record fails closed', () => {
  const canonical = createAuditRecord({
    interaction_id: 'interaction:tamper',
    correlation_id: 'correlation:tamper',
    sequence: 0,
    event: 'h2a2h.lifecycle.created',
    timestamp: '2026-09-02T17:02:00.000Z',
  });
  const tampered = structuredClone(canonical);
  tampered.event = 'forged.lifecycle.created';

  assert.throws(() => new AuditTrail([tampered]), /digest_mismatch|Invalid audit record/);
});
