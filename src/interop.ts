import { canonicalJson } from './security.js';
import type { EntityRef, H2A2HEnvelope, IntentRef } from './types.js';
import { parseVersion } from './versioning.js';

export interface BridgeMetadata {
  protocol: 'h2a2h';
  version: string;
  interaction_id: string;
  correlation_id: string;
  causation_id?: string;
  intent: IntentRef;
  sender: EntityRef;
  receiver: EntityRef;
  delegation?: H2A2HEnvelope['delegation'];
  responsibility_chain_ref?: string;
  proofs?: H2A2HEnvelope['proofs'];
  idempotency_key?: string;
}

export interface MCPToolCall {
  method: 'tools/call';
  params: {
    name: string;
    arguments: unknown;
    _meta: { h2a2h: BridgeMetadata };
  };
}

export interface A2ATaskMessage {
  task_id: string;
  role: 'user' | 'agent';
  parts: Array<{ kind: 'data'; data: unknown }>;
  metadata: { h2a2h: BridgeMetadata };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`interop.unknown_field:${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`interop.field_required:${key}`);
  }
}

function requireNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function validateEntity(value: unknown, label: string): EntityRef {
  if (!isPlainObject(value)) throw new Error(`interop.${label}_invalid`);
  assertExactKeys(value, ['entity_id', 'kind'], ['canonical_label']);
  const entity: EntityRef = {
    entity_id: requireNonEmptyString(value['entity_id'], `interop.${label}.entity_id_required`),
    kind: requireNonEmptyString(value['kind'], `interop.${label}.kind_required`),
    ...(value['canonical_label'] !== undefined
      ? { canonical_label: requireNonEmptyString(value['canonical_label'], `interop.${label}.canonical_label_invalid`) }
      : {}),
  };
  return entity;
}

function validateIntent(value: unknown): IntentRef {
  if (!isPlainObject(value)) throw new Error('interop.intent_invalid');
  assertExactKeys(value, ['canonical_label', 'version']);
  const canonicalLabel = requireNonEmptyString(value['canonical_label'], 'interop.intent.canonical_label_required');
  const version = requireNonEmptyString(value['version'], 'interop.intent.version_required');
  try {
    parseVersion(version);
  } catch {
    throw new Error(`interop.intent.version_invalid:${version}`);
  }
  return { canonical_label: canonicalLabel, version };
}

function validateDelegation(value: unknown): NonNullable<H2A2HEnvelope['delegation']> {
  if (!isPlainObject(value)) throw new Error('interop.delegation_invalid');
  assertExactKeys(value, ['delegation_id'], ['chain_digest']);
  return {
    delegation_id: requireNonEmptyString(value['delegation_id'], 'interop.delegation.id_required'),
    ...(value['chain_digest'] !== undefined
      ? { chain_digest: requireNonEmptyString(value['chain_digest'], 'interop.delegation.chain_digest_invalid') }
      : {}),
  };
}

function validateProofs(value: unknown): NonNullable<H2A2HEnvelope['proofs']> {
  if (!Array.isArray(value)) throw new Error('interop.proofs_invalid');
  return value.map((item, index) => {
    if (!isPlainObject(item)) throw new Error(`interop.proof_invalid:${index}`);
    assertExactKeys(item, ['type', 'ref']);
    return {
      type: requireNonEmptyString(item['type'], `interop.proof.type_required:${index}`),
      ref: requireNonEmptyString(item['ref'], `interop.proof.ref_required:${index}`),
    };
  });
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function validateBridgeMetadata(value: unknown): BridgeMetadata {
  if (!isPlainObject(value)) throw new Error('interop.h2a2h_metadata_invalid');
  assertExactKeys(
    value,
    ['protocol', 'version', 'interaction_id', 'correlation_id', 'intent', 'sender', 'receiver'],
    ['causation_id', 'delegation', 'responsibility_chain_ref', 'proofs', 'idempotency_key'],
  );
  if (value['protocol'] !== 'h2a2h') throw new Error('interop.protocol_invalid');
  const version = requireNonEmptyString(value['version'], 'interop.version_required');
  try {
    parseVersion(version);
  } catch {
    throw new Error(`interop.version_invalid:${version}`);
  }

  const metadata: BridgeMetadata = {
    protocol: 'h2a2h',
    version,
    interaction_id: requireNonEmptyString(value['interaction_id'], 'interop.interaction_id_required'),
    correlation_id: requireNonEmptyString(value['correlation_id'], 'interop.correlation_id_required'),
    ...(value['causation_id'] !== undefined
      ? { causation_id: requireNonEmptyString(value['causation_id'], 'interop.causation_id_invalid') }
      : {}),
    intent: validateIntent(value['intent']),
    sender: validateEntity(value['sender'], 'sender'),
    receiver: validateEntity(value['receiver'], 'receiver'),
    ...(value['delegation'] !== undefined ? { delegation: validateDelegation(value['delegation']) } : {}),
    ...(value['responsibility_chain_ref'] !== undefined
      ? { responsibility_chain_ref: requireNonEmptyString(value['responsibility_chain_ref'], 'interop.responsibility_chain_ref_invalid') }
      : {}),
    ...(value['proofs'] !== undefined ? { proofs: validateProofs(value['proofs']) } : {}),
    ...(value['idempotency_key'] !== undefined
      ? { idempotency_key: requireNonEmptyString(value['idempotency_key'], 'interop.idempotency_key_invalid') }
      : {}),
  };

  // Reject non-JSON/accessor/prototype anomalies anywhere in the accepted tree and
  // return an isolated canonical clone.
  return canonicalClone(metadata);
}

function bridgeMetadata(envelope: H2A2HEnvelope): BridgeMetadata {
  return validateBridgeMetadata({
    protocol: 'h2a2h',
    version: envelope.version,
    interaction_id: envelope.interaction_id,
    correlation_id: envelope.correlation_id,
    ...(envelope.causation_id ? { causation_id: envelope.causation_id } : {}),
    intent: envelope.intent,
    sender: envelope.sender,
    receiver: envelope.receiver,
    ...(envelope.delegation ? { delegation: envelope.delegation } : {}),
    ...(envelope.responsibility_chain_ref ? { responsibility_chain_ref: envelope.responsibility_chain_ref } : {}),
    ...(envelope.proofs ? { proofs: envelope.proofs } : {}),
    ...(envelope.idempotency_key ? { idempotency_key: envelope.idempotency_key } : {}),
  });
}

export function toMCPToolCall(envelope: H2A2HEnvelope, toolName: string): MCPToolCall {
  const name = requireNonEmptyString(toolName, 'interop.mcp.tool_required');
  const value = canonicalClone(envelope.payload.value);
  return canonicalClone({
    method: 'tools/call',
    params: {
      name,
      arguments: value,
      _meta: { h2a2h: bridgeMetadata(envelope) },
    },
  });
}

export function toA2ATask(envelope: H2A2HEnvelope, taskId = envelope.interaction_id): A2ATaskMessage {
  const canonicalTaskId = requireNonEmptyString(taskId, 'interop.a2a.task_id_required');
  const value = canonicalClone(envelope.payload.value);
  return canonicalClone({
    task_id: canonicalTaskId,
    role: envelope.sender.kind === 'Human' ? 'user' : 'agent',
    parts: [{ kind: 'data', data: value }],
    metadata: { h2a2h: bridgeMetadata(envelope) },
  });
}

function equalAuthority(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function assertBridgePreservesAuthority(
  beforeInput: BridgeMetadata,
  afterInput: BridgeMetadata,
): void {
  const before = validateBridgeMetadata(beforeInput);
  const after = validateBridgeMetadata(afterInput);

  if (before.protocol !== after.protocol || before.version !== after.version) {
    throw new Error('interop.protocol_changed');
  }
  if (before.interaction_id !== after.interaction_id || before.correlation_id !== after.correlation_id) {
    throw new Error('interop.correlation_lost');
  }
  if (before.causation_id !== after.causation_id) throw new Error('interop.causation_changed');
  if (!equalAuthority(before.intent, after.intent)) throw new Error('interop.intent_changed');
  if (!equalAuthority(before.sender, after.sender) || !equalAuthority(before.receiver, after.receiver)) {
    throw new Error('interop.participant_changed');
  }
  if (!equalAuthority(before.delegation ?? null, after.delegation ?? null)) {
    throw new Error('interop.delegation_changed');
  }
  if (before.responsibility_chain_ref !== after.responsibility_chain_ref) {
    throw new Error('interop.responsibility_lost');
  }
  if (!equalAuthority(before.proofs ?? [], after.proofs ?? [])) throw new Error('interop.proofs_changed');
  if (before.idempotency_key !== after.idempotency_key) throw new Error('interop.idempotency_changed');
}

export function metadataFromMCP(callInput: unknown): BridgeMetadata {
  canonicalJson(callInput);
  if (!isPlainObject(callInput)) throw new Error('interop.mcp.call_invalid');
  assertExactKeys(callInput, ['method', 'params']);
  if (callInput['method'] !== 'tools/call') throw new Error('interop.mcp.method_invalid');
  const params = callInput['params'];
  if (!isPlainObject(params)) throw new Error('interop.mcp.params_invalid');
  assertExactKeys(params, ['name', 'arguments', '_meta']);
  requireNonEmptyString(params['name'], 'interop.mcp.tool_required');
  canonicalJson(params['arguments']);
  const meta = params['_meta'];
  if (!isPlainObject(meta)) throw new Error('interop.mcp.meta_invalid');
  assertExactKeys(meta, ['h2a2h']);
  if (!Object.prototype.hasOwnProperty.call(meta, 'h2a2h')) throw new Error('interop.mcp.h2a2h_metadata_required');
  return validateBridgeMetadata(meta['h2a2h']);
}

export function metadataFromA2A(messageInput: unknown): BridgeMetadata {
  canonicalJson(messageInput);
  if (!isPlainObject(messageInput)) throw new Error('interop.a2a.message_invalid');
  assertExactKeys(messageInput, ['task_id', 'role', 'parts', 'metadata']);
  requireNonEmptyString(messageInput['task_id'], 'interop.a2a.task_id_required');
  if (messageInput['role'] !== 'user' && messageInput['role'] !== 'agent') throw new Error('interop.a2a.role_invalid');
  const parts = messageInput['parts'];
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('interop.a2a.parts_required');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isPlainObject(part)) throw new Error(`interop.a2a.part_invalid:${index}`);
    assertExactKeys(part, ['kind', 'data']);
    if (part['kind'] !== 'data') throw new Error(`interop.a2a.part_kind_invalid:${index}`);
    canonicalJson(part['data']);
  }
  const outerMetadata = messageInput['metadata'];
  if (!isPlainObject(outerMetadata)) throw new Error('interop.a2a.metadata_invalid');
  assertExactKeys(outerMetadata, ['h2a2h']);
  if (!Object.prototype.hasOwnProperty.call(outerMetadata, 'h2a2h')) throw new Error('interop.a2a.h2a2h_metadata_required');
  const metadata = validateBridgeMetadata(outerMetadata['h2a2h']);
  const expectedRole = metadata.sender.kind === 'Human' ? 'user' : 'agent';
  if (messageInput['role'] !== expectedRole) throw new Error('interop.a2a.role_authority_mismatch');
  return metadata;
}
