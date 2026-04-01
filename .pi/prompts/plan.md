---
description: Create detailed implementation plan with TDD steps for a bead
argument-hint: "<bead-id> [--create-beads] [--consensus] [--premortem]"
---

# Plan: $ARGUMENTS

Create a detailed implementation plan with TDD steps. Optional deep-planning between `/start` and `/ship`.

> **Workflow:** `/create` → `/start <id>` → **`/plan <id>`** (optional) → `/ship <id>`
>
> ⛔ Bead MUST be `in_progress` with `prd.md`. Use `/start` first.
>
> **When to use:** Complex tasks where PRD verification steps aren't enough guidance. Skip for simple tasks.

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "writing-plans" }); // TDD plan format
```

## Parse Arguments

| Argument         | Default  | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `<bead-id>`      | required | The bead to plan                                                   |
| `--create-beads` | false    | Create child beads for each phase                                  |
| `--consensus`    | false    | Force explicit options analysis + ADR before locking the plan       |
| `--premortem`    | false    | Force a pre-mortem section with likely failure modes and mitigations |

## Before You Plan

- **Be certain**: Only create tasks you're confident about
- **Don't over-plan**: If the PRD is clear, trust it
- **Budget context**: Target ~50% context per execution
- **Split signals**: Create child beads for complex work
- **Vertical slices**: Each task should cover one feature end-to-end
- **Clarify before planning**: If 2+ material ambiguities remain around scope, constraints, non-goals, or success criteria, stop and run `/clarify` before writing the final plan
- **Consensus is for branching/risky work**: Use `--consensus` for decisions with real trade-offs (auth, migrations, destructive ops, public API changes, architecture forks)

## Phase 0: Institutional Research (Mandatory)

Before touching the PRD or planning anything, load what the codebase already knows.

**This step is not optional.** Skipping it means planning in the dark.

### Step 1: Search institutional memory

```typescript
// Search for past decisions, patterns, gotchas related to this work
memory_search({ query: "<bead-title or feature keywords>", limit: 5 });
memory_search({ query: "<key technical concept from bead>", type: "bugfix", limit: 3 });
memory_read({ file: "handoffs/last" }); // Check last session context
```

If relevant observations found: incorporate them directly into the plan. Don't re-solve solved problems.

### Step 2: Mine git history

```bash
# What has changed recently in affected areas?
git log --oneline -20

# Who wrote the relevant code and when?
git log --oneline --follow -- <relevant-file-path>

# What patterns appear in recent commits?
git log --oneline --all | head -30
```

Look for:

- Commit conventions (how this team names things)
- Recent changes to files you'll touch (merge conflict risk)
- How similar features were implemented before
- Any "fix:", "revert:", "hotfix:" commits near your scope (footgun zones)

### Step 3: Spawn learnings-researcher (if Level 2-3 work)

```typescript
task({
  subagent_type: "explore",
  description: "Search codebase for patterns related to this work",
  prompt: `Search the codebase for patterns, conventions, and existing implementations related to: [FEATURE].

  Run these searches:
  - grep for relevant function names and patterns
  - Find similar existing features
  - Check test patterns for this domain
  - Look for any TODO/FIXME comments in relevant files

  Return: existing patterns to follow, files to be aware of, and any gotchas.`,
});
```

**Only after completing Phase 0** do you proceed to planning. The research phases must use this context.

## Phase 1: Guards

```bash
br show $ARGUMENTS
ls .beads/artifacts/$ARGUMENTS/
```

Verify:

- Bead is `in_progress`
- `prd.md` exists
- If `plan.md` already exists, ask user: overwrite or skip?

## Phase 2: Discovery Assessment

Before research, determine discovery level based on PRD:

| Level | Scope                | When to Use                                                       | Action                                      |
| ----- | -------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| **0** | Skip                 | Pure internal work, existing patterns only (grep confirms)        | Skip research, proceed to decomposition     |
| **1** | Quick (2-5 min)      | Single known library, confirming syntax/version                   | `context7 resolve-library-id + query-docs`  |
| **2** | Standard (15-30 min) | Choosing between 2-3 options, new external integration            | Spawn `@scout` for research                 |
| **3** | Deep (1+ hour)       | Architectural decision, novel problem, multiple external services | Full research with parallel `@scout` agents |

**Depth indicators:**

- Level 2+: New library not in package.json, external API, "choose/select/evaluate"
- Level 3: "architecture/design/system", data modeling, auth design
- Force `--consensus` when there are 2+ viable technical approaches with materially different risk/cost profiles
- Force `--premortem` for migrations, destructive changes, security-sensitive work, or user-visible outage risk

**Decision:** Ask user to confirm or adjust:

```typescript
const suggestedLevel = assessDiscoveryLevel(prdContent);

