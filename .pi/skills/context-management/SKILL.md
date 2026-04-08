---
name: context-management
description: Unified protocol for context health and session lifecycle management using DCP tools, thresholds, handoff, resume workflows, and post-compaction restoration.
version: 3.0.0
tags: [context, workflow, session]
dependencies: []
---

# Context Management

> Unified protocol for context health across start, active execution, compression, restoration, handoff, and resume.

Use this skill to keep context high-signal while preserving edit safety and execution continuity.

## When to Use

- Context is growing and signal quality is dropping
- A phase is complete and should be compressed
- You are preparing `/handoff` or resuming prior work
- You need deterministic restoration after compaction
- You need reusable summary templates for exploration/implementation/debugging

## Core Principle

Prefer **phase-level context hygiene** over emergency cleanup.

```text
compress > sweep > handoff
```

- **compress**: shrink closed chapters while preserving decisions
- **sweep**: remove stale/noisy residue from closed chapters
- **handoff**: reset in a fresh session when compression is insufficient

## DCP Command Usage

### `/dcp context`

Run at session start and major boundaries to detect pressure early.

### `/dcp compress`

Primary action for completed chapters.

Use when:

- exploration has stable conclusions
- implementation wave is complete and verified
- review output has been synthesized

### `/dcp sweep`

Secondary cleanup after chapter closure.

Sweep candidates:

- wrong-target searches
- superseded logs
- duplicate tool output
- dead-end exploration replaced by synthesis
- large terminal dumps no longer needed

Do not sweep active material needed for immediate edits.

## Session Lifecycle Protocol

### 1) Start Session

1. Load task + essential policy docs only
2. Run `/dcp context`
3. Rehydrate prior state only if needed:
   - `find_sessions({ query })`
   - `read_session({ session_id, focus })`
   - `memory-search({ query })` / `memory-read({ file })`
4. Verify git position before edits

### 2) During Active Work

- Keep active file outputs readable until edit + verification finish
- Reclassify context at boundaries: active vs closed
- Compress closed chapters before opening a new major chapter
- Sweep only after synthesis exists

### 3) Pre-Handoff / Closeout

1. Compress closed phases
2. Sweep stale/noisy residue
3. Persist decisions/learnings to memory
4. Write concise handoff (changed, pending, risks)

### 4) Resume Session

1. Rehydrate only relevant context
2. Validate assumptions against files + git state
3. Continue with fresh budget and explicit priorities

## Context Budget Thresholds

| Threshold | Interpretation  | Required Action                    |
| --------- | --------------- | ---------------------------------- |
| <50k      | Healthy start   | Keep inputs minimal                |
| 50k-100k  | Moderate growth | Compress completed phases          |
| >100k     | High pressure   | Aggressive compress + `/dcp sweep` |
| >150k     | Near capacity   | Handoff + resume fresh session     |

Guardrails: ~70% consolidate closed exploration, ~85% schedule handoff, ~95% immediate cleanup/restart.

## Phase Boundary Triggers

Compress at these boundaries:

- Research complete -> compress exploration/search output
- Implementation wave complete -> compress read/edit/test cycle output
- Review complete -> compress raw reviewer output; keep synthesis
- Pre-handoff -> compress non-essential context since last checkpoint

Rule: **Closed phases should not remain uncompressed for long.**

## Compaction Decision Tree

Use this before each cleanup action.

```text
Is context pressure increasing materially?
├── NO
│   └── Continue work; reassess at next phase boundary
└── YES
    ├── Is there a completed phase with stable conclusions?
    │   ├── YES -> /dcp compress completed range
    │   └── NO
    │       ├── Is growth mostly stale/noisy closed-phase output?
    │       │   ├── YES -> /dcp sweep
    │       │   └── NO
    │       │       ├── Is most remaining context still active/relevant?
    │       │       │   ├── YES -> Prepare handoff + resume fresh session
    │       │       │   └── NO -> Reclassify content, then compress/sweep
    │       └── If uncertain, preserve active content until closure
```

## Custom Summarization Templates

Use these templates to keep summaries dense and recoverable.

### A) Code Exploration Template

```markdown
## Exploration Summary: [Component/Module]

### Objective

- [What was investigated]

### Architecture Map

- Entry points: `path/to/entry.ts`
- Core modules: `A`, `B`, `C`
- Data flow: [input -> transform -> output]
- Dependencies/services: [list]

### Verified Findings

- [Finding with evidence]
- [Finding with evidence]
- [Finding with evidence]

### Constraints

- [Technical/policy/runtime constraints]

### Decisions

- [Decision] -> [Rationale]
- [Decision] -> [Rationale]

### Next Step

- [Immediate next action]
```

### B) Implementation Template

```markdown
## Implementation Summary: [Feature/Fix]

### Scope

- [What this wave covered]

### Completed

- [x] `path/to/file.ts` -> [change]
- [x] `path/to/file.test.ts` -> [coverage]
- [x] [other completed work]

### Verification Evidence

- Typecheck: [command + result]
- Lint: [command + result]
- Tests: [command + result]

### Remaining

- [ ] [pending item]
- [ ] [pending item]

### Key Decisions

- [Decision + reason]
- [Decision + reason]

### Resume Anchor

- Resume from: `path/to/file.ts` [function/region]
```

