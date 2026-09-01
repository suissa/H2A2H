# Personal Shopper Agent

`Enterprise.Employee.PersonalShopperAgent` is the first executable Employee Agent vertical slice in the H2A2H reference implementation.

## Identity

- Public discovery identity: `agent-card.json` using the A2A v1 Agent Card model.
- H2A2H semantic/authority identity: `h2a2h.employee.yml`.
- Canonical label: `Enterprise.Employee.PersonalShopperAgent`.
- Accountable Human: the delegating Human.

The Agent Card is not authority. It advertises the Agent and its A2A interfaces/skills. Authority is supplied only by a valid H2A2H delegation.

## Intents

All executable behavior remains inside the Intents declared in `h2a2h.employee.yml`:

- `Enterprise.Employee.PersonalShopperAgent.Analyze`
- `Enterprise.Employee.PersonalShopperAgent.Prepare`
- `Enterprise.Employee.PersonalShopperAgent.Execute`
- `Enterprise.Employee.PersonalShopperAgent.Review`
- `Enterprise.Employee.PersonalShopperAgent.Report`

The generic Employee Agent runtime rejects any Intent outside this namespace or absent from the contract.

## Business tools

The runtime requires implementations for every business tool declared with `permission: allow`:

- `commerce.catalog.search`
- `commerce.offer.compare`
- `commerce.cart.prepare`
- `commerce.order.status`
- `commerce.purchase.request`

Tool implementations are injected. The Personal Shopper source code does not select merchant APIs, transports, credentials or hidden tools.

The H2A2H responsibilities declared as required tools are fulfilled by runtime/governance bindings rather than by business tool executors:

- `h2a2h.delegation.validate`
- `h2a2h.audit.append`
- `h2a2h.pohr.issue`
- `h2a2h.human.escalate`

## Runtime flow

```text
Human request
  -> A2A/H2A2H identity loading
  -> Intent resolution
  -> OpenDelegation validation
  -> participant/responsibility resolution
  -> OpenEntityChannels/OpenIntent channel resolution
  -> declared tool allowlist validation
  -> Human approval gate when required
  -> tool execution
  -> audit/provenance
  -> Human return
  -> Proof-of-Human-Return
```

No role code may bypass these steps.

## Human approval

The contract requires Human approval for:

- purchase commitment;
- substitution outside delegated preference;
- spend above delegated threshold;
- sharing personal preference data.

An operation declares the applicable `risk_triggers`. If the operation has a side effect and one of those triggers matches the contract, execution fails closed unless `human_approval.granted` is true.

Approval evidence should identify the approving Human and include an evidence reference. The Agent cannot approve itself and cannot extend its own delegation.

## Request shape

The runtime receives the H2A2H Intent separately from the Employee Agent input. The Employee Agent input contains:

```json
{
  "delegation_ref": "delegation:123",
  "request_payload": {
    "goal": "buy the selected headphones"
  },
  "human_approval": {
    "granted": true,
    "approved_by": "human:123",
    "evidence_ref": "approval:456"
  },
  "operations": [
    {
      "tool": "commerce.purchase.request",
      "input": {
        "sku": "sku-1",
        "amount": 499
      },
      "risk_triggers": ["purchase commitment"]
    }
  ]
}
```

The normative machine-readable request/output definitions are in `schemas/employee-agent-runtime.schema.json`.

## Implementation entry point

The TypeScript reference implementation exposes:

- `loadEmployeeAgent()` — loads and validates Agent Card + employee contract.
- `EmployeeAgentRuntime` — generic contract-driven runtime shared by every Employee Agent.
- `createPersonalShopperAgent()` — specialization that only fixes the expected canonical identity and source directory.

This is intentional: the role is data/configuration; the runtime is generic.

## Required invariants

1. Agent Card identity does not grant authority.
2. Delegation is required before work is executed.
3. Undeclared Intents are rejected.
4. Undeclared tools are rejected.
5. Every declared business tool must be bound before the Agent starts.
6. Side effects with configured risk triggers require accountable Human approval.
7. Channel selection comes from H2A2H channel resolution, not role code.
8. Provenance contains both the Employee Agent canonical label and the executed Intent.
9. Results cross the Human boundary through H2A2H Human Return / PoHR.
10. The same generic runtime must be reusable for the remaining Employee Agent archetypes.
