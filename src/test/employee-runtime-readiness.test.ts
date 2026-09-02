import assert from 'node:assert/strict';
import test from 'node:test';
import {
  businessTools,
  type EmployeeAgentDefinition,
} from '../employee-agent.js';
import {
  activateEmployeeProviderPlan,
  discoverEmployeeProviderPacks,
  planEmployeeProviderActivation,
  type EmployeeProviderPackCatalogEntry,
} from '../employee-provider-catalog.js';
import { EmployeeProviderPackRegistry } from '../employee-provider-pack.js';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import {
  createCapabilityBackedOptionsFactory,
  type EmployeeLifecycleBindings,
} from '../employee-tool-binding.js';
import { EmployeeToolRegistry } from '../employee-tool-registry.js';
import {
  createEmployeeHumanApprovalGovernance,
  type EmployeeHumanApprovalEvidenceBinding,
} from '../employee-human-approval.js';
import { createDeclarativeHttpJsonProviderPackFactory } from '../provider-packs/http-json-domain.js';
import { H2A2HSDK } from '../sdk.js';
import type { EmployeeProviderPackManifest } from '../employee-provider-pack.js';
import type { EntityRef } from '../types.js';

const human: EntityRef = {
  entity_id: 'human:employee-readiness-owner',
  kind: 'Human',
  canonical_label: 'Human.EmployeeReadinessOwner',
};

interface ProviderCall {
  capability: string;
  input: unknown;
  context: Record<string, unknown>;
}

function sampleConfig(manifest: EmployeeProviderPackManifest): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of manifest.config_schema.required ?? []) {
    const property = manifest.config_schema.properties[key];
    assert.ok(property, `${manifest.canonical_label} required config ${key} must be declared`);
    if (key === 'base_url') {
      config[key] = 'https://provider.example.test';
      continue;
    }
    switch (property.type) {
      case 'string': config[key] = `test:${key}`; break;
      case 'number': config[key] = 1000; break;
      case 'boolean': config[key] = true; break;
      case 'object': config[key] = {}; break;
      case 'array': config[key] = []; break;
    }
  }
  return config;
}

function sampleSecrets(manifest: EmployeeProviderPackManifest): Record<string, string> {
  return Object.fromEntries(
    manifest.secrets
      .filter((secret) => secret.required)
      .map((secret) => [secret.name, `test-secret:${secret.name}`]),
  );
}

function sameApproval(
  expected: EmployeeHumanApprovalEvidenceBinding | undefined,
  actual: EmployeeHumanApprovalEvidenceBinding,
): boolean {
  if (!expected) return false;
  return expected.evidence_ref === actual.evidence_ref
    && expected.approved_by === actual.approved_by
    && expected.employee_canonical_label === actual.employee_canonical_label
    && expected.intent_canonical_label === actual.intent_canonical_label
    && expected.tool_canonical_label === actual.tool_canonical_label
    && expected.delegation_ref === actual.delegation_ref
    && expected.correlation_id === actual.correlation_id
    && expected.interaction_id === actual.interaction_id
    && JSON.stringify(expected.risk_triggers) === JSON.stringify(actual.risk_triggers);
}

function lifecycleOptions(
  employee: EmployeeAgentDefinition,
  approvalRequirements: Map<string, string[]>,
  approvalEvidence: Map<string, EmployeeHumanApprovalEvidenceBinding>,
): EmployeeLifecycleBindings {
  const agent: EntityRef = {
    entity_id: `agent:${employee.contract.identity.canonical_label}`,
    kind: 'Agent',
    canonical_label: employee.contract.identity.canonical_label,
  };

  return {
    humanApproval: createEmployeeHumanApprovalGovernance({
      resolveRequiredTriggers: async (context) => approvalRequirements.get(context.interaction.interaction_id) ?? [],
      verifyEvidence: async (binding) => sameApproval(approvalEvidence.get(binding.evidence_ref), binding),
    }),
    validateDelegation: async (context) => ({
      valid: context.input.delegation_ref === 'delegation:readiness',
      ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : {}),
      ...(context.input.delegation_ref === 'delegation:readiness'
        ? { evidence: ['delegation-proof:readiness'] }
        : { reason: 'delegation.invalid' }),
    }),
    resolveParticipants: async () => ({
      sender: human,
      receiver: agent,
      receiving_human: human,
      responsibility_chain_ref: `responsibility:${employee.contract.identity.canonical_label}`,
    }),
    resolveChannel: async () => ({
      profile: 'provider-pack:http-json',
      metadata: { resolved_from: 'OpenEntityChannels/OpenIntent' },
    }),
    returnToHuman: async (context) => ({
      proof_ref: `pohr:${context.interaction_id}`,
      return_state: 'human_presented',
    }),
  };
}

