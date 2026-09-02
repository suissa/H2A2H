import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEmployeeToolExecutionIdentity,
  type EmployeeToolCallContext,
} from '../employee-agent.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  EmployeeToolCapabilityError,
  EmployeeToolRegistry,
  InMemoryEmployeeToolProvider,
} from '../employee-tool-registry.js';
import {
  InMemoryToolExecutionJournalStore,
  ToolExecutionJournalError,
  type ToolExecutionDescriptor,
} from '../tool-execution-journal.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:fenced-recovery-owner',
  kind: 'Human',
  canonical_label: 'Human.FencedRecoveryOwner',
};

function descriptor(overrides: Partial<ToolExecutionDescriptor> = {}): ToolExecutionDescriptor {
  return {
    execution_id: 'tool-execution:fenced-recovery',
    idempotency_key: 'h2a2h:fenced-recovery',
    operation_index: 0,
    input_digest: 'digest:fenced-recovery',
    capability_canonical_label: 'commerce.catalog.search',
    interaction_id: 'interaction:fenced-recovery',
    correlation_id: 'correlation:fenced-recovery',
    intent_canonical_label: 'Enterprise.Employee.PersonalShopperAgent.Analyze',
    employee_canonical_label: 'Enterprise.Employee.PersonalShopperAgent',
    ...overrides,
  };
}

async function shopperContext(interactionId: string): Promise<EmployeeToolCallContext> {
  const employee = await (await EmployeeAgentRegistry.fromCatalog()).load(
    'Enterprise.Employee.PersonalShopperAgent',
  );
  const tool = 'commerce.catalog.search';
  const input = { query: 'recover camera search' };
  const intentCanonicalLabel = 'Enterprise.Employee.PersonalShopperAgent.Analyze';
  return {
    employee,
    operation: { tool, input },
    execution: deriveEmployeeToolExecutionIdentity({
      interaction_id: interactionId,
      intent_canonical_label: intentCanonicalLabel,
      employee_canonical_label: employee.contract.identity.canonical_label,
      operation_index: 0,
      tool_canonical_label: tool,
      operation_input: input,
    }),
    interaction: {
      interaction_id: interactionId,
      correlation_id: `correlation:${interactionId}`,
      state: 'EXECUTING',
      initiating_human: human,
      intent: {
        ref: { canonical_label: intentCanonicalLabel, version: '0.1.0' },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: { delegation_ref: 'delegation:fenced-recovery', request_payload: {} },
      transitions: [],
    },
  };
}

test('non-expired claim conflicts, expired claim is reclaimed with a higher fence, and stale owner is rejected', () => {
  let now = Date.parse('2026-09-02T06:00:00.000Z');
  const journal = new InMemoryToolExecutionJournalStore({
    claim_ttl_ms: 1_000,
    now: () => new Date(now),
  });

  const first = journal.claimExecution(descriptor());
  assert.equal(first.status, 'claimed');
  if (first.status !== 'claimed') throw new Error('Expected first claim');
  assert.equal(first.recovered, false);
  assert.equal(first.record.fence, 1);
  assert.equal(first.record.claim_expires_at, '2026-09-02T06:00:01.000Z');

  now += 999;
  assert.equal(journal.claimExecution(descriptor()).status, 'conflict');

  now += 1;
  const recovered = journal.claimExecution(descriptor());
  assert.equal(recovered.status, 'claimed');
  if (recovered.status !== 'claimed') throw new Error('Expected recovered claim');
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.record.fence, 2);
  assert.notEqual(recovered.record.claim_id, first.record.claim_id);

  assert.equal(
    journal.completeExecution(first.record.execution_id, first.record.claim_id, { stale: true }),
    false,
  );
  assert.equal(journal.releaseExecution(first.record.execution_id, first.record.claim_id), false);

  assert.equal(
    journal.completeExecution(recovered.record.execution_id, recovered.record.claim_id, { owner: 'fence-2' }),
    true,
  );
  const stored = journal.loadExecution(recovered.record.execution_id);
  assert.equal(stored?.state, 'completed');
  assert.equal(stored?.fence, 2);

  now += 60_000;
  const replay = journal.claimExecution(descriptor());
  assert.equal(replay.status, 'completed');
  if (replay.status !== 'completed') throw new Error('Expected completed replay');
  assert.deepEqual(replay.record.result, { owner: 'fence-2' });
  assert.equal(replay.record.fence, 2);
});

