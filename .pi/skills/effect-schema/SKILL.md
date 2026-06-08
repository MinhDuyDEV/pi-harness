---
name: effect-schema
version: 1.0.0
description: "Use when defining data validation schemas, domain types, branded primitives, or typed errors with Effect Schema in a TypeScript project. Covers Schema.Struct vs Schema.Class, Schema.TaggedErrorClass for domain errors, branded types for type-safe primitives, decodeUnknownEffect pipeline, filters, transformations, JSON Schema/OpenAPI generation, and Zod replacement patterns. MUST load before writing any Schema definitions in an Effect-based codebase."
---

# Effect Schema Best Practices

## Overview

Effect Schema is the validation and type-definition layer of the Effect ecosystem. It replaces Zod, class-validator, io-ts, and manual type guards with a single source of truth that produces TypeScript types, runtime validators, JSON Schema, OpenAPI specs, and fast-check arbitraries from one definition.

This skill covers the **real-world patterns** that Effect's own documentation doesn't teach: how to organize schemas in a service-oriented codebase, the `Schema.TaggedErrorClass` pattern for domain errors, branded types for domain primitives, the validation pipeline with `decodeUnknownEffect`, and JSON Schema generation for OpenAPI.

## When to Use

- Defining request/response shapes for HTTP APIs
- Creating domain types that need runtime validation
- Defining typed domain errors with `Schema.TaggedErrorClass`
- Generating JSON Schema or OpenAPI from TypeScript types
- Replacing Zod in an Effect-based codebase

## When NOT to Use

- Simple scripts where `JSON.parse` + manual check is sufficient
- Frontend form validation in a non-Effect codebase (use Zod — lighter)
- When the team is not using Effect at all

---

## Part 1: Schema Building Blocks

### Primitive Schemas

Effect Schema provides built-in schemas for every TypeScript type:

```typescript
import { Schema } from "effect"

Schema.String        // string
Schema.Number        // number
Schema.Boolean       // boolean
Schema.Int           // integer (refined number)
Schema.NonEmptyString  // string with minLength >= 1
Schema.Trim          // string with whitespace removed
Schema.UUID          // string matching UUID format
Schema.ULID          // string matching ULID format
Schema.Date          // Date from string or number
Schema.BigIntFromSelf   // BigInt
Schema.JsonObject    // Record<string, unknown>
Schema.Unknown       // unknown
Schema.Void          // void
Schema.Never         // never (unreachable)
```

### Struct (Object Shapes)

Use `Schema.Struct` for defining object shapes. This is the most common pattern:

```typescript
const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.NonEmptyString,
  email: Schema.String,
  age: Schema.optional(Schema.Int),
  role: Schema.optionalWith(Schema.String, { exact: true, default: () => "user" }),
})
```

| Variant | When to Use |
|---|---|
| `Schema.optional(field)` | Optional property, type is `string \| undefined` |
| `Schema.optionalWith(field, { exact: true })` | Omitted when undefined, type is `string` (requires `exactOptionalPropertyTypes`) |
| `Schema.optionalWith(field, { default: () => x })` | Default value when missing |

### Naming Convention

Name schemas with PascalCase — they represent types:

```typescript
const User = Schema.Struct({ ... })     // type User = { ... }
const CreateUserInput = Schema.Struct({ ... })
const ApiResponse = Schema.Struct({ ... })
```

### Union and Intersection

```typescript
const Status = Schema.Union(
  Schema.Literal("active"),
  Schema.Literal("inactive"),
  Schema.Literal("suspended"),
)
// type: "active" | "inactive" | "suspended"
```

### Arrays and Records

```typescript
const UserList = Schema.Array(User)                   // User[]
const Tags = Schema.Array(Schema.String)               // string[]
const Metadata = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const PageParams = Schema.Struct({
  page: Schema.optionalWith(Schema.Int, { default: () => 1 }),
  limit: Schema.optionalWith(Schema.Int, { default: () => 20 }),
})
```

---

## Part 2: Schema.Class vs Schema.Struct

**Use `Schema.Struct`** for input/output shapes (API request bodies, query params, configs). These are plain data — they don't need methods.

**Use `Schema.Class`** when you need:
- Methods on the type
- Custom constructors or factories
- Branded types (see Part 3)

