---
name: typescript-coding-standards
description: TypeScript standards for domain-heavy code — branded types, discriminated unions, errors as data, pure core with adapters. Use when writing or reviewing TypeScript that models a domain or parses input.
metadata:
  version: 1.0.0
  tags:
  - typescript
  - code-quality
  - architecture
  - testing
  dependencies: []
---

# TypeScript Coding Standards

> Migration: this skill now owns the former `ts-package-authoring` workflow.
> Read `references/package-authoring.md` for package layout, exports,
> workspaces, peer dependencies, and publish checks. See
> `../superpi/MIGRATIONS.md`.

## Iron Laws

<EXTREMELY-IMPORTANT>
- **No `any`.** Branded primitives, schema boundaries, `unknown` + narrow.
- **Errors as data.** `Result<T, E>` or `Effect<T, E>`. Never `throw new Error(...)` for domain.
- **Pure core, effects at edges.** Business logic takes inputs, returns values.
- **Types describe the domain.** `UserId` not `string`.
- **Test seams over mocking.** Inject dependencies as values.
</EXTREMELY-IMPORTANT>

## Domain Modeling

```ts
// Branded primitives (no runtime cost)
type UserId = string & { readonly __brand: "UserId" }
const UserId = (s: string): UserId => s as UserId

// Discriminated unions
type RequestState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: T }
  | { kind: "error"; error: AppError }
```

Use `kind` for discriminants (not `type` — collides with TS).

## Schema Boundaries

Validate untrusted input at the edge. Inside, trust the types.

```ts
const input = Schema.decodeUnknownSync(UserSchema)(req.body)
// Now `input` is `User`, not `unknown`
```

Never let `req.body`, `JSON.parse`, `process.env`, or query strings reach the core. Decode at the boundary.

## Error Modeling

```ts
class UserNotFound extends Error {
  readonly _tag = "UserNotFound" as const
  constructor(readonly userId: UserId) { super(`User ${userId} not found`) }
}

type GetUser = (id: UserId) => Effect.Effect<User, UserNotFound | DbError>
```

The return type is the contract. Handlers switch on `_tag`.

## Pure Functions

```ts
// Pure: input → output, no I/O
const calculateTotal = (items: Item[]): number =>
  items.reduce((sum, i) => sum + i.price * i.qty, 0)

// Impure: I/O, time, randomness
const fetchUser = (id: UserId): Effect.Effect<User, DbError> =>
  Effect.tryPromise(() => db.query(...))
```

Pure = testable without setup. Impure = testable with `TestLayer` or mock implementation.

## Adapters

External systems get an adapter. Adapter implements a domain interface, hides the external API.

```ts
interface UserRepo {
  findById: (id: UserId) => Effect.Effect<User, UserNotFound | DbError>
}

class PostgresUserRepo implements UserRepo {
  findById = (id) => Effect.tryPromise({
    try: () => pg.query("SELECT * FROM users WHERE id = $1", [id]),
    catch: (e) => toDbError(e)
  })
}
```

Business code depends on `UserRepo`, not `pg`. Tests use in-memory `UserRepo`.

## Module Boundaries

- One concern per module. Name after the concept, not the file type.
- Public API: explicit exports. Internal: not exported or in `internal/`.
- No circular deps. If A imports B, B does not import A.
- Index files are minimal — only the public surface.

## Red Flags

`any` in production ("any to unblock"); `throw` for domain errors; untyped `JSON.parse` or `req.body` reaching the core; `Date.now()` / `console.log` inside business logic; `as` casts to silence the checker; "just a string" where a branded type belongs; types that mirror the DB schema instead of the domain; stringly-typed enums; global state; circular imports; grab-bag `utils.ts`; tests that mock the thing they claim to test.
