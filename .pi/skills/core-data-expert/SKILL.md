---
name: core-data-expert
description: >-
  Guides Core Data work on iOS/macOS — fetch requests with predicates, batch operations, migrations,
  merge policies, threading, CloudKit sync — with detailed reference docs per topic. User-invoked:
  load via /skill:core-data-expert when writing or debugging Core Data code, planning schema changes,
  or fixing slow fetches and Core Data crashes.
metadata:
  version: 1.0.0
  tags:
  - apple
  - integration
  dependencies: []
disable-model-invocation: true
---

# Core Data Expert

## Iron Laws

<EXTREMELY-IMPORTANT>
- **Reads use `NSFetchRequest` with `predicate`.** No filtering in Swift after fetch.
- **Writes batch operations when possible.** `NSBatchInsertRequest`, `NSBatchUpdateRequest` — not one-by-one saves.
- **Migrations via lightweight / staged.** No custom mapping models unless absolutely necessary.
- **Merge conflicts are your own fault.** Resolve at the save, not at the conflict handler.
- **No Core Data operations on the main queue for batch work.** Use `NSManagedObjectContext`'s `perform` or performBackgroundTask.
</EXTREMELY-IMPORTANT>

## When to Use

Writing Core Data code; fetch performance; migration; merge conflicts; threading; CloudKit sync; "the database is slow"; "I got a Core Data crash".

## Fetch Request Pattern

```swift
let request = User.fetchRequest()
request.predicate = NSPredicate(format: "email == %@", email)
request.sortDescriptors = [NSSortDescriptor(keyPath: \User.name, ascending: true)]
request.fetchLimit = 10
let results = try context.fetch(request)
```

Always use `predicate` (no post-fetch filtering). Use `fetchLimit` and `fetchBatchSize` for large results.

## Migration Types

| Type | Use | When |
|---|---|---|
| Lightweight | Add attribute, optional → non-optional | Most schema changes |
| Mapping model | Rename, transform, split | Complex changes |
| Staged | Multiple lightweight in sequence | Versioned deployments |

Lightweight is best. Keep schemas simple to avoid complex migrations.

## Merge Conflict Handler

```swift
let mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
context.mergePolicy = mergePolicy
```

Set on the context. `NSMergeByPropertyStoreTrumpMergePolicy` = DB wins. `NSMergeByPropertyObjectTrumpMergePolicy` = in-memory wins.

## References

Deep dives live in `references/`; read the matching file before non-trivial work:

- `stack-setup.md`, `model-configuration.md` — container setup, entity/attribute configuration
- `fetch-requests.md`, `performance.md` — predicates, batching, indexes, slow-fetch diagnosis
- `saving.md`, `batch-operations.md` — save patterns, `NSBatchInsertRequest`/`NSBatchUpdateRequest`
- `concurrency.md`, `threading.md` — context confinement, `perform`, background work
- `migration.md` — lightweight/staged/mapping-model migrations
- `persistent-history.md` — change tracking across contexts, extensions, batch ops
- `cloudkit-integration.md` — `NSPersistentCloudKitContainer` sync, merge policy setup
- `testing.md`, `project-audit.md`, `glossary.md` — test setup, audit checklist, terms

## Red Flags

Filtering in Swift after fetch (no predicate); fetch without limit/batch size; 1000+ rows fetched; one-by-one inserts (use batch requests); migration shipped without testing; main-thread fetches for batch data; no `performBackgroundTask`; `NSManagedObject` passed across threads; merge conflicts unhandled; "Core Data is slow" (you likely need an index); "I'll fix the slow fetch later" (do it now).
