---
description: Verify implementation completeness, correctness, and coherence
argument-hint: "<work-id|path> [--quick] [--full] [--fix] [--no-cache]"
agentType: reviewer
---

# Verify: $ARGUMENTS

Check implementation against a file-backed work spec or a specific path.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
skill({ name: "code-review-and-quality" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<work-id|path>` | required | Work directory under `.pi/artifacts/` or file/directory path |
| `--quick` | false | Gates only, skip coherence checks |
| `--full` | false | Force full verification mode |
| `--fix` | false | Run project auto-fix command if available |
| `--no-cache` | false | Bypass verification cache |

## Determine Input Type

| Input | Detection | Action |
| --- | --- | --- |
| Work ID | `.pi/artifacts/$ARGUMENTS/` exists | Verify implementation against `SPEC.md` and `PLAN.md` |
| Path | file/directory exists | Verify that path and related changes |
| Empty-like broad request | otherwise | Stop and ask for a work ID or path |

## Core Rules

- Only claim issues backed by tool output or file evidence.
- Run project-native gates when possible.
- Directly run any test file created or modified.
- Record fresh evidence before claiming pass.
- Do not update hidden trackers; write visible verification artifacts.

## Phase 0: Cache Check

Use a local cache under `.pi/artifacts/_VERIFY.log` only when not in `--full` or `--no-cache` mode.

```bash
CURRENT_STAMP=$(printf '%s\n%s' \
  "$(git rev-parse HEAD)" \
  "$(git diff HEAD)" \
  | shasum -a 256 | cut -d' ' -f1)
LAST_STAMP=$(tail -1 .pi/artifacts/_VERIFY.log 2>/dev/null | awk '{print $1}')
```

If the stamp matches and the user did not request fresh verification, report cached status clearly. Otherwise run gates.

## Phase 1: Gather Context

For a work ID:

```bash
WORK_DIR=.pi/artifacts/$ARGUMENTS
find "$WORK_DIR" -maxdepth 2 -type f | sort
```

Read available artifacts:

- `SPEC.md`
- `PLAN.md`
- `RESEARCH.md`
- `PROGRESS.md`
- `RUN-REPORT.md`

For a path, read the file(s), nearby tests, and current diff.

## Phase 2: Completeness

Extract requirements from `SPEC.md` or the user request.

For each requirement:

- Find code evidence (`file:line`).
- Mark complete, partial, missing, or not applicable.
- Note any behavior that is stubbed, unwired, or only superficially implemented.

## Phase 3: Correctness Gates

Follow `verification-before-completion`.

Detect toolchain first:

```bash
ls package.json Makefile justfile Cargo.toml pyproject.toml go.mod 2>/dev/null || true
```

Run appropriate gates:

| Gate | Examples |
| --- | --- |
| Typecheck | `npm run typecheck`, `tsc --noEmit`, `cargo check` |
| Lint | `npm run lint`, `ruff check`, `cargo clippy` |
| Test | `npm test`, targeted test commands, `cargo test` |
| Build | `npm run build`, `go build ./...` |

If `--fix` is present, run the project’s established auto-fix command only after reading scripts/config.

When gates pass, append:

```bash
mkdir -p .pi/artifacts
echo "$CURRENT_STAMP $(date -u +%Y-%m-%dT%H:%M:%SZ) PASS" >> .pi/artifacts/_VERIFY.log
```

## Phase 4: Coherence (Skip with `--quick`)

Cross-check:

- Spec vs implementation.
- Plan vs implementation.
- Research recommendations vs final approach.
- Changed files vs intended scope.

Flag contradictions with exact file references.

## Phase 5: Write Artifact

For a work ID, write `.pi/artifacts/$ARGUMENTS/VERIFICATION.md`:

```markdown
# Verification: $ARGUMENTS

## Result
READY / NEEDS WORK / BLOCKED

## Completeness
| Requirement | Status | Evidence |
| --- | --- | --- |

## Gates
| Command | Result | Evidence |
| --- | --- | --- |

## Coherence
- ...

## Blocking Issues
- ...
```

## Output

Report:

1. Result: READY / NEEDS WORK / BLOCKED.
2. Completeness score.
3. Gate commands and results.
4. Coherence findings.
5. Blocking issues and next step.

## Related Commands

| Need | Command |
| --- | --- |
| Ship after verify | `/ship <id>` |
| Review code | `/review-codebase` |
