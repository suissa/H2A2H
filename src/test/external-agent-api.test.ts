import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020Module, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

interface ValidationFunction {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

interface AjvLike {
  addSchema(schema: unknown): void;
  compile(schema: unknown): ValidationFunction;
}

type AjvConstructor = new (options?: Record<string, unknown>) => AjvLike;

const Ajv2020 = Ajv2020Module as unknown as AjvConstructor;
const addFormats = addFormatsModule as unknown as (ajv: AjvLike) => void;
const schema = JSON.parse(
  readFileSync(new URL('../../schemas/h2a2h-external-agent-api-v1.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function validator(fragment: string): ValidationFunction {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${schema.$id as string}#/$defs/${fragment}` });
}

const proposal = parseYaml(
  readFileSync(new URL('../../examples/external-agent.intent-proposal.yml', import.meta.url), 'utf8'),
);

test('external IntentProposal preserves claimed, not accepted, causal references', () => {
  const validate = validator('intentProposal');
  assert.equal(validate(proposal), true, JSON.stringify(validate.errors));
  assert.ok(Array.isArray(proposal.claimed_causal_events));
  assert.equal('causal_events' in proposal, false);
});

test('IntentDecision is a complete causal response envelope', () => {
  const validate = validator('intentDecision');
  const decision = {
    protocol: 'h2a2h', version: '1.0.0', kind: 'intent_decision', message_id: 'msg:decision:1',
    interaction_id: 'interaction:1', correlation_id: 'corr:1', causation_id: 'msg:proposal:1',
    proposal_message_id: 'msg:proposal:1', decision: 'ACCEPT',
    sender: { entity_id: 'agent:receiver', kind: 'Agent' },
    receiver: { entity_id: 'agent:sender', kind: 'Agent' },
    intent: { intent_id: 'intent:1', canonical_label: 'Business.OptimizeProfitability', version: '1.0.0' },
    accepted_causal_events: [{
      event_id: 'event:1', relation: 'evidence', digest: 'sha256:event',
      intent: { intent_id: 'intent:evidence', canonical_label: 'Inventory.AssessAvailability', version: '1.0.0' },
    }],
    timestamp: '2026-09-14T00:00:01Z',
  };
  assert.equal(validate(decision), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...decision, causation_id: undefined }), false);
});

test('PARTIAL decision requires an explicit accepted scope', () => {
  const validate = validator('intentDecision');
  const partial = {
    protocol: 'h2a2h', version: '1.0.0', kind: 'intent_decision', message_id: 'msg:decision:partial',
    interaction_id: 'interaction:1', correlation_id: 'corr:1', causation_id: 'msg:proposal:1',
    proposal_message_id: 'msg:proposal:1', decision: 'PARTIAL',
    sender: { entity_id: 'agent:receiver', kind: 'Agent' }, receiver: { entity_id: 'agent:sender', kind: 'Agent' },
    intent: { canonical_label: 'Business.OptimizeProfitability', version: '1.0.0' }, timestamp: '2026-09-14T00:00:01Z',
  };
  assert.equal(validate(partial), false);
  assert.ok(validate.errors?.some((error) => error.keyword === 'required' && error.params.missingProperty === 'accepted_scope'));
});
