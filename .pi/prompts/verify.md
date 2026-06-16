---
description: Verify completeness, correctness, and quality — gates, tests, code review, UI review
argument-hint: "<work-id|path> [--quick] [--full] [--fix] [--no-cache] [--test] [--review] [--review --bloat] [--ui-review]"
agentType: reviewer
---

# Verify: $ARGUMENTS

Check implementation against spec, run gates, write tests, review code, and audit UI.

> Default mode: verify implementation completeness + correctness + coherence.
> Use flags to run specialized tracks: `--test`, `--review`, `--ui-review`.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
skill({ name: "code-review-and-quality" });
skill({ name: "test-driven-development" });
skill({ name: "testing-anti-patterns" });
skill({ name: "frontend-design" });
skill({ name: "accessibility-audit" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<work-id|path>` | required | Work directory under `.pi/artifacts/` or file/dir path |
| `--quick` | false | Gates only, skip completeness/coherence |
| `--full` | false | Force full verification mode (non-incremental) |
| `--fix` | false | Run project auto-fix command if available |
| `--no-cache` | false | Bypass verification cache |
| `--test` | false | Write tests for the target code (TDD) |
| `--review` | false | Manual code review of changed code |
| `--bloat` | false | With `--review`: Bloat Review mode — tagged delete-list only (`delete:`, `stdlib:`, `yagni:`, `shrink:`) |
| `--ui-review` | false | UI/UX quality audit (supports `--slop` subflag) |

## Determine Input Type

| Input | Detection | Action |
| --- | --- | --- |
| Work ID | `.pi/artifacts/$ARGUMENTS/` exists | Verify implementation against `SPEC.md` and `PLAN.md` |
| Path | file/directory exists | Verify that path and related changes |
| Empty-like | otherwise | Stop and ask for a work ID or path |

## Core Rules

- Only claim issues backed by tool output or file evidence.
- Run project-native gates when possible.
- Directly run any test file created or modified.
- Record fresh evidence before claiming pass.

## Phase 0: Cache Check

Before running gates, check if a recent verification is still valid.

```bash
CURRENT_STAMP=$(printf '%s\n%s' \
  "$(git rev-parse HEAD)" \
  "$(git diff HEAD)" \
  | shasum -a 256 | cut -d' ' -f1)
LAST_STAMP=$(tail -1 .pi/artifacts/_VERIFY.log 2>/dev/null | awk '{print $1}')
```

| Condition | Action |
|-----------|--------|
| `--no-cache` or `--full` | Skip cache — run fresh |
| `CURRENT_STAMP == LAST_STAMP` | Report **cached PASS**, skip to Phase 2 |
| No match or no cache | Run gates normally |

## Phase 1: Gather Context

For a work ID:

```bash
WORK_DIR=.pi/artifacts/$ARGUMENTS
find "$WORK_DIR" -maxdepth 2 -type f | sort
```

Read available artifacts in order:

1. `SPEC.md`, `PLAN.md`, `RESEARCH.md`, `PROGRESS.md`, `RUN-REPORT.md`

For a path, read the file(s), nearby tests, and current diff:

```bash
git status --short
git diff
```

---

## Default Track: Completeness + Correctness + Coherence

### Phase 2: Completeness

For work IDs with a `SPEC.md`: extract all requirements, tasks, and success criteria.

| Mark | Meaning |
| ---- | ------- |
| ✓ Complete | Code evidence found at file:line |
| ◐ Partial | Some evidence but not fully implemented |
| ✗ Missing | No code evidence |

Score: `[N]/[M] requirements met ([P]% complete)`

Flag stubs and unwired patterns:

- `return <ComponentName />` without props/handlers
- `onClick={() => {}}` — no-op
- `fetch(...)` without `.then()` or `await`
- `return null` — placeholder
- `// TODO` / `// FIXME` in changed code

### Phase 3: Correctness Gates

#### Mode Selection

| Mode | When | Behavior |
|------|------|----------|
| **Incremental** | <20 changed files | Lint + typecheck affected files |
| **Full** | `--full` or ≥20 files | Full teardown |

#### Execution

| Gate | Order |
|------|-------|
| Typecheck | Parallel |
| Lint | Parallel (with typecheck) |
| Test | Sequential (after lint+typecheck pass) |
| Build | Sequential (after test passes) |

```text
| Gate | Status | Mode | Time |
|------|--------|------|------|
| Typecheck | PASS | incr | 2.1s |
```

After all pass, record cache:

```bash
mkdir -p .pi/artifacts
echo "$CURRENT_STAMP $(date -u +%Y-%m-%dT%H:%M:%SZ) PASS" >> .pi/artifacts/_VERIFY.log
```

### Phase 4: Coherence (Skip with `--quick`)

- **Spec vs implementation**: Does code address all requirements?
- **Plan vs implementation**: Did execution follow the plan?
- **Research vs approach**: Is divergence justified?
- **Scope vs changes**: Drive-by changes?

---

## Specialized Tracks

### Track A: `--test` — Write Tests

Follow TDD (RED → GREEN → REFACTOR).

#### Phase T1: Analyze

- Read the target code to understand inputs, outputs, side effects, edge cases.
- Check for existing tests — don't duplicate.
- Determine test framework (vitest, jest, pytest, go test, etc.).

#### Phase T2: Plan Test Cases

| Case | Input | Expected | Edge? |
|------|-------|----------|-------|
| ... | ... | ... | ... |

Prioritize: happy path → error cases → edge cases → integration points.

#### Phase T3: Write Tests

1. **RED**: Write test first — run it — must fail.
2. **GREEN**: Implement minimal production change to pass.
3. **REFACTOR**: Clean up test code.

Anti-patterns to avoid:
- Don't test mock behavior — test real behavior.
- Don't add test-only methods to production code.
- Don't mock what you don't understand.
- Don't write tests that pass regardless of implementation.

#### Phase T4: Verify

```bash
[test-command] [test-file]
[test-command]  # full suite for regressions
```

---

### Track B: `--review` — Code Review

Manual review of changed code.

#### Phase R1: Scope

| Input | Scope |
| --- | --- |
| Path | That path only |
| Work ID | Implementation vs spec |
| No args | Recent/local changes |

#### Phase R1b: Bloat mode (`--review --bloat`)

Load `code-review-and-quality`, `fallow`, and `aislop`; follow **Bloat Review mode** in the skill (tags, one-line findings, net score). Run `git diff --stat`, `npx fallow health --changed-since main --format json`, and `npx aislop scan --changes --json` first. Do not apply fixes.

#### Phase R2: Automated Scan

Skip when `--bloat` is set (covered in Phase R1b).

Otherwise:

- Debug statements, loose typing, unjustified `@ts-ignore`/`as any`.
- `TODO`, `FIXME`, `HACK` in changed code.
- Hardcoded secrets or credentials.
- New dependencies without clear need.

#### Phase R3: Manual Review

Skip when `--bloat` is set (covered in Phase R1b).

Otherwise:

| Category | Focus |
| --- | --- |
| Correctness | Behavior matches spec and edge cases |
| Security | Auth checks, input validation, no secret exposure |
| Performance | Unbounded work, N+1 queries |
| Maintainability | Simplicity, naming, duplication |
| Error Handling | Useful context, safe user-facing errors |
| Testing | Changed behavior has meaningful tests |

#### Phase R4: Report

When `--bloat`: use Bloat Review output format from `code-review-and-quality` (tagged lines + net score).

Otherwise:

| Severity | Action |
| --- | --- |
| **Critical** | Must fix before merge |
| **Important** | Should fix or explicitly accept |
| **Minor** | Optional cleanup |

Each finding: file:line, issue, impact, recommended fix.

---

### Track C: `--ui-review` — UI/UX Audit

Two sub-modes:

- **Default:** General quality audit (typography, color, layout, interactivity, accessibility).
- **`--slop`:** Targeted anti-AI-slop audit (detect AI-generated UI patterns).

#### Phase U1: Input Parsing

Supports: path (image/screenshot/component), `--staged` (staged changes), `--since=<ref>` (changes since ref).

Skip to Phase U3 for `--slop` mode.

#### Phase U2: General UI Review

Score categories 1-10:

| Category | Evaluation |
| --- | --- |
| Typography | Hierarchy, readability, weight contrast |
| Color | Palette cohesion, contrast, semantic usage |
| Layout & Spacing | Visual hierarchy, consistency, white space |
| Interactive States | Hover, focus, active, disabled, loading |
| Accessibility | WCAG AA compliance |
| Visual Polish | Consistency, motion, shadows, icons |

#### Phase U3: Slop Mode (`--slop`)

Score each UI file 0-10:

| Score | Meaning |
| --- | --- |
| 0-3 | Clean — minimal AI artifacts |
| 4-6 | Moderate — cleanup needed |
| 7-8 | Heavy — should refactor |
| 9-10 | Critical — needs rewrite |

Categories to flag:
- Typography: `text-sm` on everything, no hierarchy
- Spacing: inconsistent gaps, missing padding containers
- Shadows: `shadow-lg`/`shadow-xl` everywhere, stacked shadows
- Rounded corners: `rounded-xl`/`rounded-2xl` as default
- Colors: blue-500 primary, gray-100 backgrounds
- Layout: nested flex containers, unnecessary wrappers

Red flags:
- Score > 7 without design justification
- Same pattern in 3+ files not extracted as component
- Mixed Tailwind + CSS modules + inline styles

---

## Phase 7: Write Verification Artifact

For a work ID, write `.pi/artifacts/$ARGUMENTS/VERIFICATION.md`:

```markdown
# Verification: $ARGUMENTS

**Date:** [timestamp]

## Result
READY TO SHIP / NEEDS WORK / BLOCKED

## Completeness (Default Track)
| Requirement | Status | Evidence |
|-------------|--------|----------|
| ... | ✓ | `src/file.ts:42` |

**Score:** N/M (P%)

## Gates
| Gate | Status | Mode | Evidence |
|------|--------|------|----------|
| Typecheck | PASS | incr | exit 0 |

## Test/Review/UI Tracks
...

## Blocking Issues
- ...
```

## Phase 8: Record Findings

```typescript
observation({
  type: "discovery",
  title: "Verify: [scope] [key finding]",
  narrative: "Verification of [scope]: [finding]. Impact: [description].",
  concepts: "verification, [component]",
  confidence: "high",
});
```

## Output

1. **Result**: READY TO SHIP / NEEDS WORK / BLOCKED
2. **Completeness**: N/M requirements met (default track)
3. **Gates**: Table with status, mode, time
4. **Test results** (if `--test`): Cases written, pass/fail
5. **Review findings** (if `--review`): By severity
6. **UI scores** (if `--ui-review`): Category scores or slop score
7. **Blocking issues**
8. **Next step**

## Related Commands

| Need | Command |
| --- | --- |
| Ship after verify | `/ship <id>` |
| Execute implementation | `/ship <id>` |
