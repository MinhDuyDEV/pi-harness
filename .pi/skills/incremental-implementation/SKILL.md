---
name: incremental-implementation
description: Use when implementing any feature, refactor, or change touching more than one file, or when tempted to write
  a large patch before testing.
metadata:
  version: 1.0.0
  tags:
  - workflow
  - implementation
  - safety
  dependencies:
  - verification-before-completion
---

# Incremental Implementation

## Core Principle

**Smallest working change, scoped to known territory.** For novel / design-heavy / unclear work the smallest change is wrong — prototype, show variants, interview, or blindspot-pass *before* editing. No speculative abstractions, no error handling for impossible scenarios.

**Rule of smallest:** if you cannot describe the next test in one sentence, you are about to write a large patch. Stop and break it down.

## The Slice Loop

```
1. [step]  ──>  verify: [check]  ──>  next step or done
```

Name the **success check before implementing**, then verify after. A "step" is the smallest unit that produces evidence: a test that runs, a function that returns, a command that exits 0.

## Workflow

1. **Pre-flight** — for novel work: blindspot pass → 2–4 cheap variants → interview (one question) → point at a reference. First edit should be obvious.
2. **Slice** — pick the smallest next behavior. Skeleton first, one path through the layers.
3. **RED** — write the failing test *first* (per `test-driven-development`). If you can't write a failing test, you don't know what you're building.
4. **GREEN** — minimum code to pass. Duplication > one line? Stop, finish the slice, then extract.
5. **REFACTOR** — close loopholes: name things better, remove seams, keep tests green. No new behavior.
6. **Verify** — run the named check (typecheck, lint, test, build, probe). Record the result.

## Deferred Work

For work that is correctly out of scope for the current slice, leave `TODO(handle): what, on-or-after <date>` at every call site. `Handle` makes it greppable; `on-or-after <date>` makes it automatable; placement warns unrelated agents it's a real seam, not a typo. Format: `// TODO(handle): wire metric emit once feature flag is in. on-or-after 2026-09-01`

## Self-Quiz Before "Done"

Can I name what changed and why in one sentence? Did I run the named verification command and see it pass? Did I leave `TODO(handle)` markers for unrequested scope? Did I update `TODO.md` / `PROGRESS.md`? Are there unrelated changes in the diff? If yes to the last, split them out before claiming done.

## Red Flags

Large patch (>~100 lines) without intermediate test runs; "I'll add tests later" (there is no later — write the test now or don't write the code); refactor step adds behavior (split it out); step verification is "looks right" instead of a concrete command; multiple unrelated fixes in one commit (split or open a new TODO); `TODO(handle)` markers without `on-or-after <date>` (automatable cost lost).

## Anti-Patterns

Big-bang patch (write everything, test at the end); premature abstraction (DRYing two call sites when one is speculative); hero commit (15 files, 3 features, 1 PR); "verify by inspection" (read carefully, *believe* it works — run the check).

## Anti-rationalization

| Shortcut the model reaches for | Why it fails here |
|---|---|
| "I can see the whole change, I'll write it all" | Seeing it ≠ it working; the slice loop tests each slice because integration bugs hide in interactions. |
| "Testing after I finish is faster" | Testing-after finds the bug somewhere in the whole patch; testing-each-slice finds it in the last 20 lines. |
| "One more file and I'm done" | "One more" is how a slice becomes a patch; ship the slice, start the next. |

## Skill Result Contract

```xml
<skill_result>
  <skill>incremental-implementation</skill>
  <status>success|partial|blocked|failure</status>
  <evidence>Slices named, named verification command run green, self-quiz passed</evidence>
  <artifacts>Files touched, tests added, TODO(handle) markers placed</artifacts>
  <risks>Untested code paths, deferred work, unrelated changes, or none</risks>
</skill_result>
```
