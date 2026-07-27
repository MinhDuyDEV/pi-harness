# Defense in depth

Every trust boundary gets its own validation. Boundaries include network and
queue messages, files and environment variables, database reads, third-party
responses, and type-changing transformations. Internal calls already protected
by trusted TypeScript types do not need repetitive runtime decoding.

```text
network -> controller decode -> service/domain rules -> repository mapping -> database constraints
```

## Boundary matrix

| Boundary | Validate | Typical control |
|---|---:|---|
| HTTP/RPC body, path, query | yes | schema decode, length/format limits |
| Job/queue payload | yes | versioned schema and replay/idempotency key |
| Environment/config | yes | explicit parser and safe defaults |
| User file or upload | yes | path containment, size/type checks |
| Database/third-party read | yes | map external shape into a domain type |
| Internal typed function call | normally no | compile-time contract and focused tests |

## Five defenses

1. Decode `unknown` at the edge; never pass raw `JSON.parse`, request bodies, or
   `process.env` into core logic.
2. Apply domain invariants after shape validation (ownership, existence,
   authorization, state transitions).
3. Keep database constraints as a race-safe final backstop.
4. Narrow unknowns without `any`; reject malformed or out-of-bounds values.
5. Represent validation failures as typed/domain errors at the boundary.

Red-team the negative path: malformed input, cross-tenant access, replay,
oversized values, stale versions, and a database race must all fail closed.