### C) Debugging Template

```markdown
## Debug Summary: [Issue]

### Symptoms

- Error: [exact error]
- Trigger: [request/action]
- Location: `path:line`

### Root Cause

- [causal chain with evidence]

### Fix Applied

- `path/to/file.ts` -> [exact fix]
- `path/to/test.ts` -> [new/updated coverage]

### Verification

- [test command + result]
- [manual check + result]

### Next Step

- [if unresolved, next investigation/fix]
```

## DCP Plugin Integration

This project uses `@tarquinen/opencode-dcp` via `experimental.chat.system.transform`.

### DCP Responsibilities (Always On)

- context budget monitoring + threshold cues
- `/dcp` command surface (`context`, `compress`, `sweep`, `stats`)
- prunable-tools guidance + token-aware nudges
- critical-limit warnings

### Context-Management Responsibilities (This Skill)

- timing policy for compress/sweep/handoff
- summary quality and template selection
- post-compaction restoration protocol
- cross-session rehydration sequence

### Division of Responsibility

- **DCP plugin**: measures/surfaces pressure, exposes cleanup commands
- **context-management skill**: decides when to apply commands and how to preserve continuity

### Custom Prompt Overrides

Custom DCP prompts are enabled (`experimental.customPrompts: true`).

Override precedence:

1. `.opencode/dcp-prompts/overrides/` (project)
2. config directory overrides
3. `~/.config/opencode/dcp-prompts/overrides/` (global)

Key file: `compress-message.md` (structured compression schema). Recommended blocks: Primary Request, Key Technical Concepts, Files/Code, Errors/Fixes, Problem Solving, User Messages, Pending Tasks, Current Work, Next Step.

## Post-Compaction Restoration Protocol (Critical)

After any compaction (server-side or `/dcp compress`), execute all 5 steps before editing.

### Step 1 — Re-read Active Files (max 5)

Re-read files active before compaction.

- prioritize most recent edits first
- cap at 5 files
- use targeted reads (`offset`/`limit`) for precision

Example:

```text
read({ filePath: "src/auth.ts", offset: 30, limit: 80 })
```

Why: restores exact local code context and satisfies read-before-edit safety requirements.

### Step 2 — Restore Active Skills

Reload any skills active before compaction.

```typescript
skill({ name: "<active-skill>" });
```

Why: skill instructions are prompt-injected and may be dropped by compaction.

### Step 3 — Reconcile Todo State

Rebuild exact task status:

- what was `in_progress`
- what remains `pending`
- what is `completed`

Why: prevents duplicate work and missed subtasks.

### Step 4 — Verify Git Position

```bash
git branch --show-current
git status --short
```

Why: confirms branch correctness and re-anchors uncommitted file state.

### Step 5 — Scan Memory / Session Artifacts

If compaction was heavy, recover nuance using:

- `memory-search({ query, limit: 3 })`
- `memory-read({ file })`
- `find_sessions({ query, limit })`
- `read_session({ session_id, focus })`

Why: restores rationale/constraints often missing from short summaries.

### Restoration Exit Criteria

Do not resume edits until active targets are re-read, required skills are reloaded, todo state is reconciled, git position is confirmed, and critical rationale is recovered when needed.

## Context Transfer Sources (Cross-Session)

Use in priority order:

1. Memory artifacts (`memory-search`, `memory-read`, observations)
2. Session history (`find_sessions`, `read_session`)
3. Task tracker state (`br show <id>`)
4. Git evidence (`git diff`, `git log`, test output)

Carry forward decisions, constraints, and next actions — not transcript bulk.

## Anti-Patterns

| Anti-Pattern                          | Why It Hurts                           | Correct Pattern                                |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Compressing active edit context       | Loses exact data needed for safe edits | Keep active outputs until edit+verify complete |
| Sweeping still-live content           | Causes rework and precision loss       | Sweep only stale/noisy closed-phase outputs    |
| Leaving closed phases uncompressed    | Context bloat degrades later turns     | Compress at each phase boundary                |
| Handoff without memory persistence    | Next session loses rationale           | Persist decisions before handoff               |
| Skipping restoration after compaction | Edit failures, skill drift, task drift | Run 5-step restoration before resuming         |

## Verification

Before claiming context cleanup complete, verify:

- active edit targets are still readable
- closed chapters are compressed or intentionally retained
- no critical decision exists only in transient output
- restoration protocol completed after compaction
- handoff includes next actions and blockers

## Quick Playbook

```text
1) /dcp context
2) classify context: active vs closed
3) /dcp compress on closed chapters
4) /dcp sweep stale/noisy closed outputs
5) if compaction happened: run 5-step restoration
6) persist key decisions to memory
7) handoff/resume with focused rehydration
```

## See Also

- `memory-system`
