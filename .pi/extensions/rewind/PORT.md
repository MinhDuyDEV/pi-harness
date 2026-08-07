# Port notes: pi-rewind-hook → pi-rewind 2.0

Forked from <https://github.com/nicobailon/pi-rewind-hook> (upstream snapshot: 2025-04-24) and maintained for the `@earendil-works/pi-coding-agent` SDK.

## Compatibility changes

| Change | Reason |
| --- | --- |
| Import from `@earendil-works/pi-coding-agent` | The original package scope is obsolete |
| Pin development against Pi `0.84.0` | Match this repository's tested runtime while leaving the host as a peer dependency |
| Return an unsubscribe function from the custom event-bus test mock | Match the current `EventBus` contract |
| Treat `parentSession` as `string \| null \| undefined` | Session JSONL headers may omit it or store `null` |
| Validate rewind custom-entry payloads before use | Older or malformed session lines must not corrupt reconstruction |
| Use an explicit `SessionLikeEntry` compatibility boundary | Pi does not expose a stable public session-entry union for this extension yet |

## 2026 modularization

The original single implementation file grew beyond 1,400 lines. It is now split without changing the user-facing event contract:

- `index.ts` — lifecycle wiring
- `events.ts` — turn/fork/tree handlers
- `core.ts` — shared types, validation, settings, and path helpers
- `store.ts` — git snapshot operations
- `ledger.ts` — session JSONL parsing and lineage lookup
- `retention.ts` — snapshot live-set policy

Focused ledger tests supplement the original integration suite. Restore failures are covered and cancel the affected navigation operation.

## Verification

```bash
node --import tsx --test index.test.ts ledger.test.ts
npm run typecheck:extensions
```

The repository-wide `npm run check` also exercises Pi resource loading, static quality gates, and all extension tests.

## Remaining boundary

Replace the local session-entry compatibility types with SDK exports only after Pi publishes a stable session entry union. Until then, the validation layer in `core.ts`/`ledger.ts` is deliberate.
