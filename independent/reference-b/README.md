# H2A2H Reference Implementation B

This directory contains a deliberately independent implementation of the normative H2A2H v1 artifacts and interoperability behavior.

It does **not** import the TypeScript reference runtime under `src/`. It independently implements:

- H2A2H envelope validation and creation;
- OpenDelegation validation;
- delegation monotonicity checks;
- responsibility-chain extension;
- Proof-of-Human-Return generation;
- HTTP request/reply transport;
- a minimal independent processing runtime.

`interop.test.mjs` verifies interoperability with the primary reference implementation in both directions over two profiles:

1. direct serialized H2A2H JSON;
2. HTTP request/reply.

Both implementations consume the same normative schema bundle under `schemas/`, but share no runtime implementation code.

Run the full interoperability gate with:

```sh
npm run build
npm run test:interop
```

The v1.0 release gate requires this independent implementation and the primary implementation to complete bidirectional interactions while preserving correlation, delegation metadata, responsibility references, and Proof-of-Human-Return semantics.
