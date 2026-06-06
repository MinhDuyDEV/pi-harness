# OpenCode-Style TypeScript Project

## Overview

A complete foundation for organizing a TypeScript project from scratch, based on the patterns used by OpenCode (167K-star coding agent platform). This covers project bootstrapping, module organization, Effect TS service architecture, error handling, dependency injection, testing, and observability — the structural decisions that define a maintainable codebase at scale.

This is the "how to build" foundation. Apply it BEFORE writing any application logic.

## When to Use

- Starting a new TypeScript project from scratch and want the right structure
- Setting up Effect TS in a new or existing codebase
- Organizing a monorepo or multi-service TypeScript project
- Reviewing codebase structure for maintainability and consistency
- Migrating from ad-hoc patterns to a structured service architecture

## When NOT to Use

- Single-file scripts or one-off tools (200 lines or less)
- Quick prototypes where structure is overhead
- Projects that cannot adopt Effect TS as a dependency
- Frontend-only React/Vue projects (this is backend/service-focused)

---

## Part 1: Project Bootstrap

### Runtime Selection

OpenCode uses **Bun**. Choose Bun for new projects — it provides TypeScript runtime, package manager, test runner, and bundler in one tool. No separate `tsc`, `vitest`, `node`, or `tsx` needed.

```json
// package.json — minimal start
{
  "name": "my-service",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "typecheck": "bun run tsc --noEmit",
    "test": "bun test",
    "dev": "bun run --watch src/index.ts"
  },
  "dependencies": {
    "effect": "^3.0.0",
    "@effect/platform": "^0.0.0",
    "@effect/platform-node": "^0.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "latest"
  }
}
```

OpenCode's `exports` map enables deep imports without relative path hell:

```json
{
  "exports": {
    "./*": "./src/*.ts"
  }
}
```

This lets you do `import { Foo } from "my-service/foo"` instead of `import { Foo } from "../../../foo"`.

### TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Key decisions:
- `erasableSyntaxOnly: true` — forces you to use `const enum` instead of `enum`, no `namespace`. OpenCode explicitly bans `export namespace Foo { }` in their AGENTS.md.
- `noUncheckedIndexedAccess: true` — forces handling of `undefined` on array/dict access. Catches real bugs.
- `allowImportingTsExtensions: true` — lets you write `.ts` extensions in imports, required by Bun.

### Directory Structure

```
src/
  effect/           # Effect infrastructure (runtime, bridge, state)
  config/           # Configuration modules
  service-a/        # One directory per domain service
  service-b/
  ...
  index.ts          # Entry point (composition root)
```

OpenCode's src directory has 40+ top-level directories, each representing a domain service or utility. No `utils/` or `helpers/` — every module has a concrete domain name.

OpenCode exceptions: `effect/` for Effect infrastructure, `env/` for environment, `cli/` for CLI commands.

---

## Part 2: Module Organization (The Core Pattern)

### The Namespace Projection Pattern

This is the single most important module convention. OpenCode uses it everywhere, codified in their AGENTS.md:

```typescript
// src/foo/foo.ts — the module file
export interface Interface {
  readonly doSomething: (input: string) => Effect.Effect<Result, Error, RequiredDeps>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}

export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)

// Self-reexport at the bottom
export * as Foo from "./foo"
```

Consumers import the namespace:

```typescript
import { Foo } from "@/foo/foo"

// Access service tag
Foo.Service

// Use layer
Foo.defaultLayer

// Access interface type
type MyService = Foo.Interface
```

**Rules:**
- Each service module gets ONE namespace export at the bottom
- Never use `export namespace Foo { ... }` — it breaks ESM tree-shaking and Node's native TS runner
- Every service must expose: `Interface`, `Service`, `layer`, `defaultLayer`
- Internal helpers stay as non-exported top-level declarations (no namespace pollution)

### When the Module is an `index.ts`

If the module is `foo/index.ts` (single-namespace directory), use `"."` for the self-reexport:

```typescript
// src/foo/index.ts
export const thing = ...
export * as Foo from "."
```

