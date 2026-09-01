# Enterprise Employee Agents

This directory is a reference catalog of H2A2H employee-agent archetypes for a large enterprise, plus a `Personal Shopper` role.

## Identity model

Each employee folder contains:

- `agent-card.json` — the **A2A v1.0 Agent Card** used as the initial discovery identity of the Agent.
- `h2a2h.employee.yml` — the H2A2H employment/authority contract: semantic identity, accountable Human, delegation boundaries, Intents, tool allowlist, systems of record, approvals, channels, PoHR, memory, security, observability, and acceptance tests.

The A2A Agent Card is intentionally **not** treated as the complete identity. It answers _who is this agent, what skills does it advertise, and how can another A2A client reach it?_. H2A2H adds the parts required to place the Agent inside a Human responsibility chain: `canonical_label`, delegated authority, accountable Human, policy, audit/provenance and Proof-of-Human-Return.

## A2A baseline

The cards follow the A2A v1.0 discovery model:

- `supportedInterfaces[]` is ordered by preference;
- each interface declares `url`, `protocolBinding`, and `protocolVersion`;
- capabilities and skills are advertised in the card;
- production deployments SHOULD publish the public card at `/.well-known/agent-card.json`;
- production cards MAY be signed; credentials and secrets MUST NOT be embedded in the card.

The URLs in this repository are placeholders and MUST be replaced by deployment-specific values.

## H2A2H implementation rule

An employee Agent MUST NOT encode hidden authority, transport selection, or organization policy in role code.

1. Discovery identity comes from the Agent Card.
2. Semantic identity comes from `canonical_label`.
3. Authority comes from OpenDelegation.
4. Communication comes from OpenEntityChannels/OpenIntent.
5. Tool use is allowlisted in the employee contract.
6. Side effects require a valid delegation and are audited.
7. Material or uncertain actions escalate to the accountable Human.
8. Results crossing the Human boundary produce Proof-of-Human-Return.

## Directory taxonomy

The catalog intentionally models **employee archetypes**, not vendor-specific job-title spelling. A company can specialize an archetype without changing the protocol, for example `Backend Engineer` into `Payments Backend Engineer`.

See [`catalog.json`](./catalog.json) for the machine-readable index.
