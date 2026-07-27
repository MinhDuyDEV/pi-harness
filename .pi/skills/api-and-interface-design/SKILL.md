---
name: api-and-interface-design
description: >-
  Applies contract-first design to REST/GraphQL APIs, SDKs, and public module boundaries — schema-first
  workflow, explicit versioning, error shapes, backward compatibility. User-invoked: load via
  /skill:api-and-interface-design when designing or reviewing a public API surface or planning a
  breaking change.
metadata:
  version: 1.0.0
  tags:
  - architecture
  - code-quality
  dependencies: []
disable-model-invocation: true
---

# API & Interface Design

## Iron Laws

- **Contract first, implementation second.** Internal code can change freely; the contract cannot.
- **Version explicitly.** Implied versions break unexpectedly.
- **Errors are part of the contract.** Shape them as deliberately as the success response.
- **Backward compatibility is a feature.** Every break must justify its user cost.
- **Document what you ship.** Generate docs from the schema, not by hand.

## Contract-First Workflow

1. **Write the schema** (OpenAPI, GraphQL SDL, Protobuf, JSON Schema).
2. **Generate types** from the schema (client + server).
3. **Validate at the boundary** — decode unknown input into a typed value.
4. **Implement against the types**, never against raw `any`/`unknown` input.

## Versioning Decision Table

| Strategy | When |
|---|---|
| URL path (`/v1/`) | Public API, multiple versions live simultaneously |
| Header (`Accept: ...;v=2`) | Internal API, more flexible |
| None (breaking is breaking) | Internal-only, single consumer |

Public APIs: prefer URL path — visible, cacheable, easy to reason about.

## Error Contract

Every error carries: a stable machine-readable `code` (never localized), a human `message`, structured
`details`, and a `traceId` for correlation. Never leak stack traces, internal paths, or secrets.

## Compatibility Rules

**Add only.** Don't change existing field meanings, tighten validation, remove, or rename fields.
If you must break: new version + deprecation period + migration guide (+ codemod if possible).

Retries must be safe: `PUT` and `DELETE` idempotent by design; `POST` creation idempotent via an
`Idempotency-Key` header. Large lists: cursor-based pagination (`nextCursor` + `hasMore`), never
unbounded responses. Rate limits: visible via `X-RateLimit-*` headers and `Retry-After` on 429.

## Red Flags

`/api/` with no version; error as a bare string; schema written after the implementation; request
body reaching the implementation undecoded; breaking change in a minor release; field reused for a
new purpose; unbounded list endpoint; retry-unsafe `POST` with no idempotency key; no `traceId`;
hand-written docs drifting from the shipped schema; "the schema is in the code".
