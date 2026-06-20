---
name: typescript-coding-standards
description: Use when writing, refactoring, or reviewing TypeScript code that needs strong domain modeling, typed errors, schema parsing, safe adapters, test seams, or maintainable module boundaries.
version: 1.0.0
tags: [typescript, code-quality, architecture, testing]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: []
---

# TypeScript Coding Standards

Apply these standards when designing or editing TypeScript code. They are especially useful for agent-written code because they reduce shallow abstractions, untyped failure modes, unsafe DTO leakage, and tests that only verify implementation details.

These standards are adapted from dmmulroy's TypeScript coding standards draft: https://gist.github.com/dmmulroy/9c80f1f499b031aa0b6525b5d9ae25f0

## Decision Priority

When rules conflict, use this order:

1. Preserve correctness, safety, and debuggability.
2. Follow established project architecture and conventions.
3. Improve the local design toward these standards.
4. Avoid broad migrations unless explicitly requested.
5. Document meaningful trade-offs with comments or ADRs.

New code paths should generally follow these standards, but do not force unrelated whole-project migrations.

## Before Coding

Inspect the repository for existing choices around:

- Error handling and failure representation.
- Schema parsing and domain type construction.
- Dependency injection and service/adaptor style.
- Testing approach and seams.
- Observability, logging, tracing, and error reporting.
- Module layout, file naming, and import style.

Prefer local consistency. If existing code uses exception-style errors, do not rewrite the whole system. New internals may use typed results, but boundary code must integrate with existing framework handlers, logging, tracing, metrics, and rendering behavior.

## Core Principles

- Prefer errors as values over `throw` or rejected promises for expected failures.
- Parse early; do not validate and discard the parsed knowledge.
- Make illegal states unrepresentable where practical.
- Prefer correct-by-construction APIs over convention-based invariants.
- Use branded, refined, or domain types for meaningful primitives.
- Prefer composition over inheritance.
- Prefer imperative shell and functional core.
- Design deep, cohesive modules with low caller burden.
- Test behavior through real seams; avoid module mocks and spy-driven tests.
- Keep code discoverable for humans and agents.

## Expected Failures Are Values

Expected failures include domain, parsing, authorization, integration, I/O, persistence, and workflow failures. They should appear in the return type.

Preferred order:

1. `Effect`, when the codebase already uses Effect.
2. `better-result`, when already available and appropriate.
3. A small local tagged union.

Example:

```ts
type Result<T, E extends Error> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E };
```

Prefer:

```ts
Promise<Result<User, UserLookupError>>
```

Avoid for ordinary lookup/storage failures:

```ts
Promise<User>
```

Promise rejection is equivalent to throwing. Use it only for unrecoverable defects or unclassified third-party behavior at a boundary.

## Throw Only for Unrecoverable Defects

Throwing is acceptable for panic-style failures:

- Violated internal invariants.
- Impossible branches.
- Startup misconfiguration.
- Temporary `notYetImplemented` paths.
- Catastrophic runtime conditions.

Use existing shared helpers where present, such as `casesHandled`, `shouldNeverHappen`, or `notYetImplemented`. Use `casesHandled` for exhaustive union handling instead of creating one-off `assertNever` variants when a project helper already exists.

## Custom Error Types

Expected failures should use custom tagged errors, generally extending one of:

- `Error`.
- `TaggedError` from `better-result`.
- `Schema.TaggedErrorClass` in Effect codebases.

Custom errors should include:

- Stable tag.
- Useful message.
- Structured contextual fields.
- Safe telemetry fields.
- Optional `cause: unknown`.

Keep error unions precise at module boundaries:

```ts
Result<User, UserNotFound | UserStoreUnavailable>
```

Avoid broad `AppError` types except near entrypoints, orchestration, logging, and rendering layers.

## Sensitive Data and Telemetry

Prefer end-to-end structured tracing across requests, jobs, workflows, application modules, adapters, and external calls.

Use safe diagnostic fields:

- Domain IDs.
- Operation names.
- Dependency/provider names.
- State tags.
- Retry counts.
- Typed error tags.
- Safe summaries.

Do not put secrets in errors, traces, logs, or snapshots.

Use a `Redacted<T>` wrapper for sensitive values such as tokens, API keys, passwords, credentials, and secrets. Prefer Effect's `Redacted.Redacted` in Effect codebases or a local `Redacted<T>` in a shared prelude. Wrap sensitive values at the boundary and unwrap only inside the adapter that needs the raw value.

## Parse, Do Not Merely Validate

Boundary code should turn unknown or less-structured input into domain types as early as practical.

Prefer this flow:

```text
unknown -> HttpBodyDto -> CreateUserInput -> EmailAddress/UserId/etc.
```

Avoid passing `z.infer<typeof SomeSchema>` or raw DTOs throughout application/core logic.