test('expired execution still rejects descriptor mismatch before reclaim', () => {
  let now = Date.parse('2026-09-02T07:00:00.000Z');
  const journal = new InMemoryToolExecutionJournalStore({
    claim_ttl_ms: 10,
    now: () => new Date(now),
  });
  assert.equal(journal.claimExecution(descriptor()).status, 'claimed');
  now += 11;

  assert.throws(
    () => journal.claimExecution(descriptor({ input_digest: 'digest:forged-after-expiry' })),
    (error: unknown) =>
      error instanceof ToolExecutionJournalError
      && error.code === 'tool.execution.identity_mismatch',
  );
  const validRecovery = journal.claimExecution(descriptor());
  assert.equal(validRecovery.status, 'claimed');
  if (validRecovery.status !== 'claimed') throw new Error('Expected valid recovery');
  assert.equal(validRecovery.recovered, true);
  assert.equal(validRecovery.record.fence, 2);
});

test('invalid claim TTL fails closed before journal use', () => {
  assert.throws(
    () => new InMemoryToolExecutionJournalStore({ claim_ttl_ms: 0 }),
    (error: unknown) =>
      error instanceof ToolExecutionJournalError
      && error.code === 'tool.execution.claim_ttl_invalid',
  );
});

test('recovered Tool owner retries with the same provider idempotency key while stale owner is fenced out', async () => {
  let now = Date.parse('2026-09-02T08:00:00.000Z');
  const journal = new InMemoryToolExecutionJournalStore({
    claim_ttl_ms: 1_000,
    now: () => new Date(now),
  });
  const registry = await EmployeeToolRegistry.load('capabilities/employee-tools/catalog.json', {
    executionJournal: journal,
  });
  const context = await shopperContext('interaction:fenced-provider-recovery');

  let calls = 0;
  const idempotencyKeys: string[] = [];
  let firstStartedResolve!: () => void;
  let releaseFirstResolve!: () => void;
  const firstStarted = new Promise<void>((resolve) => { firstStartedResolve = resolve; });
  const releaseFirst = new Promise<void>((resolve) => { releaseFirstResolve = resolve; });

  registry.bind('commerce.catalog.search', new InMemoryEmployeeToolProvider('memory:fenced-recovery', {
    'commerce.catalog.search': async (_input, providerContext) => {
      calls += 1;
      idempotencyKeys.push(providerContext.idempotency_key);
      if (calls === 1) {
        firstStartedResolve();
        await releaseFirst;
        return { owner: 'stale-worker' };
      }
      return { owner: 'recovered-worker' };
    },
  }));
  const executor = registry.resolveExecutor('commerce.catalog.search');

  const staleExecution = executor(context.operation.input, context);
  const staleOutcome = Promise.allSettled([staleExecution]);
  await firstStarted;

  now += 1_001;
  const recoveredResult = await executor(context.operation.input, context);
  assert.deepEqual(recoveredResult, { owner: 'recovered-worker' });
  assert.equal(calls, 2);
  assert.deepEqual(idempotencyKeys, [
    context.execution.idempotency_key,
    context.execution.idempotency_key,
  ]);

  releaseFirstResolve();
  const [stale] = await staleOutcome;
  assert.equal(stale?.status, 'rejected');
  assert.ok(
    stale?.status === 'rejected'
    && stale.reason instanceof EmployeeToolCapabilityError
    && stale.reason.code === 'tool.execution.release_failed',
  );

  const stored = await journal.loadExecution(context.execution.execution_id);
  assert.equal(stored?.state, 'completed');
  assert.equal(stored?.fence, 2);
  assert.deepEqual(stored?.state === 'completed' ? stored.result : undefined, { owner: 'recovered-worker' });
});
