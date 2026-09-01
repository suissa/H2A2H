import type { EntityRef, H2A2HEnvelope, IntentRef } from './types.js';

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

function bridgeMetadata(envelope: H2A2HEnvelope): BridgeMetadata {
  return {
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
  };
}

export function toMCPToolCall(envelope: H2A2HEnvelope, toolName: string): MCPToolCall {
  if (!toolName) throw new Error('interop.mcp.tool_required');
  return {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: envelope.payload.value,
      _meta: { h2a2h: bridgeMetadata(envelope) },
    },
  };
}

export function toA2ATask(envelope: H2A2HEnvelope, taskId = envelope.interaction_id): A2ATaskMessage {
  return {
    task_id: taskId,
    role: envelope.sender.kind === 'Human' ? 'user' : 'agent',
    parts: [{ kind: 'data', data: envelope.payload.value }],
    metadata: { h2a2h: bridgeMetadata(envelope) },
  };
}

export function assertBridgePreservesAuthority(
  before: BridgeMetadata,
  after: BridgeMetadata,
): void {
  if (before.interaction_id !== after.interaction_id || before.correlation_id !== after.correlation_id) {
    throw new Error('interop.correlation_lost');
  }
  if (before.intent.canonical_label !== after.intent.canonical_label || before.intent.version !== after.intent.version) {
    throw new Error('interop.intent_changed');
  }
  if (before.delegation?.delegation_id !== after.delegation?.delegation_id) {
    throw new Error('interop.delegation_changed');
  }
  if (before.responsibility_chain_ref !== after.responsibility_chain_ref) {
    throw new Error('interop.responsibility_lost');
  }
}

export function metadataFromMCP(call: MCPToolCall): BridgeMetadata {
  const metadata = call.params._meta?.h2a2h;
  if (!metadata) throw new Error('interop.mcp.h2a2h_metadata_required');
  return metadata;
}

export function metadataFromA2A(message: A2ATaskMessage): BridgeMetadata {
  const metadata = message.metadata?.h2a2h;
  if (!metadata) throw new Error('interop.a2a.h2a2h_metadata_required');
  return metadata;
}
