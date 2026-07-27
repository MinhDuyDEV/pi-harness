---
name: effect-service-patterns
description: >-
  Effect TS service architecture — Tag/Layer service definitions, typed errors as data, dependency
  injection via layers, and testing by providing alternate layers. User-invoked: load via
  /skill:effect-service-patterns when writing or structuring services in an Effect-based TypeScript
  codebase.
metadata:
  version: 1.0.0
disable-model-invocation: true
---

# Effect Service Patterns

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Service = interface + Tag + Layer.** Never `new Service()` directly. Always `const S = Context.Tag<S>()`
- **Errors as data, not exceptions.** `class E extends Schema.TaggedError<...>()`, not `throw new Error(...)`
- **Dependencies via `yield*` inside `Effect.gen`** — typed, tracked, swappable. No manual DI containers.
- **No `any`.** Branded primitives, schema-validated boundaries, no `as any` escape hatches.
- **No thrown strings.** `Effect.fail(...)` or typed errors, never `throw "..."`.
</EXTREMELY-IMPORTANT>

## Core Pattern

```ts
// 1. Service interface
interface UserServiceApi {
  getUser: (id: UserId) => Effect.Effect<User, UserNotFound>
}

// 2. Tag (the service reference)
class UserService extends Context.Tag("UserService")<
  UserService,
  UserServiceApi
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

## Red Flags

Business code `new`s services (not a Layer, not testable); errors are `throw`-n (loses the typed error channel); "just one `any`" to escape schema validation (it spreads, defeats the system); mocking via `jest.mock()` instead of providing a test Layer; side effects or I/O in a service constructor (init via `Layer.effect`); service holds global state outside its Layer; `Promise<T>` in a service interface (use `Effect.Effect<T, E>`); untested error branches; "global config" (config is a service too).
