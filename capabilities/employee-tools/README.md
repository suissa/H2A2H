# Employee Tool Capabilities

This directory defines the reusable semantic capability layer used by H2A2H Employee Agents.

An Employee Agent does not own hidden tool implementations. Its `h2a2h.employee.yml` only declares which capability identities it may use. `EmployeeToolRegistry` resolves those identities to capability contracts and then to provider bindings.

## Effective capability contract

Every catalogued tool resolves to an effective contract containing:

- `canonical_label`: stable capability identity, equal to the tool name already referenced by Employee contracts;
- `domain`: first semantic segment of the canonical label;
- `operation`: final semantic segment;
- `effect`: `read-only`, `side-effect`, or `protocol-control`;
- `side_effect`: whether invocation can mutate or externally commit state;
- `delegation_required`: whether H2A2H delegated authority is required;
- `human_approval`: `none`, `employee-policy`, or `protocol-defined`;
- `input_schema` and `output_schema`: stable schema identifiers;
- `provider_required`: whether an external/injected provider must be bound before the Employee Agent can start;
- `provider_bindings`: allowed provider kinds;
- `events`: only `Ok` or `Error` for the tool execution boundary.

The root catalog stores shared defaults once and lists the department-specific tools and side-effect set explicitly. The runtime expands those inherited defaults into complete contracts.

## Provider model

Business capabilities can be bound through:

- `in-memory`: deterministic reference/testing handlers;
- `http-json`: POST-based external service adapters;
- `mcp`: an injected MCP-compatible `callTool` driver;
- `injected`: arbitrary host-language implementations that satisfy the provider contract.

The four H2A2H protocol tools are catalogued as internal protocol capabilities and are fulfilled by the H2A2H runtime/SDK rather than normal Employee business-tool providers.

## Invariants

1. Employee role code MUST NOT choose providers or transports ad hoc.
2. Every tool referenced by every Employee Agent MUST exist in this catalog.
3. The Employee contract and capability contract MUST agree on `side_effect`.
4. Every business capability MUST have a bound provider before an Employee Agent is instantiated.
5. Provider binding never grants authority. OpenDelegation and Employee policy are evaluated independently.
6. Human approval is evaluated before side-effect invocation whenever the Employee contract declares the triggering risk.
7. Provider results remain inside the H2A2H correlation, provenance, audit and Proof-of-Human-Return chain.