Naming conventions:

- `parseX(input): Result<X, ParseXError>` for untrusted or less-structured input.
- `makeX(...)` or `createX(...)` for smart constructors from already-typed pieces.
- `isX(value): boolean` for true predicates.
- `assertX(...)` rarely, mostly at test or framework boundaries.

Avoid `validateX` when the function returns a refined value. It parsed something.

## Schema Usage

Use schema libraries as boundary parsers, not ad-hoc validators sprinkled through core logic.

Preference:

1. Use the repo's established schema library if one exists.
2. Use Effect Schema in Effect codebases.
3. Prefer Standard Schema compatibility for generic helpers.
4. Otherwise prefer Zod 4.
5. Use hand-written smart constructors/parsers for small domain types when clearer.

Schema parsing should produce refined/domain types and typed custom errors where practical.

## Branded Types and Correct Construction

Use branded/refined types for meaningful primitives:

- IDs: `UserId`, `OrgId`, `WorkflowId`.
- Parsed strings: `EmailAddress`, `NonEmptyString`, `Url`.
- Constrained numbers: `PositiveInt`, `Cents`, `Percentage`.
- Units: `Milliseconds`, `Bytes`, `UsdCents`.

Construct branded values through parsers or smart constructors. Avoid passing raw strings or numbers where a domain type exists.

Avoid optional/null/undefined values in functions that require a value. Push optionality outward, then branch or parse before calling.

Avoid `Partial<T>` as an application/domain input unless partiality is the real domain concept. Prefer explicit input types for each operation.

## State Machines and Boolean Blindness

When an entity has meaningful lifecycle states, model them with tagged unions or equivalent value classes.

Prefer:

```ts
type Invoice =
  | { readonly _tag: "Draft"; readonly id: InvoiceId; readonly lines: NonEmptyArray<LineItem> }
  | { readonly _tag: "Sent"; readonly id: InvoiceId; readonly sentAt: Instant }
  | { readonly _tag: "Paid"; readonly id: InvoiceId; readonly paidAt: Instant };
```

Avoid:

```ts
type Invoice = {
  readonly isSent: boolean;
  readonly isPaid: boolean;
  readonly sentAt?: Date;
  readonly paidAt?: Date;
};
```

Avoid boolean parameters that control behavior:

```ts
createUser(input, true);
```

Prefer named options or domain types:

```ts
createUser(input, { emailVerification: "skip" });
```

Booleans are fine as clear predicate return values, such as `isExpired(token)` or `hasPermission(user, permission)`.

## Deep Modules

A deep module hides substantial behavior and invariants behind a cohesive, low-burden interface. Low-burden does not necessarily mean few functions; a domain module can expose many cohesive combinators around one concept and still be deep.

Avoid shallow abstractions that merely forward calls, mirror tables, or expose implementation steps.

Use the deletion test:

- If deleting the module makes complexity disappear, it was probably pass-through waste.
- If deleting it spreads complexity across callers, it was probably earning its keep.

## Domain Modules

Prefer OCaml-style domain modules for core concepts. A domain module centers on one primary type or tightly related type family and exposes parsers, smart constructors, combinators, predicates, interpreters, arbitraries, and formatting helpers.

Example shape:

```ts
/** A parsed, normalized email address. */
export type EmailAddress = Brand<string, "EmailAddress">;

/** Parse an email address from untrusted input. */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress>;

/** Render an email address as a string. */
export function toString(email: EmailAddress): string;

/** Compare two email addresses for equality. */
export function equals(left: EmailAddress, right: EmailAddress): boolean;
```

Domain modules may use plain functions, classes, or static-style classes when cohesive.

If using classes for domain values:

- Construct through `parse`, `make`, or smart constructors.
- Make invalid instances unconstructable.
- Keep fields readonly/immutable from callers.
- Keep methods cohesive over that value.
- Do not hide dependencies or I/O inside domain value classes.
- Avoid inheritance for domain behavior.

## Application and Service Modules

Application modules own real capabilities or operations, such as `PasswordReset`, `Billing`, `Invitations`, or `SubscriptionLifecycle`.

They coordinate domain modules, persistence, external calls, authorization, workflows, and telemetry.

Prefer classes with constructor injection when the module has dependencies, stateful resources, configuration, or multiple cohesive operations.

Avoid dependency bags passed into every function. In Effect codebases, use Effect services/tags/layers instead.

No arbitrary method limit. Split when methods are unrelated, change for different reasons, require unrelated dependencies, or create an accidental grab bag.

Avoid vague names like `Manager`, `Processor`, `Helper`, or generic `UserService` unless established by the framework/project.

## Dependency Interfaces and Adapters

Depend on the smallest meaningful shape a module actually uses. Let concrete adapters be wider.

Because TypeScript is structurally typed, this works well:

