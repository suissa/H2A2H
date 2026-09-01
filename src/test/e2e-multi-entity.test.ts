import test from 'node:test';
import assert from 'node:assert/strict';
import { runMultiEntityScenario, type MultiEntityKind } from '../examples/multi-entity.js';

for (const kind of ['Organization', 'Service', 'Device', 'Government'] as const satisfies readonly MultiEntityKind[]) {
  test(`same H2A2H primitives support ${kind} as an intermediate Entity`, async () => {
    const result = await runMultiEntityScenario(kind);
    assert.equal(result.context.state, 'CLOSED');
    assert.deepEqual(result.audit_verification, { valid: true });
    assert.equal(result.route[2], `${kind.toLowerCase()}:target`);
    assert.deepEqual(result.delegation_chain, [
      'delegation:human-to-agent-a',
      'delegation:agent-a-to-intermediate',
    ]);
    assert.equal(result.route.at(0), 'human:origin');
    assert.equal(result.route.at(-1), 'human:receiver');
  });
}