question({
  questions: [
    {
      header: "Discovery Level",
      question: `Suggested: Level ${suggestedLevel} (${getLevelDescription(suggestedLevel)}). Proceed?`,
      options: [
        { label: `Yes, Level ${suggestedLevel} (Recommended)` },
        { label: "Lower (less research)", description: "If you know the patterns" },
        { label: "Higher (more research)", description: "If uncertain about approach" },
        { label: "Skip research", description: "I know the codebase" },
      ],
    },
  ],
});
```

## Phase 3: Research (if Level 1-3)

Read the PRD and extract tasks, success criteria, affected files, scope.

Spawn parallel agents to gather implementation context:

| Agent     | Purpose                                                              |
| --------- | -------------------------------------------------------------------- |
| `explore` | Codebase patterns, affected file structure, test patterns, conflicts |
| `scout`   | Best practices, common patterns, pitfalls                            |

## Phase 4: Goal-Backward Analysis

**Forward planning:** "What should we build?" → produces tasks
**Goal-backward:** "What must be TRUE for the goal to be achieved?" → produces requirements

### Step 1: Extract Goal from PRD

Take success criteria from PRD. Must be outcome-shaped, not task-shaped.

- Good: "Working chat interface" (outcome)
- Bad: "Build chat components" (task)

### Step 2: Derive Observable Truths

"What must be TRUE for this goal to be achieved?" List 3-7 truths from USER's perspective.

Example for "working chat interface":

- User can see existing messages
- User can type a new message
- User can send the message
- Sent message appears in the list
- Messages persist across page refresh

**Test:** Each truth verifiable by a human using the application.

### Step 3: Derive Required Artifacts

For each truth: "What must EXIST for this to be true?"

| Truth                          | Required Artifacts                                              |
| ------------------------------ | --------------------------------------------------------------- |
| User can see existing messages | Message list component, Messages state, API route, Message type |
| User can send a message        | Input component, Send handler, POST API                         |

**Test:** Each artifact = a specific file or database object.

### Step 4: Identify Key Links

"Where is this most likely to break?" Critical connections where breakage causes cascading failures.

| From      | To        | Via                 | Risk                                |
| --------- | --------- | ------------------- | ----------------------------------- |
| Input     | API       | `fetch` in onSubmit | Handler not wired                   |
| API       | Database  | `prisma.query`      | Query returns static, not DB result |
| Component | Real data | `useEffect` fetch   | Shows placeholder, not messages     |

### Phase 4B: Decision Framing (Consensus / High-Risk Mode)

When `--consensus` is set or the task has real architectural branching:

1. List **2-3 viable options** only — not fake alternatives
2. Compare each option on implementation cost, blast radius, testability, rollback path, and long-term maintenance
3. Recommend one option explicitly
4. Explain **why the other options were not chosen**
5. Write a short ADR block before task decomposition:
   - **Decision**
   - **Drivers**
   - **Alternatives considered**
   - **Consequences / follow-ups**
6. If the choice materially changes scope or future work, get user confirmation before finalizing the plan

When `--premortem` is set or the work is high-risk, add a **Pre-mortem** section with at least 3 failure modes and one mitigation per failure.

## Phase 5: Decompose with Context Budget

**Quality Degradation Rule:** Target ~50% context per execution. More plans, smaller scope = consistent quality.

| Task Complexity | Max Tasks | Context/Task | Total   |
| --------------- | --------- | ------------ | ------- |
| Simple (CRUD)   | 3         | ~10-15%      | ~30-45% |
| Complex (auth)  | 2         | ~20-30%      | ~40-50% |
| Very complex    | 1-2       | ~30-40%      | ~30-50% |

**Split signals (create child plans):**

- More than 3 tasks
- Multiple subsystems (DB + API + UI)
- Any task with >5 file modifications
- Checkpoint + implementation in same plan
- Discovery + implementation in same plan

Assess size to determine plan structure:

| Size          | Files     | Approach                                 |
| ------------- | --------- | ---------------------------------------- |
| S (1-3 files) | 2-4 tasks | Single plan, no phases                   |
| M (3-8 files) | 5-8 tasks | 2-3 phases                               |
| L (8+ files)  | 9+ tasks  | Create child beads with `--create-beads` |

## Phase 6: Dependency Graph & Wave Assignment

**For each task, record:**

- `needs`: What must exist before this runs
- `creates`: What this produces
- `has_checkpoint`: Requires user interaction?

**Example:**

```
Task A (User model): needs nothing, creates src/models/user.ts
Task B (User API): needs Task A, creates src/api/users.ts
Task C (User UI): needs Task B, creates src/components/UserList.tsx

