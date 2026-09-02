import assert from 'node:assert/strict';
import test from 'node:test';
import {
  H2A2HRuntime,
  humanEscalationRequired,
} from '../runtime.js';
import type {
  EntityRef,
  RuntimeBindings,
} from '../types.js';

const human: EntityRef = {
  entity_id: 'human:runtime-owner',
  kind: 'Human',
  canonical_label: 'Human.RuntimeOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:runtime-worker',
  kind: 'Agent',
  canonical_label: 'Agent.RuntimeWorker',
};

interface Input { value: string }
interface Output { accepted: boolean }

function baseBindings(overrides: Partial<RuntimeBindings<Input, Output>> = {}): RuntimeBindings<Input, Output> {
  return {
    resolveIntent: () => ({
      ref: { canonical_label: 'Example.HumanRequired', version: '1.0.0' },
      input_schema: 'schema://example/input',
      output_schema: 'schema://example/output',
    }),
    validateDelegation: () => ({
      valid: true,
      delegation_id: 'delegation:valid',
      evidence: ['delegation-proof:valid'],
    }),
    resolveParticipants: () => ({
      sender: agent,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:runtime-owner',
    }),
    resolveChannel: () => ({ profile: 'memory' }),
    execute: () => ({ accepted: true }),
    returnToHuman: () => ({
      proof_ref: 'pohr:runtime',
      return_state: 'human_presented',
    }),
    ...overrides,
  };
}

function request() {
  return {
    initiating_human: human,
    interaction_id: 'interaction:human-required',
    correlation_id: 'correlation:human-required',
    intent: { canonical_label: 'Example.HumanRequired' },
    input: { value: 'test' },
  };
}

test('invalid delegation returns HUMAN_ESCALATION_REQUIRED instead of throwing', async () => {
  let executed = 0;
  const runtime = new H2A2HRuntime(baseBindings({
    validateDelegation: () => ({ valid: false, reason: 'delegation.missing' }),
    execute: () => {
      executed += 1;
      return { accepted: true };
    },
  }));

  const result = await runtime.run(request());
  assert.equal(result.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(result.human_escalation?.code, 'delegation.missing');
  assert.equal(result.human_escalation?.resume_state, 'INTENT_CAPTURED');
  assert.equal(result.human_escalation?.human_action.canonical_label, 'Human.Delegation.Provide');
  assert.equal(executed, 0);
  assert.equal(result.transitions.at(-1)?.event, 'h2a2h.delegation.missing');
});

test('expired delegation returns EXPIRED as a lifecycle outcome without executing', async () => {
  let executed = 0;
  const runtime = new H2A2HRuntime(baseBindings({
    validateDelegation: () => ({
      valid: false,
      reason: 'delegation.expired',
      evidence: ['delegation-proof:expired'],
    }),
    execute: () => {
      executed += 1;
      return { accepted: true };
    },
  }));

  const result = await runtime.run(request());
  assert.equal(result.state, 'EXPIRED');
  assert.equal(result.human_escalation, undefined);
  assert.equal(executed, 0);
  assert.deepEqual(result.transitions.at(-1)?.evidence, ['delegation-proof:expired']);
});

test('execute can return a typed HumanRequired outcome without returning to Human prematurely', async () => {
  let returned = 0;
  const runtime = new H2A2HRuntime(baseBindings({
    execute: () => humanEscalationRequired({
      code: 'human.approval_required',
      reason: 'Human approval is required',
      evidence: ['policy:approval-required'],
      resume_state: 'EXECUTING',
      human_action: {
        canonical_label: 'Human.Approval.Provide',
        metadata: { tool: 'example.write' },
      },
    }),
    returnToHuman: () => {
      returned += 1;
      return { proof_ref: 'pohr:should-not-exist', return_state: 'human_presented' };
    },
  }));

  const result = await runtime.run(request());
  assert.equal(result.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(result.human_escalation?.code, 'human.approval_required');
  assert.equal(result.human_escalation?.resume_state, 'EXECUTING');
  assert.deepEqual(result.human_escalation?.evidence, ['policy:approval-required']);
  assert.equal(result.result, undefined);
  assert.equal(result.human_return, undefined);
  assert.equal(returned, 0);
  assert.equal(result.transitions.at(-1)?.event, 'h2a2h.human.approval_required');
});

test('missing acknowledgement binding becomes HumanRequired with PoHR evidence', async () => {
  const runtime = new H2A2HRuntime(baseBindings({
    resolveIntent: () => ({
      ref: { canonical_label: 'Example.HumanRequired', version: '1.0.0' },
      input_schema: 'schema://example/input',
      output_schema: 'schema://example/output',
      acknowledgement_required: true,
    }),
    returnToHuman: () => ({
      proof_ref: 'pohr:needs-ack',
      return_state: 'human_presented',
    }),
  }));

  const result = await runtime.run(request());
  assert.equal(result.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(result.result?.accepted, true);
  assert.equal(result.human_escalation?.code, 'human.acknowledgement_required');
  assert.equal(result.human_escalation?.resume_state, 'HUMAN_RETURNED');
  assert.equal(result.human_escalation?.human_action.canonical_label, 'Human.Acknowledgement.Provide');
  assert.deepEqual(result.human_escalation?.evidence, ['pohr:needs-ack']);
  assert.equal(result.transitions.at(-1)?.event, 'h2a2h.human.acknowledgement_required');
});
