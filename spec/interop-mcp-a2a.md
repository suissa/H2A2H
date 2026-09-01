# MCP and A2A Interoperability

Status: Normative bridge profile for H2A2H v1.0.

H2A2H MAY use MCP or A2A-compatible messages/transports as interoperability mechanisms. Bridging MUST NOT silently discard or widen H2A2H responsibility, delegation, correlation, or proof semantics.

## Principle

MCP describes tool/resource interaction and A2A describes agent task/message interaction. H2A2H adds a Human-to-Human responsibility lifecycle around such interactions. Therefore a bridge can map compatible operations, but absence of a native field in the target protocol does not mean the H2A2H semantic requirement disappears.

## H2A2H bridge metadata

Bridges MUST carry a namespaced metadata block containing, when applicable:

- H2A2H protocol/version;
- interaction/correlation/causation IDs;
- Intent canonical label/version;
- sender/receiver Entity references;
- delegation ID/chain digest;
- responsibility-chain reference;
- proof references;
- idempotency key.

## MCP mapping

An H2A2H request MAY map to an MCP tool call when the H2A2H Intent resolves to a concrete MCP tool capability.

Mapping:

- Intent/capability -> MCP tool name selected by configuration/registry, not inferred by transport;
- H2A2H payload -> tool arguments;
- H2A2H metadata -> namespaced `_meta.h2a2h` bridge metadata where supported by the bridge/runtime;
- MCP result -> H2A2H response payload;
- MCP errors -> correlated H2A2H failure/escalation semantics.

An MCP tool's availability MUST NOT be interpreted as delegated Human authority to invoke it.

## A2A mapping

An H2A2H request MAY map to an A2A task/message. The bridge SHOULD preserve:

- interaction/correlation identity in task/message metadata;
- Intent identity as task semantic metadata;
- sender/receiver Entity mapping;
- delegation/responsibility metadata;
- idempotency where supported;
- proof/result references.

A2A task completion does not by itself satisfy Proof-of-Human-Return. The H2A2H lifecycle continues until the selected Human-return condition is proven.

## Round-trip rules

A bridge round trip is conforming only if required H2A2H semantics can be reconstructed. If mandatory delegation/responsibility/proof metadata cannot be preserved, the bridge MUST mark the operation as lossy/unsupported rather than silently claiming native H2A2H equivalence.

## Authority rules

1. Bridge translation MUST NOT add scopes, Intents, actions, resources, duration, or delegation depth.
2. Target-protocol authentication MUST NOT replace H2A2H delegation.
3. Target capability discovery MUST NOT imply permission to use the capability.
4. Returning from a bridge MUST revalidate authority at required effect boundaries.

## Unsupported cases

A bridge MUST reject or explicitly escalate when:

- target protocol cannot carry/associate required H2A2H metadata;
- identity mapping is ambiguous;
- delegated authority would be widened;
- a mandatory proof cannot survive translation;
- target completion semantics would incorrectly imply Human return.

## Invariants

MCP/A2A interoperability is an adapter projection of H2A2H semantics. It is never permission to weaken the normative H2A2H lifecycle.
