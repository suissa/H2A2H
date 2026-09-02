import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import {
  deriveEmployeeToolExecutionIdentity,
  type EmployeeAgentDefinition,
  type EmployeeToolCallContext,
} from '../employee-agent.js';
import type { EmployeeLifecycleBindings } from '../employee-tool-binding.js';
import type { EmployeeProviderPackManifest } from '../employee-provider-pack.js';
import type { EntityRef } from '../types.js';

export interface ReceivedProviderRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export function providerRoutes(manifest: EmployeeProviderPackManifest): Readonly<Record<string, string>> {
  assert.ok(manifest.binding, `${manifest.canonical_label} must have HTTP binding`);
  return manifest.binding.routes;
}

export async function withProviderServer(
  run: (baseUrl: string, received: ReceivedProviderRequest[]) => Promise<void>,
): Promise<void> {
  const received: ReceivedProviderRequest[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      received.push({
        path: request.url ?? '',
        headers: request.headers,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, path: request.url }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`, received);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

export function testLifecycleOptions(
  employee: EmployeeAgentDefinition,
  human: EntityRef,
  validDelegation: string,
  responsibilityChainRef: string,
): EmployeeLifecycleBindings {
  const agent: EntityRef = {
    entity_id: `agent:${employee.contract.identity.canonical_label}`,
    kind: 'Agent',
    canonical_label: employee.contract.identity.canonical_label,
  };
  return {
    humanApproval: {
      resolveRequiredTriggers: async (context) => {
        const tool = employee.contract.tools.find((candidate) => candidate.name === context.operation.tool);
        if (!tool?.side_effect) return [];
        const trigger = employee.contract.risk.human_approval_required_for[0];
        return trigger ? [trigger] : [];
      },
      verifyEvidence: async (binding) =>
        binding.approved_by === human.entity_id && binding.evidence_ref.startsWith('approval:'),
    },
    validateDelegation: async (context) => ({
      valid: context.input.delegation_ref === validDelegation,
      ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : {}),
      ...(context.input.delegation_ref === validDelegation ? {} : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: responsibilityChainRef,
    }),
    resolveChannel: async () => ({ profile: 'memory' }),
    returnToHuman: async (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };
}

export function directProviderToolContext(
  employee: EmployeeAgentDefinition,
  human: EntityRef,
  intentLabel: string,
  tool: string,
  interactionId: string,
  delegationRef: string,
): EmployeeToolCallContext {
  const operation = { tool, input: { test: true } };
  return {
    employee,
    operation,
    execution: deriveEmployeeToolExecutionIdentity({
      interaction_id: interactionId,
      intent_canonical_label: intentLabel,
      employee_canonical_label: employee.contract.identity.canonical_label,
      operation_index: 0,
      tool_canonical_label: tool,
      operation_input: operation.input,
    }),
    interaction: {
      interaction_id: interactionId,
      correlation_id: `correlation:${interactionId}`,
      state: 'EXECUTING',
      initiating_human: human,
      intent: {
        ref: { canonical_label: intentLabel, version: '0.1.0' },
        input_schema: 'input',
        output_schema: 'output',
      },
      input: { delegation_ref: delegationRef, request_payload: {} },
      transitions: [],
    },
  };
}
