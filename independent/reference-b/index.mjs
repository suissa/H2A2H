import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';

export const REFERENCE_B_VERSION = '1.0.0';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

export function validateEnvelopeB(envelope) {
  const required = [
    'protocol', 'version', 'message_id', 'interaction_id', 'correlation_id',
    'kind', 'intent', 'sender', 'receiver', 'timestamp', 'payload'
  ];
  for (const field of required) {
    if (envelope?.[field] === undefined || envelope?.[field] === null) {
      throw new Error(`reference_b.envelope.missing:${field}`);
    }
  }
  if (envelope.protocol !== 'h2a2h') throw new Error('reference_b.envelope.protocol');
  if (!envelope.intent?.canonical_label || !envelope.intent?.version) throw new Error('reference_b.envelope.intent');
  if (!envelope.sender?.entity_id || !envelope.sender?.kind) throw new Error('reference_b.envelope.sender');
  if (!envelope.receiver?.entity_id || !envelope.receiver?.kind) throw new Error('reference_b.envelope.receiver');
  return true;
}

export function validateDelegationB(delegation, intentLabel, now = new Date()) {
  if (!delegation) throw new Error('delegation.missing');
  if (delegation.protocol !== 'opendelegation') throw new Error('delegation.invalid_protocol');
  if (delegation.revoked === true) throw new Error('delegation.revoked');
  if (delegation.not_before && now < new Date(delegation.not_before)) throw new Error('delegation.not_active');
  if (delegation.expires_at && now >= new Date(delegation.expires_at)) throw new Error('delegation.expired');
  const intents = delegation.scope?.intents ?? [];
  if (!intents.includes(intentLabel)) throw new Error('delegation.scope_denied');
  if (!delegation.delegator?.entity_id || !delegation.delegate?.entity_id) throw new Error('delegation.identity_required');
  return { valid: true, delegation_id: delegation.delegation_id };
}

export function assertChildDelegationB(parent, child) {
  const parentIntents = new Set(parent.scope?.intents ?? []);
  const parentActions = new Set(parent.scope?.actions ?? []);
  for (const intent of child.scope?.intents ?? []) {
    if (!parentIntents.has(intent)) throw new Error('delegation.scope_widened');
  }
  for (const action of child.scope?.actions ?? []) {
    if (!parentActions.has(action)) throw new Error('delegation.scope_widened');
  }
  if (parent.expires_at && child.expires_at && new Date(child.expires_at) > new Date(parent.expires_at)) {
    throw new Error('delegation.scope_widened');
  }
  return true;
}

export function appendResponsibilityB(chain, segment) {
  if (!Array.isArray(chain) || chain.length === 0) throw new Error('responsibility.root_required');
  return [...chain, {
    segment_id: segment.segment_id ?? `segment:${randomUUID()}`,
    predecessor: chain.at(-1).segment_id,
    accountable_entity: segment.accountable_entity,
    participant: segment.participant,
    intent: segment.intent,
    delegation_id: segment.delegation_id,
    entered_at: segment.entered_at ?? new Date().toISOString(),
  }];
}

export function createEnvelopeB(input) {
  return {
    protocol: 'h2a2h',
    version: REFERENCE_B_VERSION,
    message_id: input.message_id ?? `msg:${randomUUID()}`,
    interaction_id: input.interaction_id,
    correlation_id: input.correlation_id,
    ...(input.causation_id ? { causation_id: input.causation_id } : {}),
    ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
    kind: input.kind,
    intent: input.intent,
    sender: input.sender,
    receiver: input.receiver,
    timestamp: new Date().toISOString(),
    ...(input.delegation_id ? { delegation: { delegation_id: input.delegation_id } } : {}),
    ...(input.responsibility_chain_ref ? { responsibility_chain_ref: input.responsibility_chain_ref } : {}),
    payload: { schema: input.schema, media_type: 'application/json', value: input.value },
  };
}

export function createPoHRB({ interaction_id, target_human, result, channel_profile, acknowledged = true }) {
  const now = new Date().toISOString();
  return {
    protocol: 'h2a2h.pohr',
    version: REFERENCE_B_VERSION,
    proof_id: `pohr:b:${randomUUID()}`,
    interaction_id,
    target_human,
    result_digest: { algorithm: 'sha-256', value: digest(result) },
    return_state: acknowledged ? 'human_acknowledged' : 'human_presented',
    channel: { profile: channel_profile },
    presented_at: now,
    ...(acknowledged ? { acknowledged_at: now } : {}),
    proof_profile: acknowledged
      ? 'h2a2h.pohr.acknowledgement.v1'
      : 'h2a2h.pohr.presentation.v1',
    evidence_ref: `evidence:b:${randomUUID()}`,
  };
}

export class IndependentReferenceB {
  process(envelope, context) {
    validateEnvelopeB(envelope);
    validateDelegationB(context.delegation, envelope.intent.canonical_label, context.now ?? new Date());
    const responsibility = appendResponsibilityB(context.responsibility, {
      accountable_entity: envelope.receiver,
      participant: envelope.receiver,
      intent: envelope.intent.canonical_label,
      delegation_id: context.delegation.delegation_id,
    });
    const result = {
      processed_by: 'reference-b',
      receiver: envelope.receiver.entity_id,
      input: envelope.payload.value,
    };
    const response = createEnvelopeB({
      interaction_id: envelope.interaction_id,
      correlation_id: envelope.correlation_id,
      causation_id: envelope.message_id,
      kind: 'response',
      intent: envelope.intent,
      sender: envelope.receiver,
      receiver: envelope.sender,
      schema: 'schema://reference-b/response/1',
      value: result,
      delegation_id: context.delegation.delegation_id,
      responsibility_chain_ref: context.responsibility_chain_ref,
    });
    const pohr = createPoHRB({
      interaction_id: envelope.interaction_id,
      target_human: context.target_human,
      result,
      channel_profile: context.channel_profile,
      acknowledged: true,
    });
    return { response, pohr, responsibility };
  }
}

export function startReferenceBHttpServer(referenceB, contextFactory, port = 0) {
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = referenceB.process(envelope, contextFactory(envelope));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.response));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('reference_b.http.address'));
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
  });
}

export async function requestHttpB(url, envelope) {
  const body = JSON.stringify(envelope);
  const parsed = new URL(url);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname || '/',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 500) >= 400) return reject(new Error(`reference_b.http.${response.statusCode}:${text}`));
        resolve(JSON.parse(text));
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}
