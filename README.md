# mesh-integration-tests

Cross-package integration tests for the BrowserMesh ecosystem. Verifies that all published packages work together correctly when imported as external dependencies.

## Packages Under Test

| Package | Description |
|---------|-------------|
| `browsermesh-primitives` | Wire format, identity (Ed25519), CRDTs, capabilities, trust, ACL |
| `browsermesh-netway` | Virtual networking — TCP-like streams, UDP datagrams, policy engine |
| `browsermesh-pod` | Pod base class with identity, discovery, and peer messaging |
| `wsh-upon-star` | Web Shell — CBOR protocol, Ed25519 auth, transports, sessions |
| `andbox` | Sandboxed JavaScript runtime with Worker isolation and RPC |
| `ai-matey-middleware-andbox` | ai.matey middleware for code-based tool execution via andbox |

## Test Coverage

- **primitives-wire-roundtrip** — Wire format encode/decode, identity generation, CRDT merge operations, capability matching, base64url encoding
- **pod-with-primitives** — Pod instantiation with PodIdentity, message factories, wire format interop, pod kind detection
- **andbox-middleware** — Sandbox code execution, code block extraction, Python-to-JS adaptation, tool injection, result formatting, end-to-end pipeline
- **wsh-protocol** — CBOR codec, frame encoding/decoding, message factories, Ed25519 key operations, protocol constants
- **cross-package-versions** — Smoke test that all packages load and export expected symbols, type compatibility checks, version consistency

## Running Tests

```bash
npm install
npm test
```

Requires Node.js 22+ (for `node:test` runner and Ed25519 support in Web Crypto).

## Development

Dependencies currently use `file:` references to local sibling directories. These will switch to npm versions once the packages are published.

To add a new integration test:

1. Create `test/<name>.test.mjs`
2. Import from the relevant packages
3. Run `npm test` to verify
