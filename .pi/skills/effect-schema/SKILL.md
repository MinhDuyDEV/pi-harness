---
name: effect-schema
version: 1.0.0
description: "Use when defining data validation schemas, domain types, branded primitives, or typed errors with Effect Schema in a TypeScript project. Covers Schema.Struct vs Schema.Class, Schema.TaggedErrorClass for domain errors, branded types for type-safe primitives, decodeUnknownEffect pipeline, filters, transformations, JSON Schema/OpenAPI generation, and Zod replacement patterns. MUST load before writing any Schema definitions in an Effect-based codebase."
---

# Effect Schema

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Schema = single source of truth.** Generated types, validators, and JSON Schema all derive from one definition.
- **`Schema.TaggedErrorClass` for domain errors.** Not `class X extends Error`. The tag enables exhaustive `match` switching.
- **`decodeUnknownEffect` at the boundary.** Untrusted input → typed value. Never trust the type of `JSON.parse`.
- **Branded primitives for IDs and units.** `UserId`, `Email`, `Meters` — prevent mixing at the type level.
- **No `as` casts.** If you need a cast, the schema is incomplete. Fix the schema.
</EXTREMELY-IMPORTANT>

## Basic Struct

```ts
import { Schema } from "effect"

const User = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  age: Schema.Number
})

// Derive the type
type User = Schema.Schema.Type<typeof User>
```

## Class (for entities with methods)

```ts
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  email: Schema.String,
  createdAt: Schema.Date
}) {
  isAdmin = () => this.email.endsWith("@admin.com")
}
```

Use `Schema.Class` when the type needs methods or identity. Use `Schema.Struct` for plain DTOs.

## Branded Primitives

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = Schema.Schema.Type<typeof UserId>

// Construct
const id = UserId.make("user_123") // returns UserId
const bad = UserId.make("") // throws ParseError
```

Refines: `.pipe(Schema.pattern(/^user_/))`, `.pipe(Schema.minLength(1))`, etc.

## Tagged Errors

```ts
class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  { id: UserId }
) {}

const getUser = (id: UserId): Effect.Effect<User, UserNotFound | DbError> =>
  Effect.gen(function* () {
    const row = yield* db.find(id)
    if (!row) return yield* Effect.fail(new UserNotFound({ id }))
    return row
  })
```

The `_tag` field is added automatically. Handlers can `match` exhaustively.

## Decode at the Boundary

```ts
const parseRequest = (body: unknown) =>
  Schema.decodeUnknownEffect(RequestBody)(body).pipe(
    Effect.mapError((e) => new ValidationError({ cause: e }))
  )
```

`decodeUnknownEffect` returns an `Effect` (so it composes). `decodeUnknownSync` throws (use only at startup).

## Filters & Transformations

```ts
const Email = Schema.String.pipe(
  Schema.pattern(/^[^@]+@[^@]+$/),
  Schema.brand("Email")
)

const Trimmed = Schema.transform(Schema.String, Schema.String, {
  decode: (s) => s.trim(),
  encode: (s) => s
})
```

## JSON Schema / OpenAPI

```ts
import { JSONSchema } from "effect"
const jsonSchema = JSONSchema.make(User)
```

## Common Mistakes

Using `Schema.Class` for DTOs (use `Struct`); `decodeUnknownSync` in request handlers (blocks, throws); `as User` casts (defeats the purpose); unbranded IDs (`string` everywhere); generic `Error` thrown (loses tag); schema for an internal struct (validation has cost); "trust the input" at API boundaries; duplicated types (schema + interface + zod); missing `_tag` on errors; schemas that don't match the wire format.

## Red Flags

`any` or `as` near a `decode` call; `try/catch` around `decodeUnknownSync`; `Error` thrown from a service; `string` for what should be a branded ID; JSON Schema manually written; same shape defined in 3 places (schema, type, zod); `Schema.Unknown` in a service return; `decodeUnknown` (sync, throws) in a request handler; circular schema references; schemas that don't match the database.

## Anti-Patterns

**Zod alongside Effect Schema** (two systems); **`as` cast to "fix" parse error** (schema is the source of truth); **generic `Error` in a service** (use TaggedError); **`string` IDs** (brand them); **manual OpenAPI** (generate from schema); **schema without `decode` in tests** (round-trip every schema).
