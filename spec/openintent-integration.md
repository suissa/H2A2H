# OpenIntent Protocol Integration

Status: Normative draft for H2A2H v1.0.

H2A2H uses OpenIntent Protocol as the semantic declaration of the outcome to be achieved. H2A2H does not require domain Agents to decide communication protocols. Communication requirements belong to the Intent declaration and/or the participating Entity channel declarations.

## Required Intent identity

Every H2A2H-resolvable Intent MUST declare:

- `canonical_label`: stable semantic identity;
- `version`: explicit Intent contract version;
- `input`: input schema reference or inline schema identifier;
- `output`: output schema reference or inline schema identifier;
- `participants`: semantic roles required by the Intent;
- `channels`: required or acceptable communication profiles;
- `authority`: required delegated scopes/capabilities;
- `preconditions`: conditions that MUST hold before execution;
- `postconditions`: conditions that MUST hold before successful completion.

## canonical_label

`canonical_label` MUST encode semantic meaning, not an implementation path, class name, framework name, host, transport, or process identity.

Examples:

- `Commerce.PurchaseProducts`
- `Financial.RegisterPayment`
- `Human.ApproveDelegation`

A change of implementation without a change of semantic meaning SHOULD NOT require changing `canonical_label`.

## Participant roles

Participants are declared by semantic role rather than process topology. A role MAY constrain an Entity kind, capability, policy, or responsibility relation.

Example roles:

- `requesting_human`
- `purchasing_agent`
- `supplier_organization`
- `receiving_human`

Runtime resolution maps these roles to concrete Entity references.

## Communication declaration

An Intent MAY declare one or more required/acceptable channel profiles. An Entity MAY separately declare the concrete channels it exposes.

The runtime resolves the intersection:

`Intent communication requirements ∩ sender channels ∩ receiver channels ∩ runtime policy`

The Agent MUST NOT implement logic equivalent to “if remote use gRPC, otherwise use NATS”. That decision belongs to protocol declarations and runtime binding.

## Transport independence

OpenIntent fields describe semantic requirements. A transport profile MAY add transport-specific binding metadata, but transport metadata MUST NOT change the semantic meaning of the Intent.

## Correlation and idempotency

An Intent declaration MAY specify idempotency semantics such as:

- `required`: caller MUST provide an idempotency key;
- `derived`: runtime derives one from declared fields;
- `none`: operation is explicitly non-idempotent and runtime MUST expose that fact.

Concrete H2A2H messages always carry interaction correlation independently from Intent identity.

## Authority declaration

An Intent SHOULD declare the minimum authority necessary for its effects. Runtime validation MUST verify the effective delegation before effects occur.

Intent authority is a requirement; OpenDelegation is the evidence that a concrete participant currently holds that authority.

## Preconditions and postconditions

Preconditions and postconditions MUST be machine-evaluable or reference a machine-evaluable rule where conformance depends on them.

A failed precondition MUST NOT be represented as successful Intent execution. It MAY enter healing/escalation according to lifecycle policy.

## Example artifact

```yaml
protocol: openintent
version: 1.0.0
intent:
  canonical_label: Commerce.PurchaseProducts
  version: 1.0.0
  input:
    schema: schema://commerce/purchase-products/input/1
  output:
    schema: schema://commerce/purchase-products/output/1
  participants:
    - role: requesting_human
      entity_kinds: [Human]
    - role: commerce_executor
      entity_kinds: [Agent, Service]
    - role: supplier
      entity_kinds: [Organization, Business]
    - role: receiving_human
      entity_kinds: [Human]
  authority:
    required_scopes:
      - commerce.purchase.create
  channels:
    mode: request_reply
    acceptable:
      - h2a2h.channel.in-memory.v1
      - h2a2h.channel.nats.v1
      - h2a2h.channel.grpc.v1
    fallback: allowed
  idempotency:
    mode: required
  preconditions:
    - rule: delegation.active
    - rule: supplier.resolved
  postconditions:
    - rule: purchase.recorded
    - rule: human_return.proven
```

## Runtime resolution algorithm

1. Resolve the Intent by `canonical_label` and compatible version.
2. Validate the input against the referenced input semantics.
3. Resolve required participant roles.
4. Validate effective delegated authority.
5. Resolve compatible channels from declarations.
6. Bind transport adapters without changing domain Agent code.
7. Execute the lifecycle and collect proofs/audit data.
8. Validate postconditions before reporting successful completion.

## Invariants

1. Agents MUST NOT need prior transport-specific programming for each Intent.
2. Transport selection MUST be derived from declarations and policy.
3. Intent identity MUST remain stable across transport changes.
4. Runtime MUST reject execution when required authority cannot be proven.
5. Runtime MUST preserve the exact Intent version used in audit/provenance.
6. Channel fallback MUST NOT weaken security or authority requirements.
