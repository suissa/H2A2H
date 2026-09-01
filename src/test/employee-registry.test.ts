import assert from 'node:assert/strict';
import test from 'node:test';
import { EmployeeAgentRegistry } from '../employee-registry.js';
import { businessTools, type EmployeeAgentRuntimeOptions, type EmployeeToolExecutor } from '../employee-agent.js';

const PERSONAL_SHOPPER = 'Enterprise.Employee.PersonalShopperAgent';
const CUSTOMER_SUPPORT = 'Enterprise.Employee.CustomerSupportAgent';

test('loads the complete Employee Agent catalog with unique normalized identities', async () => {
  const registry = await EmployeeAgentRegistry.fromCatalog();
  assert.equal(registry.entries.length, 105);
  assert.equal(new Set(registry.entries.map((entry) => entry.canonical_label)).size, 105);
  assert.equal(registry.get(PERSONAL_SHOPPER).slug, 'personal-shopper');
  assert.equal(registry.get(CUSTOMER_SUPPORT).canonical_label, CUSTOMER_SUPPORT);
  assert.ok(!registry.get(CUSTOMER_SUPPORT).canonical_label.endsWith('AgentAgent'));
});

test('every catalog entry resolves to matching Agent Card + H2A2H contract identity', async () => {
  const registry = await EmployeeAgentRegistry.fromCatalog();
  for (const entry of registry.entries) {
    const employee = await registry.load(entry.canonical_label);
    assert.equal(employee.contract.identity.canonical_label, entry.canonical_label);
    assert.equal(employee.contract.identity.department, entry.department);
    assert.equal(employee.contract.identity.human_role, entry.name);
    assert.ok(employee.agentCard.supportedInterfaces.length > 0);
    assert.ok(employee.agentCard.skills.length > 0);
  }
});

test('resolves Employee Agents by department and role slug', async () => {
  const registry = await EmployeeAgentRegistry.fromCatalog();
  const entry = registry.getByRole('engineering-it', 'software-engineer');
  assert.equal(entry.canonical_label, 'Enterprise.Employee.SoftwareEngineerAgent');
  assert.ok(registry.list({ department: 'finance' }).length > 0);
  assert.ok(registry.list({ department: 'finance' }).every((candidate) => candidate.department === 'finance'));
});

test('dynamically instantiates an Employee Agent without role-specific factory branching', async () => {
  const registry = await EmployeeAgentRegistry.fromCatalog();
  const runtime = await registry.createRuntime(PERSONAL_SHOPPER, async (employee): Promise<EmployeeAgentRuntimeOptions> => {
    const toolExecutors: Record<string, EmployeeToolExecutor> = {};
    for (const tool of businessTools(employee)) {
      toolExecutors[tool.name] = async (input) => ({ tool: tool.name, input });
    }

    return {
      toolExecutors,
      validateDelegation: async (context) => ({
        valid: Boolean(context.input.delegation_ref),
        ...(context.input.delegation_ref ? { delegation_id: context.input.delegation_ref } : { reason: 'delegation.missing' }),
      }),
      resolveParticipants: async (context) => ({
        sender: context.initiating_human,
        receiver: {
          entity_id: `agent:${employee.contract.identity.canonical_label}`,
          kind: 'Agent',
          canonical_label: employee.contract.identity.canonical_label,
        },
        receiving_human: context.initiating_human,
        responsibility_chain_ref: `responsibility:${context.interaction_id}`,
      }),
      resolveChannel: async () => ({ profile: 'memory' }),
      returnToHuman: async (context) => ({
        proof_ref: `pohr:${context.interaction_id}`,
        return_state: 'human_presented',
      }),
    };
  });

  assert.equal(runtime.employee.contract.identity.canonical_label, PERSONAL_SHOPPER);
});
