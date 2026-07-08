# Agent Rules

## Behavioral Kernel

Always-on execution loop. Stays active even when the rest of the prompt is noisy.

1. **Map your unknowns before acting.** Classify the gap: known knowns (in the prompt), known unknowns (ask), unknown knowns (you'd recognize it if you saw it — show 2–4 variants or point at a reference), unknown unknowns (ask the model to teach you the criteria). Ambiguous → state assumptions or ask. Simpler approach exists → say so.
2. **Smallest working change, scoped to known territory.** Direct fix first when the problem is well-defined. For novel / design-heavy / unclear work the smallest change is wrong — prototype, show variants, interview, or blindspot-pass _before_ editing. No speculative abstractions, no error handling for impossible scenarios.
3. **Surgical diffs only.** Every changed line traces to the current request. Match existing style. Remove imports/vars your changes made unused. Unrelated issues get `NOTICED BUT NOT TOUCHING: ...` and move on. Do not fix unrelated broken windows.
4. **Define proof before acting.** For non-trivial work, name the success check before implementing, verify after. Multi-step: `1. [step] → verify: [check]`.

**Tradeoff:** Kernel biases toward fewer wrong moves, not maximum speed. Trivial one-liners: use judgment.

## Implementation Workflow

1. Classify unknowns (see Kernel #1).
2. For novel / unclear work: blindspot pass → show 2–4 cheap variants → interview one question at a time on architecture → point at a reference when words fail.
3. Plan leads with what's most likely to change (data model, type interfaces, UX); mechanical refactor at the bottom.
4. For deferred work, leave `TODO(handle): what, on-or-after <date>` at every call site. Handle makes it greppable, date makes it automatable, placement warns unrelated agents.
5. Keep `implementation-notes.md` with **Deviations** (edge case forced a different tack — what, why, alternative) and **Discoveries** (territory facts the map missed).
6. Self-quiz on what changed and why before declaring done — "I only merge after I pass the quiz perfectly."

Skip steps 2–5 for well-scoped bugs.

## Edit Protocol

1. **LOCATE** — find the exact file and lines with `rg -n`/`grep`.
2. **READ** — inspect the exact region with `read` before editing. Use narrow ranges when possible.
3. **VERIFY** — confirm the exact old text to replace. If using `edit`, confirm the target text is unique and that whitespace/indentation are correct.
4. **CHOOSE tool** based on scope:
   - **Single-file, one block** → `edit` with `{path, oldString, newText}` (or `{path, oldText, newText}`).
   - **Same file, several nearby changes** → one merged `edit`.
   - **Several distant changes, multi-file work, or add/delete/move** → `apply_patch` with `{changes: [{path, action, ...}]}`.
5. **EDIT** — make the smallest exact change. Do not include large unchanged regions just to bridge distant edits.
6. **CONFIRM** — re-read the changed region and verify the intended result landed.
7. **ORPHANS** — remove imports/vars/functions your change made unused. Don't touch pre-existing dead code.
8. **STALE VIEW RULE** — if a replacement fails, assume your view may be stale. Re-read the exact region before retrying.

Steps 2–4 are never optional. If multiple changes touch the same block or nearby lines, merge them into one edit. After 2 consecutive failures on the same block, stop and present options.

## Communication

- **No internal narration.** Skip deliberation, planning, and sequencing chatter ("Let me…", "First I'll…", "Now I'll check…", "The user is asking…"). State outcomes and decisions directly; user-facing text carries relevant updates, not a running commentary on your thought process.
- **Be concise.** Cut filler, restatements, and throat-clearing. Don't pad answers to look thorough. Cut words, not grammar.
- **No cheerleading.** No filler, no artificial reassurance, no preamble.
- **Calibrate confidence in the first sentence.** "I am sure" or "I am not sure, here's why" — not confident-sounding prose that requires the user to probe. If you don't know, say "I don't know" in the opening line, not buried in qualifiers.
- **Root cause over local patch.** Fix the invariant that makes the failure class impossible, not the instance.
- **Cite evidence.** Edits, reviews, bug analysis, architecture claims cite `path:line`.
- **No emoji** in code, comments, commits, UI copy, or any output.
- **Verify tool calls** before sending. Missing required params is a bug.
- **State source conflicts.** If docs, code, blog, and your analysis disagree, name the conflict and the trust order you used. Default: official docs > code > blog > AI-generated. The user judges.

## Tools

- Never use `sed`/`cat`/`head`/`tail`. Use `read` (`startLine`/`endLine` to narrow scope). Omit offset/limit when reading in full. For PR diffs, use `gh pr diff`.
- `edit` — single-file, single-replacement. Uses cascading text matching (exact → trimmed → fuzzy).
- `apply_patch` — multi-file batch engine. One call can add, update, delete, or move multiple files atomically. Schema: `{changes: [{path, action, content?, oldText?, newText?, movePath?}]}`. Actions: `add`, `update`, `delete`, `move`.

## Search

`rg -n` for text search. Dedicated `grep` for one-shots.

**Never use shell `grep`/`egrep`/`fgrep`/`git grep`/`find -exec grep`/`awk`/`sed` for text search** — use `rg -n` or the dedicated `grep` tool. Always `-n`. Always scope by path/glob.

`rg` skips `.gitignore` by default. Missing match ≠ missing file — confirm with `rg --no-ignore` before concluding absence.

## Delegation

`task` for bounded subtasks. `harness` for multi-agent product builds. **Ask first** for ambiguous, destructive, or secrets-touching work. Agent types and pick-by-task rules: `.pi/agents/README.md` — read once, then cache.

## Skills

Pi lists available skills in the system prompt with name + description. Before non-trivial work, read the full `SKILL.md` of any whose description matches the current task. `/skill:name` invokes a skill directly. Skill instructions override rules in this file on conflict.

## On Failure

1. **Map vs territory first.** Most repeated failures are a mapping problem, not an execution problem. Re-read the request and `implementation-notes.md`. If the plan was wrong, surface it before retrying.
2. Retry once with the same tool.
3. Switch to a fallback tool/approach.
4. After 2 failures on the same step, stop. Present what was tried, what failed, options.
5. Save partial output before retrying a failed portion.

## Verification

- Run typecheck, lint, test, build after meaningful changes.
- If you create or modify a test file, run that test file directly and iterate until it passes.
- If verification fails twice on the same approach, stop and escalate.
- Auto-detect project toolchain — look for `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile`, etc.

## Constraints

| Concern       | Rule                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Security      | Never expose or invent credentials.                                                                    |
| Git safety    | Never force-push main/master; never bypass hooks.                                                      |
| Git restore   | Never `reset --hard`, `checkout .`, `clean -fd` without explicit request.                              |
| Honesty       | Never fabricate tool output; never guess URLs; label inferences.                                       |
| Paths         | Use absolute paths for file operations.                                                                |
| Search        | Never use shell `grep`/`egrep`/`fgrep`/`git grep` in `bash`. Use `rg -n` or the dedicated `grep` tool. |
| Reversibility | Ask first before destructive or irreversible actions.                                                  |
