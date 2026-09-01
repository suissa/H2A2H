import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  H2A2HSDK,
  HttpChannelAdapter,
} from '../../dist/index.js';
import {
  IndependentReferenceB,
  createEnvelopeB,
  createPoHRB,
  requestHttpB,
  startReferenceBHttpServer,
  validateDelegationB,
} from './index.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/h2a2h-v1.schema.json', import.meta.url), 'utf8'),
);

function compile(fragment) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `https://h2a2h.dev/schemas/h2a2h-v1.schema.json#/$defs/${fragment}` });
}

const humanA = { entity_id: 'human:interop-a', kind: 'Human' };
const agentA = { entity_id: 'agent:reference-a', kind: 'Agent' };
const agentB = { entity_id: 'agent:reference-b', kind: 'Agent' };
const humanB = { entity_id: 'human:interop-b', kind: 'Human' };

function delegation() {
  return {
    protocol: 'opendelegation',
    version: '1.0.0',
    delegation_id: 'delegation:interop-a-to-b',
    delegator: humanA,
    delegate: agentB,
    issued_at: '2026-09-01T20:00:00Z',
    expires_at: '2099-09-01T21:00:00Z',
    scope: {
      intents: ['Example.Interop'],
      actions: ['example.interop.execute'],
    },
    constraints: { max_depth: 1 },
    proof: { profile: 'h2a2h.proof.signed.v1', value: 'fixture-proof' },
  };
}

function responsibility() {
  return [{
    segment_id: 'r0',
    accountable_entity: humanA,
    participant: humanA,
    intent: 'Example.Interop',
  }];
}

function referenceASdk() {
  return new H2A2HSDK({
    resolveIntent: () => ({
      ref: { canonical_label: 'Example.Interop', version: '1.0.0' },
      input_schema: 'schema://interop/input/1',
      output_schema: 'schema://interop/output/1',
    }),
    validateDelegation: () => ({ valid: true, delegation_id: 'delegation:interop-a-to-b' }),
    resolveParticipants: () => ({ sender: agentA, receiver: agentB, receiving_human: humanB }),
    resolveChannel: () => ({ profile: 'h2a2h.channel.direct-json.v1' }),
    execute: async () => ({ ok: true }),
    returnToHuman: () => ({ proof_ref: 'pohr:reference-a', return_state: 'human_acknowledged' }),
  });
}

test('reference B artifacts validate against the same normative schemas', () => {
  const validateEnvelope = compile('envelope');
  const validatePohr = compile('proofOfHumanReturn');

  const envelope = createEnvelopeB({
    interaction_id: 'interaction:schema-b',
    correlation_id: 'correlation:schema-b',
    kind: 'request',
    intent: { canonical_label: 'Example.Interop', version: '1.0.0' },
    sender: agentB,
    receiver: agentA,
    schema: 'schema://interop/input/1',
    value: { source: 'reference-b' },
    delegation_id: 'delegation:interop-a-to-b',
  });
  const pohr = createPoHRB({
    interaction_id: envelope.interaction_id,
    target_human: humanB,
    result: { ok: true },
    channel_profile: 'h2a2h.channel.direct-json.v1',
  });

  assert.equal(validateEnvelope(envelope), true, JSON.stringify(validateEnvelope.errors));
  assert.equal(validatePohr(pohr), true, JSON.stringify(validatePohr.errors));
});