### Multi-Sibling Directories — NO Barrel Files

For directories with independent modules (e.g., `src/session/`, `src/config/`), keep each as its own file with its own self-reexport. **Do NOT add an `index.ts` barrel.**

```typescript
// DON'T — no barrel index.ts
export { SessionRetry } from "./retry"
export { SessionStatus } from "./status"

// DO — consumers import directly:
import { SessionRetry } from "@/session/retry"
import { SessionStatus } from "@/session/status"
```

Barrels in multi-sibling directories force every import through the barrel to evaluate EVERY sibling, defeating tree-shaking and slowing module load. OpenCode explicitly bans this.

### File Naming

- Service files: `kebab-case.ts` (e.g., `instance-state.ts`, `app-runtime.ts`)
- Test files: `<name>.test.ts` (Bun convention)
- SQL schema files: `<name>.sql.ts` (Drizzle convention)
- Type definition files: `<name>.d.ts` (ambient declarations)

---

## Part 3: Effect Service Architecture

### The Three-Layer Service Structure

Every service follows the same pattern:

```
Layer 1: Interface  — what the service does (pure type)
Layer 2: Service Tag — how to access it at runtime (Context.Tag)
Layer 3: Layer      — how to construct it (implementation + dependencies)
```

```typescript
// src/account/account.ts
import { Context, Effect, Layer, Schema } from "effect"

// ====== 1. Errors ======
export class AccountNotFound extends Schema.TaggedErrorClass<AccountNotFound>()(
  "AccountNotFound",
  { accountId: Schema.String }
) {}
export class AccountBanned extends Schema.TaggedErrorClass<AccountBanned>()(
  "AccountBanned",
  { accountId: Schema.String, reason: Schema.String }
) {}
export type Error = AccountNotFound | AccountBanned

// ====== 2. Interface ======
export interface Interface {
  readonly get: (id: string) => Effect.Effect<Account, Error>
  readonly list: (filters: Filters) => Effect.Effect<readonly Account[], Error>
}

// ====== 3. Service Tag ======
export class Service extends Context.Service<Service, Interface>()("@myapp/Account") {}

// ====== 4. Implementation & Layer ======
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service  // dependency declared here
    return {
      get: (id) => db.query("SELECT * FROM accounts WHERE id = $1", [id]),
      list: (filters) => db.query("SELECT * FROM accounts WHERE ...", [filters]),
    }
  })
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer)  // wire dependencies
)

// Self-reexport
export * as Account from "./account"
```

### Named Effects (Effect.fn pattern)

OpenCode uses `Effect.fn` for every important effect. It names the effect for tracing:

```typescript
// Use Effect.fn for named, traceable effects
const chargeCustomer = Effect.fn("Account.charge")(function* (
  userId: string,
  amount: number
) {
  const account = yield* Account.Service
  const stripe = yield* Stripe.Service
  const accountInfo = yield* account.get(userId)
  const charge = yield* stripe.charge(accountInfo.stripeId, amount)
  return charge
})
// Inferred: Effect<Charge, Account.Error | Stripe.Error, Account.Service | Stripe.Service>
```

`Effect.fn` auto-traces the function name in OpenTelemetry spans. Use it for every public operation. Use `Effect.fnUntraced` for internal helpers where tracing overhead isn't worth it.

### Composing Dependencies with Layers

```typescript
// src/main.ts — composition root
import { Layer, Effect } from "effect"
import { Account } from "./account/account"
import { Stripe } from "./stripe/stripe"
import { Database } from "./database/database"

// Compose ALL layers (the dependency graph)
const AppLayer = Layer.mergeAll(
  Database.defaultLayer,
  Account.defaultLayer,  // depends on Database
  Stripe.defaultLayer,   // depends on Database + Account
)

// Annotate the layer type explicitly for compiler traceability
// : Layer.Layer<Database.Service | Account.Service | Stripe.Service>
```

---

## Part 4: Error Handling

### Typed Errors (Schema.TaggedErrorClass)

