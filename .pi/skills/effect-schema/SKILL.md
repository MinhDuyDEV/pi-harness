---
name: effect-schema
description: >-
  Effect Schema patterns for domain types — Schema.Struct vs Schema.Class, branded primitives,
  Schema.TaggedError domain errors, boundary decoding with decodeUnknown, filters,
  transformations, and JSON Schema generation. Use when defining validation schemas, typed
  errors, or branded IDs in an Effect codebase, or when replacing Zod.
metadata:
  version: 1.0.0
disable-model-invocation: true
---

# Effect Schema

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Schema = single source of truth.** Generated types, validators, and JSON Schema all derive from one definition.
- **`Schema.TaggedError` for domain errors.** Not `class X extends Error`. The tag enables exhaustive `match` switching.
- **`decodeUnknown` at the boundary.** Untrusted input → typed value. Never trust the type of `JSON.parse`.
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
  Schema.decodeUnknown(RequestBody)(body).pipe(
    Effect.mapError((e) => new ValidationError({ cause: e }))
  )
```

`decodeUnknown` returns an `Effect` (so it composes). `decodeUnknownSync` throws (use only at startup).

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

## Red Flags

`as` casts or `any` near a `decode` call (the schema is incomplete — fix the schema, don't cast); `decodeUnknownSync` or `try/catch` decoding inside a request handler (throws, blocks — use `decodeUnknown`); generic `Error` thrown from a service (use `Schema.TaggedError`; missing `_tag` kills exhaustive match); plain `string` where a branded ID belongs; `Schema.Class` for plain DTOs (use `Struct`); the same shape defined in schema + interface + Zod (one system, one definition); Zod alongside Effect Schema; hand-written JSON Schema or OpenAPI (generate from the schema); schemas that don't match the wire or database format; schemas for hot internal structs (validation has cost); `Schema.Unknown` in a service return; "trust the input" at an API boundary; schemas never round-tripped through `decode` in tests.