```typescript
// Schema.Struct — for data transfer
const CreateUserRequest = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.String,
})

// Schema.Class — for domain objects with behavior
class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.NonEmptyString,
  email: Schema.String,
}) {
  get displayName() {
    return this.name ?? this.email
  }

  isAdmin() {
    return this.role === "admin"
  }
}

const user = new User({ id: 1, name: "Alice", email: "alice@example.com" })
user.displayName // "Alice"
```

### Class Decoding from Unknown

`Schema.Class` schemas transform plain objects into class instances during decoding:

```typescript
const decoded = Schema.decodeUnknownSync(User)({
  id: 1,
  name: "Alice",
  email: "alice@example.com",
})
// decoded instanceof User === true
// decoded.displayName === "Alice"
```

### When to Pick

| Use Case | Pick |
|---|---|
| API request body | `Schema.Struct` |
| API response shape | `Schema.Struct` |
| Database row type | `Schema.Struct` |
| Configuration object | `Schema.Struct` |
| Domain entity with behavior | `Schema.Class` |
| Value Object (immutable, equality) | `Schema.Class` |
| Form validation (with react-hook-form) | `Schema.Struct` |

---

## Part 3: Branded Types (Domain Primitives)

**What are branded types?** A branded type is a nominal-type wrapper around a primitive. Two strings that are semantically different (a UserId vs an Email) should not be interchangeable at the type level. Branded types prevent passing the wrong primitive to the wrong function.

### Defining Branded Types

```typescript
import { Schema } from "effect"

export const UserId = Schema.Number.pipe(Schema.brand("UserId"))
export type UserId = Schema.Schema.Type<typeof UserId>
// type: number & Brand<"UserId">

export const Email = Schema.String.pipe(Schema.brand("Email"))
export type Email = Schema.Schema.Type<typeof Email>
// type: string & Brand<"Email">
```

### Using Branded Types in Services

```typescript
// src/account/account.ts
import { Schema } from "effect"

export const UserId = Schema.Number.pipe(Schema.brand("UserId"))
export type UserId = Schema.Schema.Type<typeof UserId>

export const Email = Schema.String.pipe(Schema.brand("Email"))
export type Email = Schema.Schema.Type<typeof Email>

class User extends Schema.Class<User>("User")({
  id: UserId,
  email: Email,
  name: Schema.NonEmptyString,
}) {}

// Service with type-safe parameters
export interface Interface {
  readonly get: (id: UserId) => Effect.Effect<User, NotFoundError>
  readonly getByEmail: (email: Email) => Effect.Effect<User, NotFoundError>
}
```

### Using Branded Types in Structs

```typescript
const CreateUserInput = Schema.Struct({
  email: Email,      // branded type
  name: Schema.NonEmptyString,
})

// Decoding automatically validates and brands
const input = Schema.decodeUnknownSync(CreateUserInput)({
  email: "alice@example.com",  // validated + branded at runtime
  name: "Alice",
})
// input.email is Email (branded string)
```

**When to brand:**
- IDs (UserId, AccountId, SessionId)
- Email addresses
- Phone numbers
- Any primitive where the WRONG type compiles but is semantically wrong

**When NOT to brand:**
- One-off use (not worth the ceremony)
- Fields that are never used as function parameters
- Internal-only data that doesn't cross service boundaries

---

## Part 4: Schema.TaggedErrorClass (Domain Errors)

This is the most important Schema pattern for service architecture. OpenCode migrated its ENTIRE error system to this pattern, replacing `throw`, `Error` subclasses, and `NamedError` hacks.

### The Pattern

Every domain error is a `Schema.TaggedErrorClass` with a `_tag` discriminator:

```typescript
import { Schema } from "effect"

export class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()(
  "UserNotFound",                     // _tag value
  {
    userId: Schema.Number,            // error payload fields
    query: Schema.optional(Schema.String),
  }
) {}

export class EmailAlreadyTaken extends Schema.TaggedErrorClass<EmailAlreadyTaken>()(
  "EmailAlreadyTaken",
  {
    email: Schema.String,
  }
) {}

// Export a union type for the service
export type Error = UserNotFound | EmailAlreadyTaken
```

### Why This Pattern

