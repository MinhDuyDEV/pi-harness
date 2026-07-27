# Contract-first API and interface design

Treat the public schema as the API. Write it before implementation, generate or
derive types from it, decode unknown input at the boundary, and implement only
against the validated type.

## Versioning

| Strategy | Use |
|---|---|
| URL `/v1/` | public API with multiple live versions |
| `Accept`/header version | internal API needing flexible negotiation |
| no version | private single-consumer contract where a break is coordinated |

Prefer additive changes. A breaking change needs a new version, deprecation
window, migration guide, and codemod where practical. Never silently repurpose
an existing field.

## Error contract

Every error has a stable machine code, human message, structured details, and a
correlation/trace ID. Do not leak stack traces, secrets, or internal paths.

Design retries explicitly: idempotent `PUT`/`DELETE`, idempotency keys for
creation `POST`, bounded/cursor pagination, and visible rate-limit plus
`Retry-After` metadata. Keep schemas, generated types, implementation, and
documentation in one reviewable change.

