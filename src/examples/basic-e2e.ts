import {
  DelegationSessionStore,
  H2A2HSDK,
  InMemoryChannelAdapter,
  type H2A2HEnvelope,
  type RuntimeBindings,
} from '../index.js';

export interface BasicScenarioOptions {
  revoke_before_run?: boolean;
}

export async function runBasicH2A2HScenario(options: BasicScenarioOptions = {}) {
  const humanA = { entity_id: 'human:alice', kind: 'Human' as const };
  const agentA = { entity_id: 'agent:alice-assistant', kind: 'Agent' as const };
  const agentB = { entity_id: 'agent:bob-service', kind: 'Agent' as const };
  const humanB = { entity_id: 'human:bob', kind: 'Human' as const };

  const sessions = new DelegationSessionStore();
  const session = sessions.create({
    delegation_id: 'delegation:alice-to-agent-a',
    delegation_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    max_session_ms: 30 * 60 * 1000,
    scopes: ['example.message.send'],
    intents: ['Example.DeliverMessage'],
  });
  if (options.revoke_before_run) sessions.revoke(session.session_id, 'human.revoked');

  const declaration = {
    channel_id: 'agent-b-in-memory',
    transport: 'in-memory' as const,
    mode: 'request_reply' as const,
    endpoint: { address: 'example.agent-b' },
    versions: ['1.x'],
    security: { profile: 'h2a2h.security.local-trusted.v1' },
  };
  const agentBChannel = new InMemoryChannelAdapter(declaration);
  const agentAChannel = new InMemoryChannelAdapter(declaration);

  const stopResponder = agentBChannel.respond(async (request: H2A2HEnvelope) => ({
    ...request,
    message_id: 'msg:agent-b-result',
    causation_id: request.message_id,
    kind: 'response',
    sender: agentB,
    receiver: agentA,
    payload: {
      schema: 'schema://example/deliver-message/output/1',
      value: {
        accepted_by: agentB.entity_id,
        original: request.payload.value,
      },
    },
  }));

  let sdk!: H2A2HSDK<{ message: string }, unknown>;

  const bindings: RuntimeBindings<{ message: string }, unknown> = {
    resolveIntent: () => ({
      ref: { canonical_label: 'Example.DeliverMessage', version: '1.0.0' },
      input_schema: 'schema://example/deliver-message/input/1',
      output_schema: 'schema://example/deliver-message/output/1',
      acknowledgement_required: true,
    }),
    validateDelegation: () => {
      try {
        sessions.assertActive(session.session_id, {
          scope: 'example.message.send',
          intent: 'Example.DeliverMessage',
        });
        return {
          valid: true,
          delegation_id: session.delegation_id,
          evidence: [`session:${session.session_id}`],
        };
      } catch (error) {
        return {
          valid: false,
          reason: error instanceof Error && error.message.includes('revoked')
            ? 'delegation.revoked'
            : 'delegation.expired',
        };
      }
    },
    resolveParticipants: () => ({
      sender: agentA,
      receiver: agentB,
      receiving_human: humanB,
      responsibility_chain_ref: 'responsibility:alice-agent-a-agent-b-bob',
    }),
    resolveChannel: () => ({
      profile: 'h2a2h.channel.in-memory.v1',
      metadata: { channel_id: declaration.channel_id },
    }),
    execute: async (context) => {
      const envelope = sdk.createEnvelope({
        interaction_id: context.interaction_id,
        correlation_id: context.correlation_id,
        kind: 'request',
        intent: context.intent.ref,
        sender: agentA,
        receiver: agentB,
        schema: context.intent.input_schema,
        value: context.input,
        delegation_id: session.delegation_id,
        responsibility_chain_ref: context.participants?.responsibility_chain_ref,
        channel_profile: 'h2a2h.channel.in-memory.v1',
      });
      const response = await agentAChannel.request(envelope);
      return response.payload.value;
    },
    returnToHuman: () => ({
      proof_ref: 'pohr:basic-e2e',
      return_state: 'human_acknowledged',
    }),
    acknowledge: async () => {},
  };

  sdk = new H2A2HSDK(bindings);

  try {
    const context = await sdk.run({
      initiating_human: humanA,
      intent: { canonical_label: 'Example.DeliverMessage', version: '1.0.0' },
      input: { message: 'hello from Human A' },
    });
    const pohr = sdk.finalizeHumanReturn({
      interaction_id: context.interaction_id,
      target_human: humanB,
      result: context.result,
      channel_profile: 'h2a2h.channel.in-memory.v1',
      return_state: 'human_acknowledged',
      evidence_ref: context.human_return?.proof_ref ?? 'pohr:missing',
    });
    return {
      context,
      pohr,
      audit: sdk.getAudit(),
      audit_verification: sdk.verifyAudit(),
      participants: { humanA, agentA, agentB, humanB },
    };
  } finally {
    stopResponder();
  }
}
