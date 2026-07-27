---
name: swift-concurrency
description: >-
  Swift Concurrency patterns: async/await adoption, actor isolation, Sendable conformance, structured tasks, and
  Swift 6 migration. User-invoked: load via /skill:swift-concurrency when facing data races or thread-safety bugs,
  Sendable or actor-isolation compiler errors, MainActor warnings, async_without_await lints, or closure-to-async
  refactors.
metadata:
  version: 1.0.0
  tags:
  - apple
  - code-quality
  dependencies: []
disable-model-invocation: true
---

# Swift Concurrency

## Iron Laws

<EXTREMELY-IMPORTANT>
- **No shared mutable state without isolation.** Actor, MainActor, or @MainActor. Not "it's safe, I checked."
- **`Sendable` is the contract.** Types that cross actor boundaries must be `Sendable`. Compiler errors are correct, not pedantic.
- **No blocking on the main actor.** `URLSession` async, not `URLSession.shared.dataTask` (sync wrapping). The user feels every block.
- **No `Task { }` in a `View.body`.** Use `.task { }` modifier — it's lifecycle-bound and cancellable.
- **No "fire and forget" without `Task.detached` or `Task { @MainActor }` intent.** The actor the work runs on matters.
</EXTREMELY-IMPORTANT>

## When to Use

Adopting `async`/`await`; refactoring closures; data race bugs; Swift 6 migration; `Sendable` errors; `MainActor` warnings; new async APIs; concurrency review.

## When NOT to Use

Trivial sync code; one-shot op; "rewrite in async" without reason; legacy target (iOS < 13).

## Task Hierarchy

```
Task { ... }                  // unstructured
Task.detached { ... }          // detached, global executor
actor Foo { func() { ... } }   // actor's executor
@MainActor func() { ... }     // main actor
.task { await ... }            // structured, lifecycle-bound
TaskGroup { ... }              // structured, parallel
```

Pick the right one. `Task { }` in a class is rarely right.

## Actor Rules

| Pattern | Use |
|---|---|
| `actor Foo { }` | Shared state, mutated across contexts |
| `@MainActor Foo` | UI class; everything on main |
| `nonisolated func` | Doesn't access actor state |
| `isolated parameter` | Already on the actor |

Mark `final` and `Sendable` so the compiler can check.

## Sendable

```swift
struct User: Sendable {
  let id: UUID
  let name: String
}

class MutableState: @unchecked Sendable { /* AVOID */ }  // last resort
```

If not `Sendable`, you probably have a data race.

## References

Deep dives in `references/`: `async-await-basics.md`, `tasks.md`, `actors.md`, `sendable.md`, `threading.md`, `memory-management.md`, `async-sequences.md`, `async-algorithms.md`, `migration.md` (Swift 6), `testing.md`, `performance.md`, `linting.md`, `core-data.md`, `glossary.md`. Load the file matching the problem before answering hard isolation or migration questions.

## Common Patterns

```swift
// Network in a View
.task {
  do {
    self.user = try await api.fetchUser()
  } catch {
    self.error = error
  }
}

// Parallel
async let a = fetchA()
async let b = fetchB()
let result = try await (a, b)

// Cancellation-aware
.task(id: id) {
  // re-runs when id changes; previous is cancelled
}
```

## Red Flags

`Task { }` in `View.body` (use `.task`); `Task { }` capturing self; sync `URLSession` wrapping in async code; `await` on the main actor for network/IO (blocks UI); `@unchecked Sendable` to silence the compiler; ignoring `Sendable` warnings; mixed `DispatchQueue` + async; closures outliving their parent; "I checked, it's safe" without race analysis; `Task.detached` everywhere; no cancellation handling; `try?` to silence errors.