```ts
type UsersForPasswordReset = {
  findActiveByEmail(email: EmailAddress): Promise<Result<ActiveUser, UserLookupError>>;
};

export class PasswordReset {
  constructor(private readonly users: UsersForPasswordReset) {}
}
```

A wider adapter can still satisfy it:

```ts
export class PostgresUsers {
  findActiveByEmail(...) { ... }
  findById(...) { ... }
  updateProfile(...) { ... }
}
```

This avoids both mega-repositories and one-method adapter sprawl.

## Adapter Reuse Audit

Before creating a new adapter or service, audit existing adapters/services.

Prefer, in order:

1. Reuse an existing adapter as-is through a narrow dependency type.
2. Extend an existing adapter if the new method fits its existing cohesive capability and changes for the same reason.
3. Create a new adapter only when reuse or extension would create bad coupling or an accidental interface.

When a meaningful new adapter/service is still created after the audit, create an ADR explaining:

- Existing adapters/services checked.
- Why reuse did not fit.
- Why extension did not fit.
- Why the new adapter is a separate cohesive capability.

Do not require an ADR for tiny local test adapters, obvious in-memory fakes, or trivial framework glue.

## Persistence

Avoid repository-per-table by default.

Repository-like adapters are acceptable when they represent a cohesive domain persistence capability. They should expose meaningful domain operations and return parsed domain types / typed errors, not raw rows and ORM errors.

Treat raw database rows and ORM models as infrastructure DTOs. Parse them before application/core logic. Keep SQL/ORM details inside infrastructure adapters or persistence modules.

## Functional Core and Imperative Shell

Keep domain/application behavior reusable across REST, CLI, GraphQL, workers, and other entrypoints.

The functional core contains:

- Domain logic.
- Parsers.
- State transitions.
- Combinators.
- Decision functions.

It avoids:

- I/O.
- Hidden dependencies.
- Ambient time/randomness.
- Thrown expected failures.
- Framework-specific concerns.

The imperative shell:

- Parses untrusted input.
- Sequences effects.
- Calls the core with refined values.
- Classifies external failures into typed errors.
- Handles I/O, persistence, HTTP, queues, telemetry, time, and randomness.

Entrypoint adapters should be thin protocol translation layers. They parse protocol-specific input, invoke shared modules, and render protocol-specific output. Do not duplicate business rules in controllers/resolvers/CLI handlers.

Authorization belongs in shared application/domain policy, not duplicated in controllers. Entrypoints may authenticate and parse users/sessions/credentials, but shared modules should receive parsed authorization input such as `AdminUser`, `Session`, `Principal`, `DeployCredential`, or `CommandActor`.

## Workflows, Transactions, and Idempotency

Use ordinary function calls or database transactions for simple single-boundary operations.

Use a saga/durable workflow when the process needs:

- Retries.
- Compensation.
- Idempotency.
- Resumability.
- Timers.
- Human approval.
- Cross-service coordination.
- Multiple transaction boundaries.

Do not hold database transactions open across network calls or long-running operations.

Any command, job, or workflow step that may be retried needs an explicit idempotency strategy:

- Idempotency key.
- Natural unique constraint.
- Deduplication record.
- State-machine transition guard.
- Transactional outbox/inbox.

Retrying should not rely on "probably safe" side effects.

## Testing Standards

Prefer confidence-oriented tests:

1. End-to-end tests for critical user flows.
2. Integration tests through real seams.
3. Focused/property tests for pure domain modules.
4. Unit tests when they test meaningful behavior, not implementation details.

Never use `vi.mock` or `jest.mock` for module mocking. Use real seams:

- Constructor-injected interfaces/classes.
- Effect services/layers.
- Local database substitutes such as SQLite.
- In-memory adapters when behavior is simple.
- Fake external adapters when needed.

Prefer tests that assert observable behavior:

- Returned value/error.
- Persisted state.
- Emitted event/message.
- Rendered response.
- Sent email record in a fake/local adapter.

Avoid spy-driven tests like `expect(sendEmail).toHaveBeenCalledWith(...)` unless the interaction itself is the only observable behavior.

For persistence behavior, prefer SQLite/local DB-backed tests over hand-rolled in-memory fakes when SQL/schema/transaction behavior matters.

## Property Tests and Arbitraries

Use `fast-check` where properties are clearer than examples, especially for:

- Parsers/smart constructors.
- Branded/refined types.
- State machines.
- Serialization roundtrips.
- Normalization/idempotence.
- Lawful combinators.

Use arbitraries for mock/test data generation. Prefer exporting arbitraries near the domain module they support.

Tests should not bypass parsers, smart constructors, or invariants.

## TypeScript Strictness and Immutability

Use strict TypeScript settings where practical:

- `strict: true`.
- `noUncheckedIndexedAccess: true`.
- `exactOptionalPropertyTypes: true`.
- `noImplicitOverride: true`.
- `noFallthroughCasesInSwitch: true`.

