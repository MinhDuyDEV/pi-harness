---
name: verification-gates
description: >
  Use when running pre-merge or pre-PR verification checks. Detects project type and runs appropriate build, test, lint, and typecheck commands.
version: 1.0.0
tags: [verification, testing, lint, typecheck, ci]
---

# Verification Gates

Detect project type and run the appropriate verification commands before merging or creating PRs.

## When to Use

- In `/pr` before creating a pull request
- In `/review-codebase` during automated checks phase
- In `/ship` during final verification
- Any command that needs to verify code quality before completion

## When NOT to Use

- For incremental checks during development (just run the specific tool)
- When only one check type is needed (e.g., lint-only)

## Project Type Detection

| Project Type    | Detect Via                    | Build            | Test            | Lint                          | Typecheck                             |
| --------------- | ----------------------------- | ---------------- | --------------- | ----------------------------- | ------------------------------------- |
| Node/TypeScript | `package.json`                | `npm run build`  | `npm test`      | `npm run lint`                | `npm run typecheck` or `tsc --noEmit` |
| Rust            | `Cargo.toml`                  | `cargo build`    | `cargo test`    | `cargo clippy -- -D warnings` | (included in build)                   |
| Python          | `pyproject.toml` / `setup.py` | —                | `pytest`        | `ruff check .`                | `mypy .`                              |
| Go              | `go.mod`                      | `go build ./...` | `go test ./...` | `golangci-lint run`           | (included in build)                   |

## Protocol

### Step 1: Detect project type

Check for indicator files in the project root. Multiple types may coexist (e.g., Node + Python monorepo).

### Step 2: Run checks in parallel where possible

```bash
# Run typecheck and lint in parallel
npm run typecheck &
npm run lint &
wait

# Then run tests (may depend on build)
npm test
```

### Step 3: Report results

For each check, report:

- **Pass/Fail** status
- **Error count** (if failed)
- **Key error messages** (first 5)

### Step 4: Gate decision

- **All pass:** Proceed with the command
- **Any fail:** Stop and report. Let the user decide whether to proceed or fix.