| Feature | Schema.TaggedErrorClass | `class extends Error` | `throw new Error()` |
|---|---|---|---|
| Discriminated union (`_tag`) | Auto-generated | Manual `this.name` | None |
| Schema for serialization | Built-in | Manual | None |
| Type-safe catch | `Effect.catchTag("UserNotFound", ...)` | `instanceof` | `catch (e: unknown)` |
| JSON Schema export | Built-in | None | None |
| OpenAPI error generation | Built-in | None | None |

### Discriminated Union in Effect Catching

```typescript
const result = yield* account.get(userId).pipe(
  Effect.catchTags({
    UserNotFound: (e) => {
      // e.userId is typed as number
      return Effect.succeed(defaultUser)
    },
    EmailAlreadyTaken: () => {
      return Effect.fail(new Error("Email conflict"))
    },
  })
)
```

The `_tag` field makes `catchTags` work: the compiler knows every error tag and checks that all cases are handled.

### The Error Union Convention

Every service module exports an `Error` type that is the union of all domain errors:

```typescript
// src/account/account.ts — always export Error union
export type Error = UserNotFound | EmailAlreadyTaken | AccountBanned | StorageError
```

Consumers see the full error surface at the import level:

```typescript
import { Account } from "@/account/account"

// Effect<Receipt, Account.Error | Stripe.Error, Account.Service | Stripe.Service>
```

**This is the single best practice for error handling in Effect services.** It makes the compiler your error-handling checklist.

### Defects vs Failures

| Category | Schema TaggedErrorClass | `Effect.die()` / `throw` |
|---|---|---|
| Domain errors | YES | NO |
| Invalid user input | YES | NO |
| External service failure | YES (wrap with mapError) | NO |
| Null pointer dereference | NO | YES (defect) |
| Impossible state | NO | YES (defect) |
| Library throws unexpectedly | NO | YES (bridge at boundary) |

Rule: expected failures go in `Schema.TaggedErrorClass`. Bugs and impossible states go in `Effect.die()`. Never blur this line.

---

## Part 5: The Validation Pipeline

The recommended way to validate external input (API requests, file reads, env vars) uses `decodeUnknownEffect` with `Effect.mapError`:

### Decoding from Unknown

```typescript
import { Schema, Effect, ParseResult } from "effect"

const CreateUserRequest = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.String,
})

// The pipeline pattern:
function parseCreateUser(input: unknown) {
  return Schema.decodeUnknownEffect(CreateUserRequest)(input).pipe(
    Effect.mapError(
      (parseError) => new ValidationError({
        message: ParseResult.TreeFormatter.formatErrorSync(parseError),
      })
    )
  )
}
```

`Schema.decodeUnknownEffect` returns an `Effect` — it doesn't throw (unlike `decodeUnknownSync`). This means validation failures are typed errors, not defects.

### Available Decode/Encode Functions

| Function | Returns | When to Use |
|---|---|---|
| `Schema.decodeUnknownSync(schema)(input)` | `Type` or throws | Test code, known-safe input |
| `Schema.decodeUnknownEither(schema)(input)` | `Either<Type, ParseError>` | When you need Either, not Effect |
| `Schema.decodeUnknownEffect(schema)(input)` | `Effect<Type, ParseError, never>` | In Effect pipelines (preferred) |
| `Schema.decodeSync(schema)(encoded)` | `Type` or throws | Already-validated input (re-decode) |
| `Schema.encodeSync(schema)(value)` | `Encoded` or throws | Convert domain type to wire format |
| `Schema.encodeEffect(schema)(value)` | `Effect<Encoded, ParseError, never>` | In Effect pipelines |

### The ParseError -> Domain Error Bridge

Always convert `ParseError` to a domain error at the boundary:

```typescript
const parseAndValidate = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((pe) => {
      const message = ParseResult.TreeFormatter.formatErrorSync(pe)
      return new ValidationFailed({ message })
    })
  )
```

This keeps `ParseError` from leaking into your service code.

---

## Part 6: Filters (Custom Validation)

Effect Schema provides built-in filters for common constraints:

```typescript
Schema.NonEmptyString          // minLength 1
Schema.Trim.pipe(Schema.minLength(2))    // trimmed, min 2 chars
Schema.Int                     // integer only
Schema.String.pipe(Schema.maxLength(100))
Schema.Number.pipe(Schema.greaterThan(0))
```

For custom validation, use `Schema.filter`:

