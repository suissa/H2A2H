import assert from 'node:assert/strict';
import test from 'node:test';
import { H2A2HRuntimeError } from '../runtime.js';
import { H2A2HSDK } from '../sdk.js';
import type { EntityRef, RuntimeBindings } from '../types.js';

interface ResumeInput {
  delegation_ref?: string;
  payload: string;
}

interface ResumeOutput {
  accepted: string;
}

const human: EntityRef = {
  entity_id: 'human:resume-owner',
  kind: 'Human',
  canonical_label: 'Human.ResumeOwner',
};

const agent: EntityRef = {
  entity_id: 'agent:resume-worker',
  kind: 'Agent',
  canonical_label: 'Agent.ResumeWorker',
};

function bindings(options: {
  acknowledgementRequired?: boolean;
  executeCounter?: { count: number };
  returnCounter?: { count: number };
  includeHumanValidator?: boolean;
} = {}): RuntimeBindings<ResumeInput, ResumeOutput> {
  const executeCounter = options.executeCounter ?? { count: 0 };
  const returnCounter = options.returnCounter ?? { count: 0 };
  return {
    resolveIntent: () => ({
      ref: { canonical_label: 'Resume.Example', version: '1.0.0' },
      input_schema: 'schema://resume/input',
      output_schema: 'schema://resume/output',
      acknowledgement_required: options.acknowledgementRequired ?? false,
    }),
    validateDelegation: (context) => context.input.delegation_ref === 'delegation:valid'
      ? { valid: true, delegation_id: 'delegation:valid', evidence: ['delegation-proof:valid'] }
      : { valid: false, reason: 'delegation.missing' },
    resolveParticipants: () => ({
      sender: agent,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: 'responsibility:resume-owner',
    }),
    resolveChannel: () => ({ profile: 'in-memory' }),
    execute: (context) => {
      executeCounter.count += 1;
      return { accepted: context.input.payload };
    },
    returnToHuman: (context) => {
      returnCounter.count += 1;
      return {
        proof_ref: `pohr:${context.interaction_id}`,
        return_state: 'human_presented',
      };
    },
    ...(options.includeHumanValidator === false ? {} : {
      validateHumanAction: (_context, action, expected) => ({
        valid:
          action.actor.entity_id === human.entity_id
          && action.canonical_label === expected.canonical_label
          && action.evidence.includes('human-proof:valid'),
        evidence: action.evidence,
        reason: 'human.resume.evidence_invalid',
      }),
    }),
  };
}

function initialRequest(input: ResumeInput) {
  return {
    initiating_human: human,
    interaction_id: 'interaction:resume-1',
    correlation_id: 'correlation:resume-1',
    intent: { canonical_label: 'Resume.Example', version: '1.0.0' },
    input,
  };
}

test('invalid Human action and invalid evidence remain escalated and never execute downstream behavior', async () => {
  const executeCounter = { count: 0 };
  const sdk = new H2A2HSDK(bindings({ executeCounter }));
  const escalated = await sdk.run(initialRequest({ payload: 'resume me' }));

  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(escalated.human_escalation?.human_action.canonical_label, 'Human.Delegation.Provide');
  assert.equal(executeCounter.count, 0);

  const wrongAction = await sdk.resume(escalated, {
    human_action: {
      canonical_label: 'Human.Approval.Provide',
      actor: human,
      evidence: ['human-proof:valid'],
    },
  });
  assert.equal(wrongAction.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(wrongAction.transitions.at(-1)?.event, 'h2a2h.human.resume_rejected');
  assert.equal(executeCounter.count, 0);

  const invalidEvidence = await sdk.resume(wrongAction, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:forged'],
    },
  });
  assert.equal(invalidEvidence.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(invalidEvidence.transitions.at(-1)?.event, 'h2a2h.human.resume.evidence_invalid');
  assert.equal(executeCounter.count, 0);
  assert.equal(sdk.verifyAudit().valid, true);
});

