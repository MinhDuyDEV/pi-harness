---
description: GSD-style one-command autonomous workflow (create → plan → ship → knowledge → PR)
argument-hint: '"<feature description>" [--type epic|feature|task|bug]'
---

# Auto: $ARGUMENTS

Run one opinionated autonomous flow from feature description to PR-ready output.

> **Example:** `/auto "build user authentication"`
>
> create bead → generate PRD → plan (research + dependency graph) → ship (Task DAG + auto-cascade) → export knowledge → offer PR

This command is intentionally opinionated:

- no option menus for normal flow
- full verification gates are always on
- stop only for hard blockers (dirty git, duplicate bead, failed gates, architecture decision)

## Load Skills

```typescript
skill({ name: "beads" });
skill({ name: "prd" });
skill({ name: "writing-plans" });
skill({ name: "verification-before-completion" });
skill({ name: "requesting-code-review" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<feature description>` | required | The feature/fix outcome to build |
| `--type` | `feature` | Optional bead type override |

---

## Phase 0: Guard Rails (Mandatory)

Run first:

```bash
git status --porcelain
br list --status=open --status=in_progress
```

Hard-stop checks:

1. `$ARGUMENTS` is not empty
2. Git working tree is clean
3. No existing open/in-progress bead clearly matches this feature

If duplicate exists, stop and route to `/start <existing-id>`.

---

## Phase 1: Create + Claim Bead

Create bead directly via `br create`:

```bash
BEAD_TYPE="${TYPE:-feature}"
BEAD_JSON=$(br create "$ARGUMENTS" --type "$BEAD_TYPE" --json)
BEAD_ID=$(echo "$BEAD_JSON" | jq -r '.id')
mkdir -p ".beads/artifacts/$BEAD_ID"
br update "$BEAD_ID" --status in_progress
```

Generate `prd.md` using existing `/create` structure (no user branching):

- Problem Statement
- Scope (In/Out)
- Proposed Solution
- Success Criteria with `Verify:` commands
- Technical Context
- Affected Files
- Tasks with verification

Save to:

```bash
.beads/artifacts/$BEAD_ID/prd.md
```

### Verification Gate A (Create → Plan)

```bash
br show "$BEAD_ID"
test -f ".beads/artifacts/$BEAD_ID/prd.md"
```

Must be true:

- bead status is `in_progress`
- `prd.md` exists and has real content

---

## Phase 2: Internal `/plan` Workflow

Run `/plan` phase structure internally with defaults.

### 2.1 Institutional research (mandatory)

```typescript
memory_search({ query: "$ARGUMENTS", limit: 5 });
memory_search({ query: "$BEAD_ID", type: "all", limit: 10 });
```

```bash
git log --oneline -20
```

### 2.2 Discovery depth (opinionated)

- default Level 2
- downgrade to Level 0 only when clearly internal and pattern-known

### 2.3 Plan outputs

Write `.beads/artifacts/$BEAD_ID/plan.md` with:

- observable truths
- required artifacts (exact paths)
- key links (risk points)
- dependency graph (`needs` / `creates`)
- wave assignment
- TDD-first executable tasks

### Verification Gate B (Plan → Execute)

```bash
test -f ".beads/artifacts/$BEAD_ID/plan.md"
grep -q "## Must-Haves" ".beads/artifacts/$BEAD_ID/plan.md"
grep -q "## Dependency Graph" ".beads/artifacts/$BEAD_ID/plan.md"
grep -q "Wave" ".beads/artifacts/$BEAD_ID/plan.md"
```

Must be true before execution continues.

---

## Phase 3: Internal `/ship` Workflow with Auto-Cascade

Execute via task DAG using `TaskCreate` + `TaskExecute`.

### 3.1 Build DAG from `plan.md`

For each plan task:

```typescript
const t = TaskCreate({
  subject: "[task title from plan]",
  description: "[exact task instructions + files + verify commands]",
  agentType: "worker",
});
```

Wire dependencies from plan graph:

```typescript
TaskUpdate({ taskId: "<child-task-id>", addBlockedBy: ["<parent-task-id>"] });
```

### 3.2 Execute roots and auto-cascade

```typescript
TaskExecute({ task_ids: ["<all-root-task-ids>"] });
```

Monitor until all DAG tasks complete:

```typescript
TaskOutput({ task_id: "<task-id>", block: true, timeout: 600000 });
```

### 3.3 Ship verification + review (always)

Run full gates automatically (project-aware commands):

- build
- test
- lint
- typecheck

Then run structured review equivalent to `/ship` Phase 6:

```typescript
skill({ name: "requesting-code-review" });
```

```bash
BASE_SHA=$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
```

Review protocol (mandatory):

- run **5 parallel review agents** covering:
  1. security + correctness
  2. performance + architecture
  3. type-safety + tests
  4. conventions + patterns
  5. simplicity + completeness
- pass these placeholders to each agent:
  - `{WHAT_WAS_IMPLEMENTED}`: bead title + concise summary of implemented code changes
  - `{PLAN_OR_REQUIREMENTS}`: `.beads/artifacts/$BEAD_ID/prd.md`
  - `{BASE_SHA}` / `{HEAD_SHA}`: values computed above
- each agent reviews the implementation diff scoped to `{BASE_SHA}..{HEAD_SHA}`
- wait for all 5 agents to return
- synthesize findings into exactly three categories: **critical**, **important**, **minor**