Every domain error is a `Schema.TaggedErrorClass` — a discriminated union with a `_tag` field for pattern matching:

```typescript
import { Schema } from "effect"

export class NotFound extends Schema.TaggedErrorClass<NotFound>()(
  "NotFound",
  { id: Schema.String, entity: Schema.String }
) {}

export class ValidationFailed extends Schema.TaggedErrorClass<ValidationFailed>()(
  "ValidationFailed",
  { field: Schema.String, reason: Schema.String }
) {}

export type Error = NotFound | ValidationFailed
```

**Rules (from OpenCode's errors.md):**
- Use `Schema.TaggedErrorClass` for ALL expected domain errors
- Export a domain-level `Error` union from each service module
- Put expected errors in service method signatures
- Use `yield* new MyError(...)` for direct early failure (prefer over `yield* Effect.fail(new MyError(...))`)
- NEVER use `throw` in service code
- NEVER use `Effect.die(...)` for expected failures (reserve for bugs/impossible states)
- NEVER use `try/catch` in service code (use `Effect.catchTag`, `Effect.catchTags`, `Effect.try`)

### Catching and Recovering

```typescript
// Catch specific error tags
const safeCharge = chargeCustomer(userId, amount).pipe(
  Effect.catchTags({
    AccountNotFound: () => Effect.succeed(defaultCharge),
    AccountBanned: (e) => Effect.fail(new ChargeBlocked({ reason: e.reason })),
  })
)

// Convert external exceptions to domain errors
const readFile = (path: string) =>
  Effect.tryPromise({
    try: () => fs.readFile(path, "utf-8"),
    catch: (unknown) => new FileError({ path, message: String(unknown) }),
  })
```

### Defects vs Failures

**Failures** are expected, domain-shaped, recovered from. They live in `Effect<E>`.

**Defects** are bugs — null dereferences, infinite loops, violated invariants. They are NOT in `E`. If you catch a defect, you're hiding real bugs.

The rule: domain failures go in the type. Everything else crashes the fiber. If you need to surface an unexpected failure at a boundary, use `Effect.catchAllDefect` at the EDGE only (HTTP handler, main function).

---

## Part 5: Platform-Specific Code (Conditional Imports)

OpenCode uses Bun's `#imports` pattern for platform-specific code (Bun vs Node.js):

```json
// package.json
{
  "imports": {
    "#db": {
      "bun": "./src/storage/db.bun.ts",
      "node": "./src/storage/db.node.ts",
      "default": "./src/storage/db.bun.ts"
    },
    "#pty": {
      "bun": "./src/pty/pty.bun.ts",
      "node": "./src/pty/pty.node.ts",
      "default": "./src/pty/pty.bun.ts"
    }
  }
}
```

```typescript
// Consumer — no platform branching needed
import { db } from "#db"
```

Use this pattern for:
- Database drivers (Bun SQLite vs Node pg)
- Terminal/PTY implementations
- File system watching
- Any API with different Bun/Node implementations

Each implementation exposes the same interface. The bundler resolves the right file at build time.

---

## Part 6: Runtime Setup

Effect programs are descriptions — they don't run until you give them a Runtime. OpenCode's pattern:

```typescript
// src/effect/app-runtime.ts
import { Layer, Effect, ManagedRuntime } from "effect"
import { AppLayer } from "../main"

// Create a managed runtime with all services pre-loaded
export const AppRuntime = ManagedRuntime.make(AppLayer)

// In your entry point:
const main = Effect.gen(function* () {
  // All services are available via yield* Tag
  const accounts = yield* Account.Service
  const result = yield* accounts.get("123")
  console.log(result)
})

AppRuntime.runPromise(main)
```

For per-request or per-session state, OpenCode uses `InstanceState`:

```typescript
// src/effect/instance-state.ts
// Scoped state that's automatically cleaned up when the scope ends
// Used for per-project or per-user state
```

---

## Part 7: Testing

### Test Layers (No Module Mocking)

The Layer pattern means you NEVER need `jest.mock()` or `vi.mock()`:

```typescript
import { Layer, Effect } from "effect"
import { Database } from "../database/database"

// Real implementation
const testData = new Map<string, Account>()
const TestDatabase = Layer.succeed(Database.Service, {
  query: (sql, params) => {
    if (sql.includes("accounts WHERE id")) {
      const account = testData.get(params[0] as string)
      return account ? [account] : []
    }
    return []
  },
})

// Compose test layer for the service under test
const TestLayer = Account.layer.pipe(
  Layer.provide(TestDatabase)
)

// Test
it("should find an account by id", async () => {
  testData.set("123", { id: "123", name: "Test" })

  const result = await AppRuntime.runPromise(
    Account.Service.pipe(
      Effect.flatMap((svc) => svc.get("123")),
      Effect.provide(TestLayer)
    )
  )

  expect(result.id).toBe("123")
})
```

No mocking library. No module-level singletons. Every dependency is injected via Layer.

### Integration Testing

For services that combine multiple dependencies:

```typescript
const TestLayer = Layer.mergeAll(
  TestDatabase,
  TestStripe,
  TestMailer,
)

const program = Effect.gen(function* () {
  const svc = yield* Account.Service
  return yield* svc.charge("123", 50_00)
})

await expect(
  AppRuntime.runPromise(program.pipe(Effect.provide(TestLayer)))
).resolves.toBeDefined()
```

---

## Part 8: Code Conventions (From OpenCode's AGENTS.md)

### Flat Top-Level Exports

```typescript
// GOOD — flat exports
export interface Interface { ... }
export class Service extends ... { ... }
export const layer = ...
export * as Foo from "./foo"

// BAD — namespace blocks
export namespace Foo {
  export interface Interface { ... }
  // Breaks ESM, tree-shaking, and native TS runner
}
```

### Effect Composition

```typescript
// Use Effect.gen with yield* (looks like async/await)
const program = Effect.gen(function* () {
  const user = yield* getUser(id)
  return yield* process(user)
})

// Use Effect.fn for named operations
const namedOp = Effect.fn("Module.method")(function* (input: string) {
  return yield* doWork(input)
})

// Prefer yield* new Error() over yield* Effect.fail(new Error())
yield* new NotFound({ id, entity: "User" })  // GOOD
yield* Effect.fail(new NotFound({ id, entity: "User" }))  // VERBOSE, OK
```

### Effect vs Platform APIs

Within Effect services, prefer Effect-provided platform APIs:

```typescript
// PREFER Effect platform APIs
import { FileSystem } from "@effect/platform"
import { HttpClient } from "@effect/platform"
import { Path } from "@effect/platform"

const read = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const content = yield* fs.readFileString("/path")
  return content
})

// AVOID dropping down to raw fs/promises inside Effect code
// (unless you're at a bridge boundary)
```

### Caching

Use `Effect.cached` for deduplicating concurrent calls — don't hand-roll `Fiber | undefined` state:

```typescript
// GOOD — Effect.cached handles concurrent callers deduplication
const getConfig = Effect.cached(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const raw = yield* fs.readFileString("/etc/config.json")
    return JSON.parse(raw)
  })
)

// BAD — manual fiber/state tracking
let configPromise: Promise<Config> | undefined
```

### Forking Fibers

For background work (stream consumers, scheduled tasks), use `Effect.forkScoped` inside a Layer definition:

```typescript
export const layer = Layer.scoped(
  Service,
  Effect.gen(function* () {
    const mq = yield* MessageQueue.Service
    // Background consumer — auto-interrupted when scope ends
    yield* Effect.forkScoped(
      mq.consume("events").pipe(
        Effect.flatMap(handleEvent),
        Effect.forever
      )
    )
    return { ... }
  })
)
```

For fire-and-forget init work (no-cleanup-needed), use `Effect.forkDetach`:

```typescript
Effect.forkDetach(service.init())  // fire and forget
```

---

## Part 9: Project Tools and Conventions

### Testing

- Use **Bun test** (`bun test`) — no Jest/Vitest needed with Bun
- Test files co-located with source: `foo.test.ts` next to `foo.ts`
- Use `bun test --timeout 30000` for integration tests (30s timeout)
- Use JUnit reporter for CI: `bun test --reporter=junit`

### Type-Checking

- Use `tsc --noEmit` for type-checking (or Bun's built-in check)
- OpenCode uses `tsgo` (a faster tsc wrapper)
- Type-check BEFORE test — failing types = failing build

### Monorepo

OpenCode is a monorepo with workspaces. Pattern:

```
packages/
  opencode/      # Main application
  core/          # Shared core library
  sdk/           # SDK for external consumers
  ui/            # UI components
  plugin/        # Plugin system
```

Use `"workspaces": ["packages/*"]` in root `package.json`.

---

## Part 10: Dependencies and Ecosystem (Based on OpenCode's Stack)

| Concern | OpenCode's Choice | Alternative |
|---|---|---|
| Runtime | Bun | Node 22+ with tsx |
| Core framework | Effect TS | None comparable |
| Schema | Effect Schema | Zod (pre-migration) |
| Database | Drizzle ORM | Prisma, Kysely |
| HTTP API | Effect HttpApi | Hono, Elysia |
| UI | Solid.js + @opentui | React, Vue |
| CLI | yargs + Effect | Commander, meow |
| Observability | @effect/opentelemetry | OpenTelemetry SDK |
| File watching | @parcel/watcher | chokidar |
| Linting/Format | Prettier | Biome, dprint |
| Event bus | Effect PubSub | Custom EventEmitter |
| State management | Immer | Mutative |
| Retry | Effect Schedule | opossum (pre-Effect) |
| Workflow | Effect Workflows | Temporal, Inngest |
| Installer | bun install | npm, pnpm, yarn |
| Auth | @openauthjs/openauth | Clerk, Auth0 |
| RPC | @effect/rpc | tRPC, GraphQL |
| Platform adapters | @effect/platform | None comparable |

---

## Part 11: Scaffolding a New Service

The fastest path to add a new service to an existing Effect codebase:

```typescript
// src/payments/payments.ts
import { Context, Effect, Layer, Schema } from "effect"

// 1. Errors
export class PaymentFailed extends Schema.TaggedErrorClass<PaymentFailed>()(
  "PaymentFailed",
  { amount: Schema.Number, reason: Schema.String }
) {}
export type Error = PaymentFailed

// 2. Interface
export interface Interface {
  readonly process: (amount: number, userId: string) => Effect.Effect<Receipt, Error>
}

// 3. Service tag
export class Service extends Context.Service<Service, Interface>()("@app/Payments") {}

// 4. Layer with dependencies
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service
    const stripe = yield* Stripe.Service
    return {
      process: (amount, userId) =>
        Effect.gen(function* () {
          const user = yield* db.getUser(userId)
          const charge = yield* stripe.charge(user.stripeId, amount)
          yield* db.saveReceipt(charge)
          return toReceipt(charge)
        }),
    }
  })
)

// 5. Default layer wiring
export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Stripe.defaultLayer),
)

// 6. Reexport
export * as Payments from "./payments"
```

Then at the composition root:

```typescript
// src/main.ts — add to Layer.mergeAll
const AppLayer = Layer.mergeAll(
  Database.layer,
  Account.layer,
  Stripe.layer,
  Payments.layer,  // <-- add here
)
```

---

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Barrel `index.ts` files | Forces eager evaluation of ALL siblings | Import individual files directly |
| `export namespace Foo {}` | Breaks ESM, tree-shaking, native TS runner | Use `export * as Foo from "./foo"` |
| `throw` in service code | Bypasses Effect's typed error system, becomes a defect | Return typed errors via `yield* new Error()` |
| `try/catch` in Effect code | Defeats Effect's error composition | Use `Effect.catchTag` / `Effect.catchTags` / `Effect.try` |
| Module-level singletons | Blocks testing (no DI), couples services | Use Context.Tag + Layer everywhere |
| Hand-rolled retry logic | Misses backoff, jitter, max duration | Use Effect.Schedule |
| `namespace` for helpers | Pollutes type space, breaks isolatedModules | Non-exported top-level function |
| One giant Layer | Circular dependency risk, slow compilation | One service per directory, compose at root |
| Manual `jest.mock()` | Fragile, couples test to module system | Test layers via Layer.succeed |
| `Effect.runPromise` inside services | Creates opaque async boundaries | Keep services pure Effect, run at edge only |
| Not exporting `Error` union | Callers can't see what might fail | `export type Error = ...` in every service module |

## Rationalization Table

| Excuse | Reality |
|---|---|
| "Barrel files are convenient" | Every import of one sibling loads ALL siblings. At 40+ services, this is measurable startup cost. |
| "I'll just use a simple class instead of Context.Tag" | Classes can't be swapped in tests. Context.Tag + Layer gives you test doubles for free at the type level. |
| "throw is fine for this error, it's exceptional" | Every exceptional case becomes a catch-all handler that swallows real bugs. Typed errors are checked by the compiler. |
| "I don't need Effect for a small project" | The patterns scale down. A 3-service project with Effect has the same shape as a 40-service project. The structure costs nothing. |
| "I'll add the service tag later" | By then, callers have hardcoded dependencies. The refactor cost is higher the longer you wait. |
| "This is an edge case, I'll handle it with an if/throw" | Edge cases become production bugs when untyped. Every error path should be a typed error. |
| "namespace is standard TypeScript" | It's not standard ESM. It prevents tree-shaking and breaks Node's native TS runner. OpenCode bans it. |
| "I'll use an index.ts barrel for the public API" | Public API should be explicit. Consumers should import exactly what they need, not an indiscriminate bundle. |

## Red Flags — STOP and Fix

- `throw new Error(...)` inside Effect code — No. Use `yield* new MyTaggedError(...)`
- `try { ... } catch (e) { ... }` in service code — No. Use `Effect.catchTag`
- `export namespace Foo {` — No. Use `export * as Foo from "./foo"`
- `index.ts` barrel file in a multi-module directory — No. Import individual files.
- `jest.mock(...)` or `vi.mock(...)` — No. Use `Layer.succeed` for test doubles.
- `new SomeService()` in business logic — No. Use `yield* Service.Tag`
- `Effect.runPromise` inside another effect — No. Keep effects pure, run at edge.
- Importing from `zod` in new code — OpenCode is migrating to Effect Schema. Use `Schema.Class` and `Schema.TaggedErrorClass`.

## Quick Reference

### One Module Template

```typescript
import { Context, Effect, Layer, Schema } from "effect"

// Errors
export class MyError extends Schema.TaggedErrorClass<MyError>()("MyError", { ... }) {}
export type Error = MyError

// Interface
export interface Interface { readonly op: () => Effect.Effect<Result, Error> }

// Service Tag
export class Service extends Context.Service<Service, Interface>()("@app/MyService") {}

// Layer
export const layer: Layer.Layer<Service, never, Deps> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const dep = yield* Deps.Service
    return { op: () => dep.doWork() }
  })
)

// Reexport
export * as MyService from "./my-service"
```

### Effect Operations Cheat Sheet

```typescript
// Composition
Effect.gen(function* () { ... })
Effect.fn("Name.method")(function* (...) { ... })

// Error handling
Effect.catchTag(eff, "Tag", handler)
Effect.catchTags(eff, { Tag1: h1, Tag2: h2 })
Effect.tryPromise({ try, catch })

// Resource management
Effect.acquireRelease(acquire, release)
Effect.scoped(inner)

// Concurrency
Effect.all([a, b, c], { concurrency: "unbounded" })
Effect.race(a, b)
Effect.timeout(eff, "5 seconds")

// Retry
Effect.retry(eff, Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(3))))

// Testing
Layer.succeed(Tag, impl)
Layer.provide(Layer.mergeAll(A, B, C))

// Running
ManagedRuntime.make(AppLayer).runPromise(program)
```
