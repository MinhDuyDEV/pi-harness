---
description: Full autonomous chain - Plan → Ship → Review → Compound in one command
argument-hint: "<bead-id> [--skip-plan]"
---

# LFG (Let's Fucking Go): $ARGUMENTS

Full compound engineering cycle. One command, all four steps.

> **When to use:** You have a bead in `in_progress` state with a PRD. You want maximum autonomous execution with minimum hand-holding.
>
> **Checkpoints happen** at decision points. Everything automatable is automated.

## Parse Arguments

| Argument      | Default  | Description                             |
| ------------- | -------- | --------------------------------------- |
| `<bead-id>`   | required | The bead to execute                     |
| `--skip-plan` | false    | Skip planning if plan.md already exists |

## Phase 0: Preflight

```bash
br show $BEAD_ID
```

Read `.beads/artifacts/$BEAD_ID/` to check what artifacts exist.

Verify:

- Bead exists and is `in_progress`
- `prd.md` exists
- If `plan.md` exists and `--skip-plan` not set: ask user whether to replan or use existing

Report:

```
## LFG: <bead-id> — <title>

Cycle: Plan → Ship → Review → Compound
Review mode: [Standard 3-agent / Deep 5-agent]
Plan: [create new / use existing]
```

## Step 1: PLAN

Load and execute the `/plan` command for this bead:

```typescript
skill({ name: "writing-plans" });
// Run full /plan flow including Phase 0 institutional research
// Output: .beads/artifacts/$BEAD_ID/plan.md
```

Checkpoint if plan has major unknowns or architecture questions. Otherwise proceed automatically.

## Step 2: WORK

Execute the plan:

```typescript
skill({ name: "executing-plans" });
skill({ name: "reflection-checkpoints" }); // Phase transition + mid-point checks
// Load plan.md, execute wave-by-wave
// Per-task commits after each task passes verification
```

Follow the [Verification Protocol](../skill/verification-before-completion/references/VERIFICATION_PROTOCOL.md):

- Use **full mode** for final verification
- Use **incremental mode** between implementation waves

Checkpoint only at `checkpoint:human-verify` or `checkpoint:decision` tasks.

## Step 3: REVIEW

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git merge-base HEAD origin/main)
HEAD_SHA=$(git rev-parse HEAD)
```

Load and run the review skill:

```typescript
skill({ name: "requesting-code-review" });
```

Dispatch 5 specialized agents in parallel.

Wait for all agents to return. Synthesize findings.

**Auto-fix rule:**

- Critical issues → fix inline, re-verify, continue
- Important issues → fix inline, continue
- Minor issues → add to bead comments, continue

If Critical issues cannot be auto-fixed:

```
## CHECKPOINT: Review Blocker

Critical issue found that requires architectural decision:
[description]

Options:
1. [option A]
2. [option B]

Awaiting your decision before continuing.
```

## Step 4: COMPOUND

Load and run the compound command:

```typescript
// Run /compound $BEAD_ID
// Extract learnings from the full cycle
// Store observations to memory
// Suggest AGENTS.md updates if conventions changed
```

## Step 5: Report & Next

```
## LFG Complete: <bead-id>

### Cycle Summary

| Step     | Status | Notes                        |
|----------|--------|------------------------------|
| Plan     | ✓      | [N] waves, [M] tasks         |
| Work     | ✓      | [N] commits, [M] files       |
| Review   | ✓      | [N] agents, [M] fixes        |
| Compound | ✓      | [N] observations stored      |

### Learnings Captured
[list of observation titles]

### Verification
- typecheck: pass
- lint: pass
- tests: pass ([N] passing)

### Next Steps
- Review the changes: `git diff origin/main`
- Create PR: `/pr`
- Or continue with next bead: `/lfg <next-bead-id>`
```

## Swarm Mode (sLFG)

For large plans with 6+ independent tasks, run Work step in swarm mode:

```typescript
skill({ name: "swarm-coordination" });
// Dispatch parallel worker agents per wave
// Leader monitors and synthesizes
```

Use when: plan has 2+ independent waves with no shared file mutations.

## Related Commands

| Need            | Command          |
| --------------- | ---------------- |
| Plan only       | `/plan <id>`     |
| Ship only       | `/ship <id>`     |
| Review only     | `/review`        |
| Compound only   | `/compound <id>` |
| Create PR after | `/pr`            |
