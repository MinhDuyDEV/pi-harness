---
name: diagnostics
description: Use when checking for code errors, type issues, or lint warnings after making changes, before committing, or when troubleshooting build failures
---

# Diagnostics

The `diagnostics` tool runs project diagnostics and returns structured results. The extension also auto-injects language diagnostics after `write`/`edit` (debounced).

## When to Use

- After making code changes (especially TypeScript/JavaScript)
- Before committing or creating PRs
- When the user reports build/type errors
- When troubleshooting why code doesn't compile
- After non-trivial TS/JS work: prefer `scope: "changed"` before claiming done

## Tool parameters

| Parameter | Default | Notes |
|-----------|---------|--------|
| `scope` | `full` | `changed` runs Fallow `check-changed` (git diff since `changedSince`) instead of health + dead-code |
| `changedSince` | `PI_DIAGNOSTICS_CHANGED_SINCE` or `main` | Git ref for Fallow |
| `languages` | all detected | e.g. `["typescript"]`, `["rust"]` |
| `includeFallow` | `true` if `tsconfig.json` | TS/JS quality |
| `includeAislop` | `true` unless env skips | Full-project aislop scan |
| `file` | — | Only language runners matching this file's extension |

Example (agent):

```json
{
  "scope": "changed",
  "languages": ["typescript"],
  "includeAislop": false
}
```

## What It Detects

| Language | Marker | Tool |
|----------|--------|------|
| TypeScript/JS | `tsconfig.json` | `tsc --noEmit` |
| Rust | `Cargo.toml` | `cargo check` |
| Go | `go.mod` | `go vet ./...` |
| Python | `pyproject.toml` / `setup.py` / etc. | `ruff check` or `mypy` |

### TypeScript/JS extras (explicit tool, when enabled)

- **Fallow** — `scope: full`: `health` + `dead-code` (JSON, human summary). `scope: changed`: root `check-changed`.
- **aislop** — full-project `aislop scan --json` (skipped by default when `PI_AISLOP_AUTO=true` or `PI_DIAGNOSTICS_SKIP_AISLOP=true`).

## Auto-injection

After `write`/`edit`:

- Runs **language runners** for the edited file's extension only (not full Fallow/aislop).
- Optional: `PI_DIAGNOSTICS_AUTO_FALLOW=true` runs debounced Fallow `check-changed` on TS/JS edits.
- Skips config/lockfiles and debounces 15s (`PI_DISABLE_AUTO_DIAGNOSTICS=true` disables).

## Environment

| Variable | Effect |
|----------|--------|
| `PI_DISABLE_AUTO_DIAGNOSTICS` | `true` — no auto-inject |
| `PI_DIAGNOSTICS_AUTO_FALLOW` | `true` — auto Fallow on TS/JS edits |
| `PI_DIAGNOSTICS_CHANGED_SINCE` | Default git ref (default `main`) |
| `PI_DIAGNOSTICS_TIMEOUT_MS` | Subprocess timeout (default 30000; Fallow uses same, suggest 60000 for large repos) |
| `PI_DIAGNOSTICS_SKIP_AISLOP` | `true` — default `includeAislop: false` |
| `PI_AISLOP_AUTO` | `true` — default `includeAislop: false` (per-file hook owns aislop) |
| `FALLOW_BIN` | Path to `fallow` CLI; else PATH, else `npx -y fallow` |
| `PI_DIAGNOSTICS_ROOT` | Force project root (absolute or relative to session cwd) |
| `PI_DIAGNOSTICS_ROOT_WALK` | Max parent directories to search for markers (default 6) |

## Output

- Human-readable `<diagnostics tool="...">` blocks in tool content (parsed in TUI by `renderResult`).
- `details`: `{ cwd, projectRoot, walkedUp?, scope, detectedLanguages, blocks: [...] }`. When session cwd is e.g. `.pi`, runners use parent `projectRoot` where `tsconfig.json` lives.
- Large Fallow/aislop text may truncate with a temp file path (Pi default line/byte limits).

## Workflow

1. Make code changes
2. Read auto-injected diagnostics if present
3. Call `diagnostics` with `scope: "changed"` for TS/JS quality gates
4. Fix reported issues
5. Re-run until clean

## Limitations

- Diagnostics are point-in-time; re-run after fixes
- Fallow requires installable `fallow` or npx
- Auto-inject does not replace explicit `diagnostics` before ship