Auto-fix rules:

- critical findings: fix inline, rerun full gates (build/test/lint/typecheck + PRD `Verify:` commands), then continue
- important findings: fix inline, rerun impacted gates, then continue
- minor findings: record in bead comments and note for `/compound` follow-up, then continue
- if any critical finding requires an architectural decision, stop and ask user

### Verification Gate C (Execute → Knowledge)

Continue only when all are true:

1. all DAG tasks `completed`
2. build/test/lint/typecheck pass
3. no unresolved critical review findings

Then close bead:

```bash
br close "$BEAD_ID" --reason "AUTO: shipped with full gates and review"
```

---

## Phase 4: Knowledge Export (Inline, no nested prompt)

Do **not** call `/knowledge` as a sub-command. Execute the knowledge export logic inline.

### 4.1 Fetch bead-scoped observations from memory tools

Use `memory-search` to discover observation IDs, then `memory-get` to hydrate full records:

```typescript
const TYPES = ["decision", "pattern", "learning", "warning", "bugfix"] as const;
const idsByType: Record<string, number[]> = {};

for (const t of TYPES) {
  const rows = await memory-search({ query: "$BEAD_ID", type: t, limit: 100 });

  idsByType[t] = (rows || [])
    .filter((row) => {
      const beadMatch = String(row.bead_id ?? "") === String("$BEAD_ID");
      const textMatch =
        String(row.facts ?? "").includes("$BEAD_ID") ||
        String(row.narrative ?? "").includes("$BEAD_ID");
      return beadMatch || textMatch;
    })
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
}

const allIds = [...new Set(Object.values(idsByType).flat())];
const memoryGetResult = allIds.length ? await memory-get({ ids: allIds.join(",") }) : [];
const fullObservations = Array.isArray(memoryGetResult)
  ? memoryGetResult
  : (memoryGetResult?.observations ?? []);
```

### 4.2 Group + render markdown block

Group only these sections:

- `decision` → **Decisions**
- `pattern` → **Patterns**
- `learning` → **Learnings**
- `warning` → **Warnings**
- `bugfix` → **Bugfixes**

Formatting rules:

- section headers are `###`
- observation entries are `#### #<id> — <title>`
- include Date, Bead, Confidence
- use `narrative`; if empty, fall back to `facts`
- preserve recency order (`created_at` descending)

Render one appendable block:

```markdown
## Knowledge Export — YYYY-MM-DD
- Scope: bead $BEAD_ID
- Source: memory observations (`memory-search` + `memory-get`)
- Count: <N>

### Decisions
#### #<id> — <title>
- Date: <YYYY-MM-DD>
- Bead: <bead-id or n/a>
- Confidence: <high|medium|low>

<narrative; if empty, use facts>

### Patterns
...

### Learnings
...

### Warnings
...

### Bugfixes
...
```

If no matching observations are found, still append a zero-count block with `_No matching observations found._`.

### 4.3 Append to project-root `KNOWLEDGE.md` (never overwrite)

Initialize once, then append only:

```bash
[ -f KNOWLEDGE.md ] || cat <<'EOF' > KNOWLEDGE.md
# KNOWLEDGE

Human-readable exports from the memory system.
Append-only history.
EOF
```

Before final render, deduplicate against existing exported IDs (same approach as `/knowledge`):

```typescript
const existingContent = await fs.readFile("KNOWLEDGE.md", "utf8");
const existingIds = new Set(
  [...existingContent.matchAll(/(?:^|\s)#(\d+)\b/gm)].map((m) => Number(m[1]))
);

const observations = fullObservations.filter((obs) => {
  if (!TYPES.includes(obs.type)) return false;

  const beadMatch = String(obs.bead_id ?? "") === String("$BEAD_ID");
  const textMatch =
    String(obs.facts ?? "").includes("$BEAD_ID") ||
    String(obs.narrative ?? "").includes("$BEAD_ID");

  if (!beadMatch && !textMatch) return false;
  if (existingIds.has(Number(obs.id))) return false;
  return true;
});
```

Append the rendered block:

```bash
cat <<'EOF' >> KNOWLEDGE.md

[PASTE RENDERED EXPORT BLOCK]

EOF
```

### Verification Gate D (Knowledge → PR)

```bash
test -s KNOWLEDGE.md
grep -q "Knowledge Export" KNOWLEDGE.md
tail -n 120 KNOWLEDGE.md | grep -q "$BEAD_ID"
```

Must be true before final output: `KNOWLEDGE.md` exists, contains an export block, and the newest block references `$BEAD_ID`.

---

## Phase 5: Offer PR Creation

After all gates pass, finish with a direct recommendation:

```markdown
AUTO complete for $BEAD_ID.

Next command:
/pr
```

If user asks to proceed immediately, run `/pr`.

---

## Final Output Contract

Always report:

1. bead ID + created artifacts
2. planning summary (discovery level, waves, task count)
3. execution summary (DAG tasks, completion, deviations)
4. verification evidence (build/test/lint/typecheck + review)
5. knowledge export result (`KNOWLEDGE.md` updated)
6. PR status (offered / generated)

## Related Commands

| Need | Command |
| --- | --- |
| Create only | `/create` |
| Plan only | `/plan <id>` |
| Ship only | `/ship <id>` |
| Knowledge extraction only | `/knowledge <id>` |
| PR description | `/pr` |
