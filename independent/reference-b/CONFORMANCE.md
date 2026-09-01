# Independent interoperability evidence

Reference B is intentionally implemented without importing any module from the primary TypeScript runtime under `src/`.

The executable interoperability suite proves:

- Reference A artifacts can be consumed by Reference B.
- Reference B artifacts validate against the normative H2A2H v1 schemas.
- Reference B can send an H2A2H request to a Reference A endpoint.
- Reference A can send an H2A2H request to Reference B.
- Direct serialized JSON and HTTP request/reply are both exercised.
- `correlation_id`, `causation_id`, delegation identity and receiving Entity identity survive the bridge.
- Reference B generates a Proof-of-Human-Return independently.
- Responsibility-chain extension is performed without using Reference A runtime code.

The acceptance command is:

```sh
npm run conformance
```

A successful v1.0 release requires this suite to be green in CI.