Wave 1: A (independent)
Wave 2: B (depends on A)
Wave 3: C (depends on B)
```

**Wave assignment enables parallel execution in `/ship`.**

**Vertical slices preferred:** Each plan covers one feature end-to-end (model + API + UI)
**Avoid horizontal layers:** Don't create "all models" then "all APIs" then "all UI"

## Phase 7: Write Plan

Write `.beads/artifacts/$ARGUMENTS/plan.md` following the `writing-plans` skill format:

**Section inclusion rules:**
- Include `Options Considered` and `ADR` only when `--consensus` is set or the work has real branching trade-offs
- Include `Pre-mortem` only when `--premortem` is set or the work is high-risk
- Omit those sections entirely for straightforward plans

### Required Plan Header

```markdown
# [Feature] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use skill({ name: "executing-plans" }) to implement this plan task-by-task.

**Goal:** [Outcome-shaped goal from PRD]

**Discovery Level:** [0-3] - [Rationale]

**Context Budget:** [Estimated context usage, target ~50%]

---

## Must-Haves

### Observable Truths

(What must be TRUE for the goal to be achieved?)

1. [Truth 1]
2. [Truth 2]
3. [Truth 3]

### Required Artifacts

| Artifact         | Provides       | Path                  |
| ---------------- | -------------- | --------------------- |
| [File/component] | [What it does] | `src/path/to/file.ts` |

### Key Links

| From        | To    | Via     | Risk           |
| ----------- | ----- | ------- | -------------- |
| [Component] | [API] | `fetch` | [Failure mode] |

## Options Considered (required for `--consensus` or branching work)

| Option | Pros | Cons | Why chosen / rejected |
| ------ | ---- | ---- | --------------------- |
| A      |      |      |                       |
| B      |      |      |                       |

## ADR (required for `--consensus` or branching work)

- **Decision:** [chosen path]
- **Drivers:** [top reasons]
- **Alternatives considered:** [options reviewed]
- **Consequences:** [trade-offs, follow-ups, rollback notes]

## Pre-mortem (required for `--premortem` or high-risk work)

1. **Failure mode:** [what breaks]
   - Mitigation: [how to prevent / detect]
2. **Failure mode:** [what breaks]
   - Mitigation: [how to prevent / detect]
3. **Failure mode:** [what breaks]
   - Mitigation: [how to prevent / detect]

## Dependency Graph
```

Task A: needs nothing, creates src/models/X.ts
Task B: needs Task A, creates src/api/X.ts
Task C: needs Task B, has_checkpoint, creates src/components/X.tsx

Wave 1: A
Wave 2: B
Wave 3: C

```

## Tasks
```

### Task Standards:

- **Exact file paths** — never "add to the relevant file"
- **Complete code** — never "add validation logic here"
- **Exact commands with expected output**
- **TDD order** — test first, then implementation
- **Each step is 2-5 minutes** — one action per step
- **Tasks map to PRD tasks**

## Phase 8: Create Child Beads (if --create-beads or L size)

For large work, create child beads for each plan phase:

```bash
CHILD=$(br create "[Phase title]" --type task --json | jq -r '.id')
br dep add $CHILD $ARGUMENTS
```

## Phase 9: Report

Output:

1. **Discovery Level:** [0-3] with rationale
2. **Must-Haves:** [N] observable truths, [M] required artifacts, [K] key links
3. **Context Budget:** [Estimated usage]
4. **Dependency Waves:** [N] waves for parallel execution
5. **Task count:** [N] tasks, [M] TDD steps
6. **Files affected:** [List]
7. **Decision record:** options table + ADR included only when branching/risky
8. **Plan location:** `.beads/artifacts/$ARGUMENTS/plan.md`
9. **Child bead hierarchy:** (if created)
10. **Next step:** `/ship $ARGUMENTS` or `/clarify $ARGUMENTS` if ambiguity remains

```bash
br comments add $ARGUMENTS "Created plan.md: Level [N] discovery, [X] waves, [Y] tasks, [Z] TDD steps"
```

## Related Commands

| Need              | Command         |
| ----------------- | --------------- |
| Create spec       | `/create`       |
| Clarify scope     | `/clarify <id>` |
| Start working     | `/start <id>`   |
| Execute plan      | `/ship <id>`    |
| Research first    | `/research`     |
