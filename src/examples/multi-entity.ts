import {
  H2A2HSDK,
  InMemoryChannelAdapter,
  type EntityKind,
  type H2A2HEnvelope,
  type RuntimeBindings,
} from '../index.js';

export type MultiEntityKind = 'Organization' | 'Service' | 'Device' | 'Government';

export async function runMultiEntityScenario(kind: MultiEntityKind) {
  const humanA = { entity_id: 'human:origin', kind: 'Human' as const };
  const agentA = { entity_id: 'agent:origin', kind: 'Agent' as const };
  const intermediate = { entity_id: `${kind.toLowerCase()}:target`, kind: kind as EntityKind };
  const agentB = { entity_id: 'agent:receiver', kind: 'Agent' as const };
  const humanB = { entity_id: 'human:receiver', kind: 'Human' as const };

  const targetDecl = {
    channel_id: `target-${kind}`,
    transport: 'in-memory' as const,
    mode: 'request_reply' as const,
    endpoint: { address: `multi.target.${kind}` },
    versions: ['1.x'],
    security: { profile: 'h2a2h.security.local-trusted.v1' },
  };
  const receiverDecl = {
    channel_id: 'receiver-agent',
    transport: 'in-memory' as const,
    mode: 'request_reply' as const,
    endpoint: { address: 'multi.agent.receiver' },
    versions: ['1.x'],
    security: { profile: 'h2a2h.security.local-trusted.v1' },
  };

  const agentAToTarget = new InMemoryChannelAdapter(targetDecl);
  const targetServer = new InMemoryChannelAdapter(targetDecl);
  const targetToAgentB = new InMemoryChannelAdapter(receiverDecl);
  const agentBServer = new InMemoryChannelAdapter(receiverDecl);

  const stopAgentB = agentBServer.respond(async (request: H2A2HEnvelope) => ({
    ...request,
    message_id: `msg:${kind}:agent-b-response`,
    causation_id: request.message_id,
    kind: 'response',
    sender: agentB,
    receiver: agentA,
    payload: {
      schema: 'schema://example/multi-entity/output/1',
      value: {
        route: [humanA.entity_id, agentA.entity_id, intermediate.entity_id, agentB.entity_id, humanB.entity_id],
        intermediate_kind: kind,
        delegation_chain: ['delegation:human-to-agent-a', 'delegation:agent-a-to-intermediate'],
      },
    },
  }));

  const stopTarget = targetServer.respond(async (request: H2A2HEnvelope) => {
    const forwarded: H2A2HEnvelope = {
      ...request,
      message_id: `msg:${kind}:target-to-agent-b`,
      causation_id: request.message_id,
      sender: intermediate,
      receiver: agentB,
      delegation: {
        delegation_id: 'delegation:agent-a-to-intermediate',
        chain_digest: 'delegation-chain:root-child',
      },
    };
    return targetToAgentB.request(forwarded);
  });

  let sdk!: H2A2HSDK<{ command: string }, unknown>;
  const bindings: RuntimeBindings<{ command: string }, unknown> = {
    resolveIntent: () => ({
      ref: { canonical_label: 'Example.MultiEntityAction', version: '1.0.0' },
      input_schema: 'schema://example/multi-entity/input/1',
      output_schema: 'schema://example/multi-entity/output/1',
      acknowledgement_required: true,
    }),
    validateDelegation: () => ({
      valid: true,
      delegation_id: 'delegation:human-to-agent-a',
      evidence: ['delegation-chain:root-child'],
    }),
    resolveParticipants: () => ({
      sender: agentA,
      receiver: intermediate,
      receiving_human: humanB,
      responsibility_chain_ref: `responsibility:human-agent-${kind}-agent-human`,
    }),
    resolveChannel: () => ({ profile: 'h2a2h.channel.in-memory.v1' }),
    execute: async (context) => {
      const envelope = sdk.createEnvelope({
        interaction_id: context.interaction_id,
        correlation_id: context.correlation_id,
        kind: 'request',
        intent: context.intent.ref,
        sender: agentA,
        receiver: intermediate,
        schema: context.intent.input_schema,
        value: context.input,
        delegation_id: 'delegation:human-to-agent-a',
        responsibility_chain_ref: `responsibility:human-agent-${kind}-agent-human`,
        channel_profile: 'h2a2h.channel.in-memory.v1',
      });
      return (await agentAToTarget.request(envelope)).payload.value;
    },
    returnToHuman: () => ({ proof_ref: `pohr:multi:${kind}`, return_state: 'human_acknowledged' }),
    acknowledge: async () => {},
  };
  sdk = new H2A2HSDK(bindings);

  try {
    const context = await sdk.run({
      initiating_human: humanA,
      intent: { canonical_label: 'Example.MultiEntityAction', version: '1.0.0' },
      input: { command: `execute through ${kind}` },
    });
    return {
      kind,
      context,
      audit_verification: sdk.verifyAudit(),
      route: (context.result as { route: string[] }).route,
      delegation_chain: (context.result as { delegation_chain: string[] }).delegation_chain,
    };
  } finally {
    stopTarget();
    stopAgentB();
  }
}