test('delegation HumanRequired resumes the same interaction from INTENT_CAPTURED and completes once', async () => {
  const executeCounter = { count: 0 };
  const sdk = new H2A2HSDK(bindings({ executeCounter }));
  const escalated = await sdk.run(initialRequest({ payload: 'resume me' }));
  const transitionCount = escalated.transitions.length;

  const resumed = await sdk.resume(escalated, {
    human_action: {
      canonical_label: 'Human.Delegation.Provide',
      actor: human,
      evidence: ['human-proof:valid'],
    },
    input: {
      delegation_ref: 'delegation:valid',
      payload: 'resumed payload',
    },
  });

  assert.equal(resumed.state, 'CLOSED');
  assert.equal(resumed.interaction_id, 'interaction:resume-1');
  assert.equal(resumed.correlation_id, 'correlation:resume-1');
  assert.equal(resumed.result?.accepted, 'resumed payload');
  assert.equal(executeCounter.count, 1);
  assert.equal(resumed.transitions.filter((transition) => transition.to === 'CREATED').length, 1);
  assert.equal(resumed.transitions[transitionCount]?.from, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(resumed.transitions[transitionCount]?.to, 'INTENT_CAPTURED');
  assert.equal(resumed.transitions[transitionCount]?.event, 'h2a2h.lifecycle.resumed');
  assert.equal(resumed.transitions[transitionCount]?.actor?.entity_id, human.entity_id);
  assert.equal(sdk.verifyAudit().valid, true);

  await assert.rejects(
    () => sdk.resume(resumed, {
      human_action: {
        canonical_label: 'Human.Delegation.Provide',
        actor: human,
        evidence: ['human-proof:valid'],
      },
    }),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError && error.code === 'human.resume.not_escalated',
  );
});

test('acknowledgement resume closes the same interaction without presenting a second PoHR', async () => {
  const returnCounter = { count: 0 };
  const sdk = new H2A2HSDK(bindings({
    acknowledgementRequired: true,
    returnCounter,
  }));

  const escalated = await sdk.run(initialRequest({
    delegation_ref: 'delegation:valid',
    payload: 'acknowledge me',
  }));

  assert.equal(escalated.state, 'HUMAN_ESCALATION_REQUIRED');
  assert.equal(escalated.human_escalation?.code, 'human.acknowledgement_required');
  assert.equal(escalated.human_escalation?.resume_state, 'HUMAN_RETURNED');
  assert.equal(returnCounter.count, 1);
  const proofRef = escalated.human_return?.proof_ref;

  const resumed = await sdk.resume(escalated, {
    human_action: {
      canonical_label: 'Human.Acknowledgement.Provide',
      actor: human,
      evidence: ['human-proof:valid', proofRef ?? 'pohr:missing'],
    },
  });

  assert.equal(resumed.state, 'CLOSED');
  assert.equal(resumed.human_return?.return_state, 'human_acknowledged');
  assert.equal(resumed.human_return?.proof_ref, proofRef);
  assert.equal(returnCounter.count, 1);
  assert.equal(resumed.transitions.at(-3)?.to, 'HUMAN_RETURNED');
  assert.equal(resumed.transitions.at(-2)?.to, 'ACKNOWLEDGED');
  assert.equal(resumed.transitions.at(-1)?.to, 'CLOSED');
  assert.equal(sdk.verifyAudit().valid, true);
});

test('resume fails closed when Human action validation is not configured', async () => {
  const sdk = new H2A2HSDK(bindings({ includeHumanValidator: false }));
  const escalated = await sdk.run(initialRequest({ payload: 'validator required' }));

  await assert.rejects(
    () => sdk.resume(escalated, {
      human_action: {
        canonical_label: 'Human.Delegation.Provide',
        actor: human,
        evidence: ['human-proof:valid'],
      },
    }),
    (error: unknown) =>
      error instanceof H2A2HRuntimeError && error.code === 'human.resume.validator_missing',
  );
});