test('direct JSON channel interoperates A -> B and B -> A without shared runtime internals', () => {
  const sdkA = referenceASdk();
  const referenceB = new IndependentReferenceB();

  const fromA = sdkA.createEnvelope({
    interaction_id: 'interaction:direct-a-b',
    correlation_id: 'correlation:direct-a-b',
    kind: 'request',
    intent: { canonical_label: 'Example.Interop', version: '1.0.0' },
    sender: agentA,
    receiver: agentB,
    schema: 'schema://interop/input/1',
    value: { direction: 'A->B' },
    delegation_id: 'delegation:interop-a-to-b',
    responsibility_chain_ref: 'responsibility:interop-direct',
    channel_profile: 'h2a2h.channel.direct-json.v1',
  });

  const processedByB = referenceB.process(fromA, {
    delegation: delegation(),
    responsibility: responsibility(),
    responsibility_chain_ref: 'responsibility:interop-direct',
    target_human: humanB,
    channel_profile: 'h2a2h.channel.direct-json.v1',
  });
  assert.equal(processedByB.response.payload.value.processed_by, 'reference-b');
  assert.equal(processedByB.pohr.return_state, 'human_acknowledged');
  assert.equal(processedByB.responsibility.length, 2);

  const fromB = createEnvelopeB({
    interaction_id: 'interaction:direct-b-a',
    correlation_id: 'correlation:direct-b-a',
    kind: 'request',
    intent: { canonical_label: 'Example.Interop', version: '1.0.0' },
    sender: agentB,
    receiver: agentA,
    schema: 'schema://interop/input/1',
    value: { direction: 'B->A' },
    delegation_id: 'delegation:interop-a-to-b',
  });
  validateDelegationB(delegation(), fromB.intent.canonical_label, new Date('2026-09-01T20:30:00Z'));
  const responseFromA = sdkA.createEnvelope({
    interaction_id: fromB.interaction_id,
    correlation_id: fromB.correlation_id,
    causation_id: fromB.message_id,
    kind: 'response',
    intent: fromB.intent,
    sender: agentA,
    receiver: agentB,
    schema: 'schema://interop/output/1',
    value: { processed_by: 'reference-a', input: fromB.payload.value },
    delegation_id: fromB.delegation.delegation_id,
    channel_profile: 'h2a2h.channel.direct-json.v1',
  });
  assert.equal(responseFromA.receiver.entity_id, agentB.entity_id);
  assert.equal(responseFromA.payload.value.processed_by, 'reference-a');
});

test('HTTP channel interoperates reference A -> independent B', async () => {
  const sdkA = referenceASdk();
  const referenceB = new IndependentReferenceB();
  const server = await startReferenceBHttpServer(referenceB, () => ({
    delegation: delegation(),
    responsibility: responsibility(),
    responsibility_chain_ref: 'responsibility:interop-http',
    target_human: humanB,
    channel_profile: 'h2a2h.channel.http.v1',
  }));

  try {
    const adapter = new HttpChannelAdapter({
      channel_id: 'reference-b-http',
      transport: 'http',
      mode: 'request_reply',
      endpoint: { url: server.url },
      versions: ['1.x'],
      security: { profile: 'h2a2h.security.local-trusted.v1' },
    });
    const request = sdkA.createEnvelope({
      interaction_id: 'interaction:http-a-b',
      correlation_id: 'correlation:http-a-b',
      kind: 'request',
      intent: { canonical_label: 'Example.Interop', version: '1.0.0' },
      sender: agentA,
      receiver: agentB,
      schema: 'schema://interop/input/1',
      value: { direction: 'A->B', channel: 'http' },
      delegation_id: 'delegation:interop-a-to-b',
      channel_profile: 'h2a2h.channel.http.v1',
    });
    const response = await adapter.request(request);
    assert.equal(response.payload.value.processed_by, 'reference-b');
    assert.equal(response.causation_id, request.message_id);
  } finally {
    await server.close();
  }
});

test('HTTP channel interoperates independent B -> reference A endpoint', async () => {
  const sdkA = referenceASdk();
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const answer = sdkA.createEnvelope({
      interaction_id: envelope.interaction_id,
      correlation_id: envelope.correlation_id,
      causation_id: envelope.message_id,
      kind: 'response',
      intent: envelope.intent,
      sender: agentA,
      receiver: agentB,
      schema: 'schema://interop/output/1',
      value: { processed_by: 'reference-a', input: envelope.payload.value },
      delegation_id: envelope.delegation.delegation_id,
      channel_profile: 'h2a2h.channel.http.v1',
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const request = createEnvelopeB({
      interaction_id: 'interaction:http-b-a',
      correlation_id: 'correlation:http-b-a',
      kind: 'request',
      intent: { canonical_label: 'Example.Interop', version: '1.0.0' },
      sender: agentB,
      receiver: agentA,
      schema: 'schema://interop/input/1',
      value: { direction: 'B->A', channel: 'http' },
      delegation_id: 'delegation:interop-a-to-b',
    });
    const response = await requestHttpB(`http://127.0.0.1:${address.port}`, request);
    assert.equal(response.payload.value.processed_by, 'reference-a');
    assert.equal(response.receiver.entity_id, agentB.entity_id);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