Prefer immutable values:

```ts
type CreateUserInput = {
  readonly email: EmailAddress;
  readonly roles: ReadonlyArray<Role>;
};
```

Mutation is acceptable inside localized imperative shell code, performance-sensitive internals, builders, or adapters when hidden behind a precise interface.

## Casts, `any`, and Non-Null Assertions

Avoid:

- `any`.
- Non-null assertions (`!`).
- Casts with `as Type`.

`as const` is fine.

Rare exceptions are allowed for highly generic helpers, branding internals, interop boundaries, or combinators where TypeScript cannot express the invariant.

Any non-`as const` cast requires a Rust-like safety comment:

```ts
// SAFETY: TypeScript cannot express the brand. parseEmailAddress checked the normalized string before branding. Callers cannot construct EmailAddress except through this parser.
return normalized as EmailAddress;
```

Rare `any` also requires a targeted lint ignore and justification:

```ts
// oxlint-disable-next-line no-explicit-any -- SAFETY: This helper preserves arbitrary function parameters; TypeScript cannot express this variadic constraint without any.
type Fn = (...args: any[]) => unknown;
```

Do not use `!`. Branch, parse, or refine instead.

## Imports, Exports, and Files

Prefer direct imports from the file that owns the abstraction. Avoid barrel files or `index.ts` re-export layers by default.

For domain modules, namespace imports often preserve the module shape:

```ts
import * as EmailAddress from "./email-address";

EmailAddress.parse(input);
```

Use named imports for classes, prelude helpers, and focused shared helpers:

```ts
import { casesHandled } from "./prelude";
import { PasswordReset } from "./password-reset";
```

Use `import type` / `export type` for type-only imports and exports.

Export only what callers should use. Keep internal helpers unexported unless intentionally shared. Do not export internals just for tests.

Avoid TypeScript `namespace` unless there is a compelling interop reason.

Avoid vague files like `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts`.

Use precise names like `email-address.ts`, `billing-period.ts`, `string-case.ts`, `array.ts`, or `prelude.ts`.

`prelude.ts` is allowed for tiny ubiquitous generic helpers/types such as:

- `casesHandled`.
- `shouldNeverHappen`.
- `notYetImplemented`.
- `Redacted`.
- Common `Result` helpers.
- Broad type utilities.

Do not put domain/application policy in `prelude.ts`.

No arbitrary file-size limits. Prefer cohesion and discoverability over small files for their own sake. Split when a file has multiple unrelated reasons to change or callers must understand unrelated concepts.

## Comments and JSDoc

Comments should explain invariants, trade-offs, non-obvious domain rules, and safety justifications. Avoid comments that narrate obvious code.

Every exported function, class, method, constant, and usually exported type should have JSDoc.

Use standard JSDoc syntax:

```ts
/**
 * Parse an email address from untrusted input.
 *
 * @param input - The untrusted string to parse.
 * @returns A parsed email address, or `InvalidEmailAddress` when the input is invalid.
 */
export function parse(input: string): Result<EmailAddress, InvalidEmailAddress>;
```

Use `@throws` only for unrecoverable defects, framework-required behavior, or temporary `notYetImplemented` paths. Do not document expected typed errors as throws.

For complex exported object types, document fields when helpful.

## Configuration and Resources

Parse environment/config at startup or the earliest boundary into typed config with branded/redacted values where appropriate.

Do not read `process.env` throughout the app. Missing/invalid config is a startup failure with useful context.

Avoid top-level side effects except in true entrypoint/bootstrap files. Modules should not start servers, open connections, read env, register handlers, or perform I/O at import time.

Resource creation and cleanup should be explicit and owned by bootstrap/imperative shell code or Effect layers when using Effect.

Avoid mutable singletons/global state. Constants and pure lookup tables are fine. If a singleton is required by a framework/runtime, isolate it at the boundary.

Inject `Clock` / `Random` services into dependency-bearing modules. Pure domain functions may accept explicit `now` / random values.

## Quick Review Checklist

Before claiming TypeScript work is complete, check:

- Existing conventions were inspected for errors, schemas, tests, adapters, telemetry, and module layout.
- Existing domain modules/types were reused before creating new ones.
- Existing adapters/services were audited before creating new ones.
- Inputs are parsed at the edge and domain types are used internally.
- Core/application logic avoids raw DTOs, raw IDs, nullable bags, and accidental `Partial<T>` inputs.
- New expected failures are typed errors as values unless local conventions require otherwise.
- Observability/error mechanics are preserved.
- Tests use public interfaces and real seams.
- `fast-check` arbitraries are used when property tests are clearer than examples.
- Exported symbols have useful JSDoc.
- Meaningful new adapters/services have ADRs after the adapter reuse audit.
