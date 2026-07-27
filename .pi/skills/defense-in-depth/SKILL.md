---
name: defense-in-depth
description: Layered validation making invalid data structurally impossible at every trust boundary. Use when invalid data fails deep in the stack, or when deciding which layers must validate.
metadata:
  version: 1.0.0
  tags:
  - code-quality
  - debugging
  dependencies: []
---

# Defense in Depth

## When to Use

Invalid data causes failures deep in the stack; type system alone isn't enough; trust boundary crossing is unclear; "valid here, invalid there" recurs.

## When NOT to Use

Single boundary (one validation point is enough); internal data flow; perf-critical and re-validation cost is real (rare).

## Core Principle

**Validate at every layer data passes through.** Each layer is a trust boundary. Boundaries exist at: network, persistence, third-party, internal module, type-changing transformation. Each boundary gets a schema.

Don't trust upstream to validate. Don't trust downstream to be robust. Validate at the boundary you're crossing.

## Layer Map

```
[Network]  ←  schema validation
   ↓
[Controller]  ←  decode + parse path/query/body
   ↓
[Service]  ←  validate pre-conditions + domain rules
   ↓
[Repository]  ←  validate shape, sanitize for SQL
   ↓
[Database]  ←  constraints, types, CHECK
```

Each arrow is a boundary. Each boundary validates.

## When to Validate

| Boundary | Validate? | Why |
|---|---|---|
| HTTP request | YES | Untrusted input from anywhere |
| Job queue input | YES | Queued by another service / version |
| Internal function call | NO | Types should be enough |
| DB read into domain type | YES | DB schema ≠ domain schema |
| Config / env var | YES | Operator can set anything |
| User-provided file | YES | Untrusted bytes |

Anything from outside the type system (network, queue, file, env, DB) gets validated. Within (function calls), trust the type.

## Defense Patterns

1. **Schema at the boundary.** Decode unknown → typed value.
2. **Domain validation.** "User with this email exists" — service layer.
3. **DB constraints.** Belt and suspenders: even if app validation fails, the DB refuses.
4. **Type narrowing.** `unknown` → narrow → use. Never use `any` to skip.
5. **Errors as data.** Failed validation is a typed error, not an exception.

## Why Multiple Validations

- **App validation** catches the most common cases (UX matters)
- **DB constraints** catch the rest (safety net, race conditions)
- **Multiple checks** mean a bug in one layer doesn't propagate

The cost of re-validating is real but small compared to the cost of corrupt data.

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "I validated at the entry point, that's enough" | One-layer validation moves the bug; the layer that uses the data must re-validate. |
| "The caller already checks it" | Callers change; your layer's contract is its own validation, not the caller's memory. |
| "Validating twice is redundant" | Redundancy is the point — each layer makes the next bug structurally impossible. |

## Red Flags

`as any` near a boundary; validation only at network (deep code trusts the type, gets garbage); validation only at DB (bad UX); "we trust this source" (sources change); no validation for env vars or queue messages; validation scattered or buried mid-function instead of at the boundary; try/catch for validation (errors are data); no DB constraints; "the type system catches it" (it catches what you typed, not what the user sent).
