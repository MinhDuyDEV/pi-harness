---
name: opencode-ts-service
description: Use when starting a new TypeScript project from scratch, organizing a codebase following OpenCode-style patterns,
  setting up Effect TS service architecture, or structuring TypeScript services with proper module conventions, type-safe
  error handling, and dependency injection. MUST load before writing any new service or module for a project following Effect-based
  architecture.
metadata:
  version: 1.0.0
disable-model-invocation: true
---

# TypeScript Service (Effect-style)

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Service = interface + Tag + Layer.** Never `new Service()` directly. Always `const S = Context.Tag<S>()`
- **Errors as data, not exceptions.** `class E extends Schema.TaggedError<...>()`, not `throw new Error(...)`
- **Dependencies via `Effect.gen({...})`** — typed, tracked, swappable. No manual DI containers.
- **No `any`.** Branded primitives, schema-validated boundaries, no `as any` escape hatches.
- **No thrown strings.** `Effect.fail(...)` or typed errors, never `throw "..."`.
</EXTREMELY-IMPORTANT>

## Core Pattern

```ts
// 1. Service interface
interface UserService {
  getUser: (id: UserId) => Effect.Effect<User, UserNotFound>
}

// 2. Tag (the service reference)
class UserService extends Context.Tag("UserService")<
  UserService,
  UserService
>() {}

// 3. Layer (the implementation)
const UserServiceLive = Layer.succeed(UserService, {
  getUser: (id) => db.query("SELECT * FROM users WHERE id = $1", [id]).pipe(...)
})

// 4. Use via Effect.gen
const program = Effect.gen(function* () {
  const users = yield* UserService
  return yield* users.getUser(UserId.make("123"))
})

// 5. Provide the layer
Effect.runPromise(program.pipe(Effect.provide(UserServiceLive)))
```

## Module Conventions

- One public export per file (default export is OK)
- `index.ts` is a barrel only when stable; prefer direct imports
- Services go in `services/<name>/{index.ts, errors.ts, schema.ts}`
- Errors in `errors.ts`, schemas in `schema.ts`, both exported alongside service
- Tests co-located as `*.test.ts` (NOT `__tests__`)

## Type-Safe Errors

```ts
class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  { id: UserId }
) {}

const getUser = (id: UserId): Effect.Effect<User, UserNotFound | DbError> =>
  Effect.gen(function* () {
    const row = yield* db.query(...).pipe(Effect.mapError(toDbError))
    return yield* row ? Effect.succeed(row) : Effect.fail(new UserNotFound({ id }))
  })
```

The return type is the contract. Callers handle `UserNotFound | DbError` explicitly — no `try/catch`.

## Dependency Injection

- `Layer.succeed` for synchronous, in-memory
- `Layer.effect` for async initialization
- `Layer.mergeAll` for combining multiple layers
- `Layer.provide(L1, L2)` to wire dependencies
- Test layers use `Layer.succeed` with in-memory implementations

## Testing Services

```ts
const TestUserService = Layer.succeed(UserService, {
  getUser: (id) => Effect.succeed(testUser(id))
})

const result = Effect.runPromise(
  programUnderTest.pipe(Effect.provide(TestUserService))
)
```

Use `Effect.gen` for setup/teardown. Never mock the service interface — provide an alternate Layer.

## Common Mistakes

- `new MyService()` in business code (not a Layer, not testable)
- `throw new Error(...)` (loses type safety, untestable)
- `any` to escape schema validation (defeats the whole system)
- Global state (services that hold state outside their Layer)
- Mocking via `jest.mock()` instead of providing test Layers
- Returning `Promise<T>` from a service method (use `Effect.Effect<T, E>`)
- Side effects in service constructors (use `Layer.effect` for init)

## Red Flags

Business code `new`s services; errors are `throw`-n; `as any` for "convenience"; testing mocks the implementation; service constructor does I/O; service has global state; `Promise<T>` in service interface; untested error branches.

## Anti-Patterns

**"Simple service"** that throws (no error type); **"just one any"** that spreads; **"constructor is fine"** (init via Layer.effect); **"mock with jest"** (provide a test Layer); **"global config"** (config as a service).
