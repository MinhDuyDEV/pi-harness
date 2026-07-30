---
description: Debug/fix bugs or refactor code — two tracks for improving code
argument-hint: <description of bug or path> [--refactor] [--scope minimal|moderate|aggressive]
---

# Fix: $ARGUMENTS

Two tracks for improving code without adding features:

- **Default (Bug Fix):** Systematically debug and fix a bug or failing test.
- **`--refactor`:** Improve code quality without changing external behavior.

## Load Skills

Load these available skills using the current session's skill-loading instructions. If no dedicated loader is exposed, read each skill's listed `SKILL.md` file.

- skill: `debugging-and-error-recovery`
- skill: `verification-before-completion`
- skill: `code-cleanup`
- skill: `improve-codebase-architecture`

## Determine Input Type

| Input | Detection | Track |
| --- | --- | --- |
| Bug/error description | `--refactor` not present | Bug Fix |
| File/directory path | `--refactor` present | Refactor |

---

# Track 1: Bug Fix (Default)

Optional: `--scope minimal|moderate|aggressive` (default: minimal for bug fixes). See scope table in Track 2 Phase 3.

### Phase 1: Reproduce

- Identify the failing behavior from the description
- Run the relevant test or command to reproduce the issue
- Capture the exact error output, stack trace, or symptom
- If the error cannot be reproduced, describe the environment assumptions and stop

### Phase 2: Isolate

- Search the codebase for the error message or symptom pattern
- Check recent changes: `git diff`, `git log --oneline -15`
- Trace backward from the error to find the source (symptom → root cause)
- Read the 2-4 most relevant files around the failure point
- **Distinguish symptom from root cause** — ask "what invariant would make this class of failure impossible?" before asking "how do I guard against this specific instance?"

### Phase 3: Fix

- Apply the behavioral kernel: surface assumptions before changing code, keep the fix to the smallest working slice, state what is explicitly out of scope, and name the proof path before editing
- Apply the minimal fix that addresses root cause (not symptoms)
- Prefer making the bad state structurally impossible over adding defensive guards
- Do not add speculative guards, tolerant readers, or defensive copies
- Auto-fix related issues found during investigation
- Stop and ask about architectural changes

### Phase 4: Verify

- Run the failing test or command — must pass
- Run related tests — must not regress
- Run typecheck / lint if applicable

If verification fails twice on the same approach, stop and escalate with learnings. Report what was tried, what failed, and what you recommend next.

### Output (Bug Fix)

1. **Root cause** (with file:line): What was wrong and why
2. **Fix applied** (with file:line): What changed
3. **Verification**: Command output proving the fix works
4. **What else was considered and rejected**: Alternative approaches and why they weren't chosen
5. **Related findings**: Any other issues found during investigation

---

# Track 2: Refactor (`--refactor`)

Improve code quality — clarity, performance, or maintainability — without changing external behavior.

### Phase 1: Assess

- Read the target code thoroughly
- Identify specific issues (duplication, complexity, naming, coupling)
- Check blast radius with `grep`/`rg`, caller reads, and tests before changing exports/signatures
- Run existing tests to establish baseline

### Phase 2: Plan

Present the refactoring plan before executing:

| Category | What | Why | Risk |
|----------|------|-----|------|
| ... | ... | ... | ... |

If this is a post-implementation simplification pass, follow `code-cleanup`:
- Lock behavior first
- Simplify only the changed files
- Rerun the same verification after each cleanup pass

Wait for user approval on the plan.

### Phase 3: Execute

Apply changes in small, verifiable steps:

1. Make one logical change
2. Run tests — must pass
3. Repeat

Scope levels (also usable on the default bug-fix track via `--scope`):

| Flag | Meaning | When to use |
| --- | --- | --- |
| `--scope minimal` | Smallest fix that works; name a lazier alternative in one line if one exists (≈ lite) | Default for tight diffs, hotfixes, YAGNI-friendly work |
| `--scope moderate` | Balanced — reasonable structure without cross-file rewrites (≈ full) | Default when `--scope` omitted on refactor track |
| `--scope aggressive` | Cross-file restructuring, interface changes allowed (≈ ultra) | Legacy cleanup, planned refactors with approval |

On the bug-fix track, `--scope minimal` applies the behavioral kernel: root-cause fix only, no speculative abstractions, no cleanup outside the failure class.

### Phase 4: Verify

- All existing tests pass
- Typecheck passes
- No behavior changes (same inputs → same outputs)
- Lint passes

### Output (Refactor)

1. **Scope**: Files and modules changed.
2. **Issues addressed**: Duplication, complexity, naming, coupling.
3. **Interface changes** (if any): Before/after signatures.
4. **Verification**: All gates pass.
5. **Blast radius**: Dependencies affected.