function fakeManifest(
  canonicalLabel: string,
  capabilities: string[],
): EmployeeProviderPackCatalogEntry {
  return {
    path: `providers/${canonicalLabel}/manifest.json`,
    manifest: {
      canonical_label: canonicalLabel,
      version: '0.1.0',
      domain: 'test',
      provider_kind: 'injected',
      capabilities,
      config_schema: { type: 'object', properties: {}, additionalProperties: false },
      secrets: [],
      runtime: { network: false, protocols: [] },
    },
  };
}

test('Provider Pack planner selects a deterministic non-overlapping catalog and fails closed when impossible', async () => {
  const tools = await EmployeeToolRegistry.load();
  const catalog = await discoverEmployeeProviderPacks(tools);
  const required = tools.list()
    .filter((capability) => capability.provider_required)
    .map((capability) => capability.canonical_label);
  const plan = planEmployeeProviderActivation(catalog, required);

  assert.ok(catalog.length >= plan.selected.length);
  assert.ok(catalog.some((entry) => entry.manifest.recovery?.mode === 'provider-idempotency'));
  assert.ok(catalog.some((entry) => entry.manifest.recovery?.mode === 'reconciliation'));
  assert.equal(plan.selected.length, 13);
  assert.equal(plan.required_capabilities.length, 65);
  assert.equal(plan.covered_capabilities.length, 65);
  assert.equal(Object.keys(plan.alternatives).length, 5);
  assert.ok(plan.selected.every((entry) => entry.manifest.provider_kind === 'http-json'));

  assert.throws(
    () => planEmployeeProviderActivation([
      fakeManifest('ProviderPack.A', ['a', 'b']),
      fakeManifest('ProviderPack.B', ['b', 'c']),
    ], ['a', 'c']),
    /No non-overlapping Provider Pack activation plan/,
  );
  assert.throws(
    () => planEmployeeProviderActivation([fakeManifest('ProviderPack.A', ['a'])], ['missing']),
    /No Provider Pack covers required capability missing/,
  );
});

