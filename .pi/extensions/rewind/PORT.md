# Port notes: pi-rewind-hook → pi-rewind 2.0

Forked from https://github.com/nicobailon/pi-rewind-hook (last upstream commit: 2025-04-24).

## What was wrong with the upstream code

- Imported from `@mariozechner/pi-coding-agent` (the old package scope; the
  package was renamed to `@earendil-works/pi-coding-agent`).
- Used local `SessionLikeEntry` types that were slightly too loose, so they
  were silently accepting any object as a session entry and bypassing the
  SDK's stricter nullability checks.
- Used a generic catch-all `{ type: string; [k: string]: unknown }` in
  the entry union, which broke narrowing on `entry.type === "message"` and
  similar discriminants — the test suite masked this because all tests
  built entry objects inline.
- Used `Awaited<ReturnType<typeof readdir>>` for the variable type, which
  includes `string[]` and `Buffer[]` overloads in addition to `Dirent[]`.
  The new `@types/node` is strict about this and refuses to let you call
  `entry.name` on a `Buffer`.
- `appendEntry(customType, data)` calls still work, but tests were using
  `Pick<ExtensionAPI, "exec" | "appendEntry" | "on" | "events">` which
  stopped satisfying the new `EventBus` type once `events.on` started
  returning `() => void` for unsubscribe.

## What this fork changes

| Change | Why |
| --- | --- |
| Bumped import to `@earendil-works/pi-coding-agent` | The old scope is dead |
| Pinned to `^0.79.0` (latest as of port) | Forward-compat for SDK 0.8x |
| Added `Dirent<string>` explicit type on `readdir` | `@types/node` 20 strictness |
| Added `as unknown as ExtensionAPI` to the test mock | Test mocks no longer satisfy the strict `Pick<>` for unrelated fields |
| `events.on` mock now returns the unsubscribe function | Match new `EventBus` contract |
| `events.on` mock now registers into the test's `eventHandlers` map | Same |
| `parentSession` typed as `string \| null \| undefined` everywhere | Header is JSONL-sourced and can be `null` for sessions without a parent |
| Local `SessionLikeMessageEntry.message` is optional | Defends against partial entries written by older SDK versions |
| `toTimestamp(undefined)` and `toTimestamp(string)` only | `Record<string, unknown>` access gives `unknown`, not `string` |
| `findLatestUserMessageEntry` returns `as SessionLikeMessageEntry` | Generic catch-all in the union widens the return type |
| `await parseSessionLedgerFile` returns `ParsedSessionLedger \| null` | The function may legitimately fail to read the file |

## What is intentionally unchanged

- All 1,400+ lines of rewind logic, retention policy, picker UI, file
  watcher, and rebase flow are byte-for-byte from upstream.
- The 752-line test suite is kept as-is. One pre-existing flaky test
  (`"silently restores files on session_before_tree"`) was failing
  before the port and is still failing after — it's an upstream test
  bug (the test calls `rewind:checkpoint-entry` with no payload, the
  source's handler validates and bails, so no checkpoint is created).
  Fixing it is out of scope for the port.

## Verification

```
tsc --noEmit -p tsconfig.json    → clean
tsx --test index.test.ts          → 11/12 pass (1 pre-existing upstream bug)
```

## Out of scope / future work

The upstream code is feature-complete. Real follow-ups would be:

1. Replace the local `SessionLikeEntry` mirror with an import from
   `@earendil-works/pi-coding-agent` once the SDK exports a stable
   `SessionEntry` union type publicly.
2. Add integration tests that load the extension via `createAgentSession`
   and drive `session_start` + `turn_end` against a real `pi` runtime.
3. Add `session_before_compact` and `session_before_fork` pre-snapshot
   hooks (the new SDK supports them and the upstream code does not).