```typescript
const Password = Schema.Trim.pipe(
  Schema.minLength(8),
  Schema.filter((s) => /[A-Z]/.test(s) || "Password must contain uppercase letter"),
  Schema.filter((s) => /[0-9]/.test(s) || "Password must contain a number"),
)
```

The filter predicate can return:
- `true` or `undefined` — passes
- `false` — fails with generic message
- `string` — fails with that message
- `{ path, message }` — fails with field-level error (for forms)

### Filter Annotations

Add identifiers and JSON Schema metadata:

```typescript
const LongString = Schema.String.pipe(
  Schema.filter((s) => s.length >= 10, {
    identifier: "LongString",
    jsonSchema: { minLength: 10 },
    description: "A string with at least 10 characters",
  })
)
```

---

## Part 7: Transformations

Use `Schema.transform` to convert between formats:

```typescript
// String to Date
const DateFromString = Schema.transform(
  Schema.String,
  Schema.Date,
  (s) => new Date(s),
  (d) => d.toISOString(),
)

// String to Number
const NumberFromString = Schema.NumberFromString
// Built-in: decodes "42" -> 42, encodes 42 -> "42"
```

Effect Schema provides many built-in transformations:

```typescript
Schema.NumberFromString   // "42" <-> 42
Schema.DateFromString     // "2024-01-01" <-> Date
Schema.JSONParsed         // stringified JSON -> parsed
Schema.BigIntFromString   // "9007199254740991" <-> BigInt
Schema.UUID               // validates UUID format
Schema.ULID               // validates ULID format
Schema.Secret             // sensitive string (Secret type)
Schema.Duration           // "5 seconds" <-> Duration
Schema.Redacted           // redacted string
```

### TransformOrFail for Fallible Transformations

```typescript
const IntFromString = Schema.transformOrFail(
  Schema.String,
  Schema.Int,
  (s, options) => {
    const n = Number(s)
    if (!Number.isInteger(n)) {
      return ParseResult.fail(new ParseResult.Type(
        Schema.Int.ast,
        n,
        `Expected integer, got ${s}`
      ))
    }
    return ParseResult.succeed(n)
  },
  (n) => ParseResult.succeed(String(n)),
)
```

---

## Part 8: JSON Schema and OpenAPI Generation

Schemas automatically produce JSON Schema:

```typescript
import { JSONSchema } from "effect"

const UserSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.NonEmptyString,
})

const jsonSchema = JSONSchema.make(UserSchema)
// {
//   "$schema": "http://json-schema.org/draft-07/schema#",
//   "type": "object",
//   "properties": {
//     "id": { "type": "number" },
//     "name": { "type": "string", "minLength": 1 }
//   },
//   "required": ["id", "name"]
// }
```

For OpenAPI 3.1:

```typescript
const openApiSchema = JSONSchema.make(UserSchema, { target: "openApi3.1" })
```

This is used by Effect HttpApi to auto-generate OpenAPI specs (see `effect-http-api` skill).

### Annotations for Better JSON Schema

```typescript
const UserSchema = Schema.Struct({
  id: Schema.Number.pipe(
    Schema.identifier("UserId"),
    Schema.description("Unique identifier for the user"),
  ),
  name: Schema.NonEmptyString.pipe(
    Schema.description("The user's full name"),
  ),
}).pipe(Schema.identifier("User"))
```

Annotations flow into JSON Schema `description` and `$id` fields.

---

## Part 9: Organizing Schemas in a Codebase

### Where Schemas Live

Schemas belong with the service that owns them, NOT in a centralized `schemas/` directory:

```
src/
  account/
    account.ts        ← Account service + Account domain schema
    account.test.ts
  api/
    routes.ts         ← API-specific schemas (request/response)
    openapi.ts        ← OpenAPI configuration
```

**Rule:** A schema lives in the module that defines the type it validates. If `Account` is a domain concept, its schema is in `account/account.ts`. If a request body is specific to an API route, its schema is in `api/routes.ts`.

### Schema Export Convention

Export schemas alongside interfaces:

```typescript
// src/account/account.ts
export const UserId = Schema.Number.pipe(Schema.brand("UserId"))
export type UserId = Schema.Schema.Type<typeof UserId>

export class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.NonEmptyString,
  email: Schema.String,
}) {}

export class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>()(
  "UserNotFound", { userId: UserId }
) {}
export type Error = UserNotFound
```