test('all 105 Employee Agents are runtime-ready from shared Provider Packs with delegated reads and semantic HumanRequired approval', async () => {
  const tools = await EmployeeToolRegistry.load();
  const providerCatalog = await discoverEmployeeProviderPacks(tools);
  const requiredCapabilities = tools.list()
    .filter((capability) => capability.provider_required)
    .map((capability) => capability.canonical_label);
  const activationPlan = planEmployeeProviderActivation(providerCatalog, requiredCapabilities);

  const providerCalls: ProviderCall[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('Expected JSON string body from declarative HTTP Provider Pack');
    const request = JSON.parse(body) as ProviderCall;
    providerCalls.push(request);
    return new Response(JSON.stringify({
      ok: true,
      capability: request.capability,
      provider_call: providerCalls.length,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const providers = new EmployeeProviderPackRegistry(tools);
  const active = await activateEmployeeProviderPlan(providers, activationPlan, {
    factory: async (entry) => {
      assert.equal(entry.manifest.provider_kind, 'http-json');
      return createDeclarativeHttpJsonProviderPackFactory(fakeFetch);
    },
    config: async (entry) => sampleConfig(entry.manifest),
    secrets: async (entry) => sampleSecrets(entry.manifest),
  });
  assert.equal(active.length, 13);

  const employees = await EmployeeAgentRegistry.fromCatalog();
  const approvalRequirements = new Map<string, string[]>();
  const approvalEvidence = new Map<string, EmployeeHumanApprovalEvidenceBinding>();
  const departments = new Set<string>();
  let ready = 0;

  for (const entry of employees.entries) {
    const employee = await employees.load(entry.canonical_label);
    departments.add(employee.contract.identity.department);
    tools.assertEmployeeReady(employee);

    const allowedTools = businessTools(employee);
    const readTool = allowedTools.find((tool) => !tool.side_effect);
    const sideEffectTool = allowedTools.find((tool) => tool.side_effect);
    const riskTrigger = employee.contract.risk.human_approval_required_for[0];
    assert.ok(readTool, `${entry.canonical_label} must expose a read-only business capability`);
    assert.ok(sideEffectTool, `${entry.canonical_label} must expose a side-effect business capability`);
    assert.ok(riskTrigger, `${entry.canonical_label} must declare at least one Human approval trigger`);

    const optionsFactory = createCapabilityBackedOptionsFactory(
      tools,
      async (definition) => lifecycleOptions(definition, approvalRequirements, approvalEvidence),
    );
    const runtime = await employees.createRuntime(entry.canonical_label, optionsFactory);

    const readInteraction = `read:${entry.slug}`;
    const readCorrelation = `correlation:read:${entry.slug}`;
    const readCallStart = providerCalls.length;
    const readSdk = new H2A2HSDK(runtime.bindings());
    const readResult = await readSdk.run({
      initiating_human: human,
      interaction_id: readInteraction,
      correlation_id: readCorrelation,
      intent: { canonical_label: `${entry.canonical_label}.Analyze` },
      input: {
        delegation_ref: 'delegation:readiness',
        request_payload: { readiness: true },
        operations: [{ tool: readTool.name, input: { employee: entry.canonical_label } }],
      },
    });
    assert.equal(readResult.state, 'CLOSED');
    assert.equal(readResult.result?.tool_results[0]?.tool, readTool.name);
    assert.deepEqual(readResult.result?.provenance, [entry.canonical_label, `${entry.canonical_label}.Analyze`]);
    assert.match(readResult.human_return?.proof_ref ?? '', /^pohr:/);
    assert.equal(readSdk.verifyAudit().valid, true);
    assert.equal(providerCalls.length, readCallStart + 1);
    const readCall = providerCalls.at(-1)!;
    assert.equal(readCall.capability, readTool.name);
    assert.equal(readCall.context.correlation_id, readCorrelation);
    assert.equal(readCall.context.delegation_ref, 'delegation:readiness');

    const deniedInteraction = `denied:${entry.slug}`;
    approvalRequirements.set(deniedInteraction, [riskTrigger]);
    const deniedCallStart = providerCalls.length;
    const deniedSdk = new H2A2HSDK(runtime.bindings());
    const deniedResult = await deniedSdk.run({
      initiating_human: human,
      interaction_id: deniedInteraction,
      correlation_id: `correlation:denied:${entry.slug}`,
      intent: { canonical_label: `${entry.canonical_label}.Execute` },
      input: {
        delegation_ref: 'delegation:readiness',
        request_payload: { readiness: true },
        operations: [{
          tool: sideEffectTool.name,
          input: { employee: entry.canonical_label },
          risk_triggers: [],
        }],
      },
    });
    assert.equal(deniedResult.state, 'HUMAN_ESCALATION_REQUIRED');
    assert.equal(deniedResult.human_escalation?.code, 'human.approval_required');
    assert.equal(deniedResult.human_escalation?.resume_state, 'EXECUTING');
    assert.equal(deniedResult.human_escalation?.human_action.canonical_label, 'Human.Approval.Provide');
    assert.equal(deniedSdk.verifyAudit().valid, true);
    assert.equal(providerCalls.length, deniedCallStart, `${entry.canonical_label} provider must not execute before Human approval`);

    const executeInteraction = `execute:${entry.slug}`;
    const executeCorrelation = `correlation:execute:${entry.slug}`;
    const evidenceRef = `approval:${entry.slug}`;
    approvalRequirements.set(executeInteraction, [riskTrigger]);
    approvalEvidence.set(evidenceRef, {
      evidence_ref: evidenceRef,
      approved_by: human.entity_id,
      employee_canonical_label: entry.canonical_label,
      intent_canonical_label: `${entry.canonical_label}.Execute`,
      tool_canonical_label: sideEffectTool.name,
      delegation_ref: 'delegation:readiness',
      correlation_id: executeCorrelation,
      interaction_id: executeInteraction,
      risk_triggers: [riskTrigger],
    });

    const executeCallStart = providerCalls.length;
    const executeSdk = new H2A2HSDK(runtime.bindings());
    const executeResult = await executeSdk.run({
      initiating_human: human,
      interaction_id: executeInteraction,
      correlation_id: executeCorrelation,
      intent: { canonical_label: `${entry.canonical_label}.Execute` },
      input: {
        delegation_ref: 'delegation:readiness',
        request_payload: { readiness: true },
        human_approval: {
          granted: true,
          approved_by: human.entity_id,
          evidence_ref: evidenceRef,
        },
        operations: [{
          tool: sideEffectTool.name,
          input: { employee: entry.canonical_label },
          risk_triggers: [],
        }],
      },
    });
    assert.equal(executeResult.state, 'CLOSED');
    assert.equal(executeResult.result?.tool_results[0]?.tool, sideEffectTool.name);
    assert.match(executeResult.human_return?.proof_ref ?? '', /^pohr:/);
    assert.equal(executeSdk.verifyAudit().valid, true);
    assert.equal(providerCalls.length, executeCallStart + 1);
    const executeCall = providerCalls.at(-1)!;
    assert.equal(executeCall.capability, sideEffectTool.name);
    assert.equal(executeCall.context.correlation_id, executeCorrelation);
    assert.equal(executeCall.context.delegation_ref, 'delegation:readiness');
    assert.equal(executeCall.context.approval_evidence_ref, evidenceRef);

    ready += 1;
  }

  assert.equal(employees.entries.length, 105);
  assert.equal(ready, 105);
  assert.equal(departments.size, 13);
  assert.equal(requiredCapabilities.length, 65);
  console.log(
    `Employee runtime readiness valid: ${ready}/${employees.entries.length} Employees, ${departments.size} departments, ${requiredCapabilities.length} business capabilities, ${active.length} active Provider Packs.`,
  );
});
