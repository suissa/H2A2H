import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020Module, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import {
  AuditTrail,
  DelegationSessionStore,
  InMemoryChannelAdapter,
  ReplayGuard,
  canTransition,
  type H2A2HEnvelope,
} from '../index.js';

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
  readFileSync(new URL('../../schemas/h2a2h-v1.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function validator(fragment: string): ValidationFunction {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `https://h2a2h.dev/schemas/h2a2h-v1.schema.json#/$defs/${fragment}` });
}

test('normative OpenIntent example validates', () => {
  const artifact = parseYaml(readFileSync(new URL('../../examples/openintent.purchase-products.yml', import.meta.url), 'utf8'));
  const validate = validator('openIntent');
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
});

test('normative OpenDelegation example validates', () => {
  const artifact = parseYaml(readFileSync(new URL('../../examples/opendelegation.purchase-products.yml', import.meta.url), 'utf8'));
  const validate = validator('openDelegation');
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
});

test('invalid delegation without canonical Entity kind is rejected', () => {
  const validate = validator('openDelegation');
  const invalid = {
    protocol: 'opendelegation',
    version: '1.0.0',
    delegation_id: 'delegation:invalid',
    delegator: { entity_id: 'human:a' },
    delegate: { entity_id: 'agent:a', kind: 'Agent' },
    issued_at: '2026-09-01T20:00:00Z',
    expires_at: '2026-09-01T21:00:00Z',
    scope: { intents: ['Example.Do'] },
    constraints: {},
    proof: { profile: 'example', value: 'proof' },
  };
  assert.equal(validate(invalid), false);
  assert.ok(validate.errors?.some((error: ErrorObject) => error.instancePath.includes('/delegator')));
});

test('lifecycle rejects semantically invalid transitions', () => {
  assert.equal(canTransition('CREATED', 'INTENT_CAPTURED'), true);
  assert.equal(canTransition('CREATED', 'EXECUTING'), false);
  assert.equal(canTransition('HUMAN_RETURNED', 'CLOSED'), true);
  assert.equal(canTransition('CLOSED', 'EXECUTING'), false);
});

test('delegation sessions cannot outlive delegation and revocation is immediate', () => {
  const store = new DelegationSessionStore();
  const now = new Date('2026-09-01T20:00:00Z');
  const session = store.create({
    delegation_id: 'delegation:1',
    delegation_expires_at: '2026-09-01T20:10:00Z',
    max_session_ms: 60 * 60 * 1000,
    idle_timeout_ms: 5 * 60 * 1000,
    scopes: ['commerce.purchase.create'],
    intents: ['Commerce.PurchaseProducts'],
    now,
  });
  assert.equal(session.expires_at, '2026-09-01T20:10:00.000Z');
  store.assertActive(session.session_id, { scope: 'commerce.purchase.create' }, new Date('2026-09-01T20:01:00Z'));
  store.revoke(session.session_id, 'human.revoked', new Date('2026-09-01T20:02:00Z'));
  assert.throws(
    () => store.assertActive(session.session_id, {}, new Date('2026-09-01T20:02:01Z')),
    /revoked/,
  );
});

test('replay guard rejects duplicate accepted identity', () => {
  const guard = new ReplayGuard();
  const now = new Date('2026-09-01T20:00:00Z');
  const expiry = new Date('2026-09-01T20:05:00Z');
  guard.accept('msg:1', expiry, now);
  assert.throws(() => guard.accept('msg:1', expiry, new Date('2026-09-01T20:00:10Z')), /security\.replay/);
});

test('audit trail detects no mutation in a valid digest chain', () => {
  const audit = new AuditTrail();
  audit.append({
    interaction_id: 'interaction:1',
    correlation_id: 'correlation:1',
    event: 'h2a2h.lifecycle.created',
    timestamp: '2026-09-01T20:00:00Z',
  });
  audit.append({
    interaction_id: 'interaction:1',
    correlation_id: 'correlation:1',
    event: 'h2a2h.lifecycle.intent_captured',
    timestamp: '2026-09-01T20:00:01Z',
  });
  assert.deepEqual(audit.verify(), { valid: true });
});

function envelope(kind: H2A2HEnvelope['kind'], sender: string, receiver: string): H2A2HEnvelope {
  return {
    protocol: 'h2a2h',
    version: '1.0.0',
    message_id: `msg:${kind}`,
    interaction_id: 'interaction:channel-test',
    correlation_id: 'correlation:channel-test',
    kind,
    intent: { canonical_label: 'Test.Echo', version: '1.0.0' },
    sender: { entity_id: sender, kind: 'Agent' },
    receiver: { entity_id: receiver, kind: 'Agent' },
    timestamp: '2026-09-01T20:00:00Z',
    payload: { schema: 'schema://test/echo', value: { ok: true } },
  };
}

test('in-memory adapter provides transport-independent request/reply', async () => {
  const declaration = {
    channel_id: 'test-memory',
    transport: 'in-memory' as const,
    mode: 'request_reply' as const,
    endpoint: { address: 'test.echo' },
    versions: ['1.x'],
    security: { profile: 'h2a2h.security.local-trusted.v1' },
  };
  const server = new InMemoryChannelAdapter(declaration);
  const client = new InMemoryChannelAdapter(declaration);
  const dispose = server.respond(async (request) => ({
    ...request,
    message_id: 'msg:response',
    kind: 'response',
    sender: request.receiver,
    receiver: request.sender,
  }));
  const response = await client.request(envelope('request', 'agent:a', 'agent:b'));
  assert.equal(response.kind, 'response');
  assert.equal(response.receiver.entity_id, 'agent:a');
  dispose();
});
