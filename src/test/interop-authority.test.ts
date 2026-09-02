import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBridgePreservesAuthority,
  metadataFromA2A,
  metadataFromMCP,
  toA2ATask,
  toMCPToolCall,
  type BridgeMetadata,
} from '../interop.js';
import type { H2A2HEnvelope } from '../types.js';

function envelope(): H2A2HEnvelope {
  return {
    protocol: 'h2a2h',
    version: '1.0.0',
    message_id: 'msg:interop',
    interaction_id: 'interaction:interop',
    correlation_id: 'correlation:interop',
    causation_id: 'msg:parent',
    idempotency_key: 'idem:interop',
    kind: 'request',
    intent: { canonical_label: 'Commerce.Purchase', version: '1.0.0' },
    sender: { entity_id: 'human:1', kind: 'Human', canonical_label: 'Human.Customer' },
    receiver: { entity_id: 'agent:shopper', kind: 'Agent', canonical_label: 'Enterprise.Employee.PersonalShopper' },
    timestamp: '2026-09-02T20:00:00.000Z',
    delegation: { delegation_id: 'delegation:1', chain_digest: 'chain:digest' },
    responsibility_chain_ref: 'responsibility:1',
    payload: { schema: 'schema://purchase', value: { sku: 'A', quantity: 1 } },
    proofs: [{ type: 'delegation', ref: 'proof:delegation' }],
  };
}

test('MCP and A2A bridge construction isolates metadata and payload from caller mutation', () => {
  const source = envelope();
  const mcp = toMCPToolCall(source, 'commerce.purchase');
  const a2a = toA2ATask(source);

  (source.payload.value as { sku: string }).sku = 'FORGED';
  source.sender.entity_id = 'human:forged';
  source.delegation!.chain_digest = 'forged-chain';
  source.proofs![0]!.ref = 'proof:forged';

  assert.deepEqual(mcp.params.arguments, { sku: 'A', quantity: 1 });
  assert.equal(mcp.params._meta.h2a2h.sender.entity_id, 'human:1');
  assert.equal(a2a.metadata.h2a2h.delegation?.chain_digest, 'chain:digest');
  assert.equal(a2a.metadata.h2a2h.proofs?.[0]?.ref, 'proof:delegation');
});

test('untrusted MCP extraction validates method, structure, metadata and strict versions', () => {
  const valid = toMCPToolCall(envelope(), 'commerce.purchase');
  assert.equal(metadataFromMCP(valid).interaction_id, 'interaction:interop');

  assert.throws(() => metadataFromMCP({ ...valid, method: 'tools/list' }), /interop\.mcp\.method_invalid/);
  assert.throws(
    () => metadataFromMCP({ ...valid, params: { ...valid.params, name: '' } }),
    /interop\.mcp\.tool_required/,
  );
  assert.throws(
    () => metadataFromMCP({
      ...valid,
      params: {
        ...valid.params,
        _meta: { h2a2h: { ...valid.params._meta.h2a2h, version: '01.0.0' } },
      },
    }),
    /interop\.version_invalid/,
  );
  assert.throws(
    () => metadataFromMCP({
      ...valid,
      params: { ...valid.params, _meta: { h2a2h: { ...valid.params._meta.h2a2h, unexpected: true } } },
    }),
    /interop\.unknown_field:unexpected/,
  );
});

test('untrusted A2A extraction validates role against H2A2H sender authority', () => {
  const valid = toA2ATask(envelope());
  assert.equal(valid.role, 'user');
  assert.equal(metadataFromA2A(valid).sender.kind, 'Human');

  assert.throws(() => metadataFromA2A({ ...valid, role: 'agent' }), /interop\.a2a\.role_authority_mismatch/);
  assert.throws(
    () => metadataFromA2A({ ...valid, parts: [{ kind: 'text', data: 'forged' }] }),
    /interop\.a2a\.part_kind_invalid/,
  );
});

test('authority preservation detects every authority-critical bridge mutation', () => {
  const before = metadataFromMCP(toMCPToolCall(envelope(), 'commerce.purchase'));
  const cases: Array<[BridgeMetadata, RegExp]> = [
    [{ ...before, version: '1.0.1' }, /interop\.protocol_changed/],
    [{ ...before, causation_id: 'msg:other' }, /interop\.causation_changed/],
    [{ ...before, sender: { ...before.sender, entity_id: 'human:other' } }, /interop\.participant_changed/],
    [{ ...before, receiver: { ...before.receiver, entity_id: 'agent:other' } }, /interop\.participant_changed/],
    [{ ...before, delegation: { ...before.delegation!, chain_digest: 'chain:other' } }, /interop\.delegation_changed/],
    [{ ...before, proofs: [{ type: 'delegation', ref: 'proof:other' }] }, /interop\.proofs_changed/],
    [{ ...before, idempotency_key: 'idem:other' }, /interop\.idempotency_changed/],
  ];
  for (const [after, expected] of cases) assert.throws(() => assertBridgePreservesAuthority(before, after), expected);
});

test('existing authority error categories remain stable for correlation, Intent and responsibility changes', () => {
  const before = metadataFromMCP(toMCPToolCall(envelope(), 'commerce.purchase'));
  assert.throws(
    () => assertBridgePreservesAuthority(before, { ...before, correlation_id: 'correlation:other' }),
    /interop\.correlation_lost/,
  );
  assert.throws(
    () => assertBridgePreservesAuthority(before, { ...before, intent: { ...before.intent, canonical_label: 'Other.Intent' } }),
    /interop\.intent_changed/,
  );
  assert.throws(
    () => assertBridgePreservesAuthority(before, { ...before, responsibility_chain_ref: 'responsibility:other' }),
    /interop\.responsibility_lost/,
  );
});