### When to Extract Shared Schemas

Only extract to a shared module when THREE or more services use the same schema:

```typescript
// src/shared/schemas.ts
import { Schema } from "effect"

export const Pagination = Schema.Struct({
  page: Schema.optionalWith(Schema.Int, { default: () => 1 }),
  limit: Schema.optionalWith(Schema.Int, { default: () => 20 }),
})

export const UserId = Schema.Number.pipe(Schema.brand("UserId"))
export type UserId = Schema.Schema.Type<typeof UserId>
```

---

## Part 10: Replacing Zod Patterns

| Zod Pattern | Effect Schema Equivalent |
|---|---|
| `z.string()` | `Schema.String` |
| `z.object({ name: z.string() })` | `Schema.Struct({ name: Schema.String })` |
| `z.string().min(1)` | `Schema.NonEmptyString` or `Schema.String.pipe(Schema.minLength(1))` |
| `z.string().brand<"UserId">()` | `Schema.String.pipe(Schema.brand("UserId"))` |
| `z.discriminatedUnion("_tag", [...])` | `Schema.TaggedErrorClass` / `Schema.TaggedUnion` |
| `z.infer<typeof schema>` | `Schema.Schema.Type<typeof schema>` |
| `z.input<typeof schema>` | `Schema.Schema.Encoded<typeof schema>` |
| `z.parse(data)` | `Schema.decodeUnknownSync(schema)(data)` |
| `z.safeParse(data)` | `Schema.decodeUnknownEither(schema)(data)` |
| `z.parseAsync(data)` | `Schema.decodeUnknownEffect(schema)(data)` | 

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| `Schema.decodeUnknownSync` in service code | Throws ParseError as defect | Use `Schema.decodeUnknownEffect` + `Effect.mapError` |
| Centralized `schemas/` directory | Schemas disconnected from domain | Co-locate schemas with their service |
| `class extends Error` instead of `Schema.TaggedErrorClass` | No _tag, no schema, no OpenAPI | Use `Schema.TaggedErrorClass` |
| Not exporting `Error` union | Callers can't see error surface | `export type Error = ...` in every service module |
| Using `Schema.Struct` where `Schema.Class` is needed | No methods, no constructors | Use `Schema.Class` for domain entities with behavior |
| Not branding IDs | UserId and AccountId are both `number` — interchangeable bugs | Brand every ID type |
| `try/catch` around decode | Blocks typed error flow | `decodeUnknownEffect` returns Effect — use catchTags |
| Using `any` for schema output | Loses type safety | Always use `Schema.Schema.Type<typeof schema>` |
| Ignoring `exactOptionalPropertyTypes` | Optional fields have wrong type | Enable in tsconfig |

## Red Flags — STOP and Fix

- `throw new Error(...)` in a service — use `yield* new TaggedErrorClass(...)`
- `class MyError extends Error { ... }` — use `Schema.TaggedErrorClass`
- `z.object(...)` in an Effect codebase — replace with `Schema.Struct`
- `z.infer<typeof X>` — replace with `Schema.Schema.Type<typeof X>`
- `schema.parse(data)` — replace with `Schema.decodeUnknownEffect(schema)(data)`
- Type `string` for a UserId — brand it
- `try { schema.parse(x) } catch { ... }` — use `decodeUnknownEffect` + `Effect.mapError`
- No `Error` export from a service module — add it
- `Schema.TaggedError` (not ErrorClass) — prefer `Schema.TaggedErrorClass` for class instances

## Quick Reference

```typescript
import { Schema, Effect, ParseResult } from "effect"

// 1. Branded primitive
export const UserId = Schema.Number.pipe(Schema.brand("UserId"))
export type UserId = Schema.Schema.Type<typeof UserId>

// 2. Domain error
export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  "NotFound", { id: Schema.Number, entity: Schema.String }
) {}

// 3. Struct for API I/O
const CreateUser = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.String,
})

// 4. Validation pipeline
const parse = (input: unknown) =>
  Schema.decodeUnknownEffect(CreateUser)(input).pipe(
    Effect.mapError((pe) => new NotFound({ id: 0, entity: "parse" }))
  )

// 5. JSON Schema
JSONSchema.make(CreateUser) // for OpenAPI
```
