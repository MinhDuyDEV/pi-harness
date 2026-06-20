---
description: Research a topic — explore alternatives, gather evidence, and document findings
argument-hint: "<topic-or-work-id> [--quick|--thorough] [--alternatives]"
agentType: scout
---

# Research: $ARGUMENTS

Gather information before implementation. Two tracks:

- **Default:** Find answers to a specific question with evidence.
- **`--alternatives`:** Generate structured options with tradeoffs before committing to an approach.

> Research can happen at any phase when you need external information or codebase understanding.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "behavioral-kernel" });
skill({ name: "source-driven-development" });
skill({ name: "brainstorming" }); // for --alternatives track
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<topic-or-work-id>` | required | Research topic or directory under `.pi/artifacts/` |
| `--quick` | false | Narrow pass, one concrete question (~10 tool calls) |
| `--thorough` | false | Comprehensive source-backed analysis (~100+ tool calls) |
| `--alternatives` | false | Generate structured options with tradeoffs instead of single-answer research |

Default depth: enough direct evidence to unblock planning or implementation.

## Determine Input Type

| Input | Detection | Action |
| --- | --- | --- |
| Work ID | `.pi/artifacts/$ARGUMENTS/` exists | Research in that work context and write `RESEARCH.md` |
| Topic | otherwise | Standalone research and report inline unless asked to save |

## Before You Research

- State the concrete question first.
- Define the evidence threshold for "enough to proceed".
- Prefer source priority: codebase → official docs → source code → examples → web.
- Use confidence levels: discard findings below medium confidence.
- Stop when the next command is obvious. Do not over-research.
- Do not use hidden orchestration; if fresh context is needed, write a brief file and run explicit tmux/print mode.

## Phase 0: Memory Search (Mandatory)

**Do not skip this step.** Researching what the project already knows prevents rework and contradictions.

```typescript
memory-search({ query: "$ARGUMENTS", limit: 5 });
memory-search({ type: "decision", limit: 5 });
memory-search({ type: "warning", limit: 5 });
```

Use existing findings to: skip already-answered questions, narrow scope to gaps only, avoid contradicting prior decisions without justification.

## Phase 1: Load Context

If this is a work ID:

```bash
WORK_DIR=.pi/artifacts/$ARGUMENTS
find "$WORK_DIR" -maxdepth 2 -type f | sort
[ -f "$WORK_DIR/SPEC.md" ] && sed -n '1,220p' "$WORK_DIR/SPEC.md"
[ -f "$WORK_DIR/PLAN.md" ] && sed -n '1,220p' "$WORK_DIR/PLAN.md"
```

Extract specific questions that need answering from the spec or plan. Narrow the research to those gaps only.

## Phase 2: Complexity Detection and Routing

Analyze the research topic complexity:

**Simple research** (execute directly):
- Single factual question
- One specific API or library
- Narrow scope with clear boundaries

**Complex research** (break into sub-questions):
- Multi-angle topic requiring cross-checking
- Broad scope with multiple perspectives

For simple topics, proceed directly. For complex topics, break down into sub-questions and tackle each independently.

## Phase 3: Research Sources (Default Track)

Follow this priority strictly. Lower tiers only if higher tiers don't answer.

| Tier | Source | Tools | Stop When |
| --- | --- | --- | --- |
| 1 | Codebase patterns | `find`, `grep`, `rg`, `read` | Answer found in project code |
| 2 | Official docs | `context7` for API references | API behavior clear |
| 3 | Package source | `opensrc` or node_modules inspection | Docs insufficient |
| 4 | Real-world examples | `codesearch`, `grepsearch` | Pattern confirmed |
| 5 | Web search | `websearch`, `web_fetch` | Only as last resort |

For codebase findings, cite file paths and line numbers. For external findings, cite docs URLs or package versions.

### Confidence Levels

| Level | Meaning | Action |
| --- | --- | --- |
| **High** | Multiple authoritative sources agree, verified in codebase | Use as fact |
| **Medium** | Single good source, plausible but unchecked | Note as likely; verify in implementation |
| **Low** | Conflicting info, speculation, or AI-generated | Discard without corroboration |

## Phase 3A: Generate Alternatives (`--alternatives` Track)

When `--alternatives` is used, replace Phase 3 with alternatives generation.

### Step 1: Frame the Problem

State:

1. **Goal** — outcome, not task.
2. **Constraints** — stack, compatibility, time, user preferences.
3. **Risk of doing nothing** — urgency vs nice-to-have.

If context is still unclear, ask at most two targeted questions.

### Step 2: Ground in Prior Art

```bash
rg -n "existing implementation patterns" 2>/dev/null || true
```

Search the codebase for similar patterns already in use.

### Step 3: Generate 2-3 Options

| Aspect | What to Cover |
| --- | --- |
| Approach | 1-2 sentence summary |
| How | 3-5 implementation steps |
| Pros | What this gets right |
| Cons | What this worsens or complicates |
| Effort | S (<1h), M (1-3h), L (1-2d), XL (>2d) |
| Risk | What could go wrong |

Rules:

- Include the simplest viable option.
- Include at least one meaningfully different option.
- Do not pad with bad options.

### Step 4: Recommend

```markdown
## Recommendation

**Approach:** [Name]
**Effort:** [S/M/L/XL]
**Why:** [2-3 sentences]
**When to reconsider:** [signals that would change the decision]
```

## Phase 4: Stop Conditions

Stop research when ANY of:

- All questions answered with medium+ confidence.
- Tool budget exhausted for requested depth level.
- Last 5 tool calls yielded no new insights.
- Blocked and need human input (external dependency, missing spec, unclear requirement).

## Phase 5: Optional Visible Self-Spawn

Use only when the research is independent and large enough to benefit from fresh context:

```bash
mkdir -p .pi/artifacts/$ARGUMENTS
cat > .pi/artifacts/$ARGUMENTS/RESEARCH-BRIEF.md <<'EOF'
[question, constraints, sources already checked, required output]
EOF
pi --name "research-$ARGUMENTS" --print-turn "Read .pi/artifacts/$ARGUMENTS/RESEARCH-BRIEF.md and write findings to .pi/artifacts/$ARGUMENTS/RESEARCH.md"
```

Afterward, read the output and verify claims before relying on it.

## Phase 6: Document

If `.pi/artifacts/$ARGUMENTS/` exists, write `.pi/artifacts/$ARGUMENTS/RESEARCH.md`:

### Default Track

```markdown
# Research: $ARGUMENTS

**Track:** Default
**Depth:** [quick/thorough/default]
**Source tiers used:** [1/2/3/4/5]

## Questions
| Question | Answer | Confidence | Evidence |
| --- | --- | --- | --- |

## Findings
- [Finding with source]

## Recommendation
- [What to do next based on answers]

## Open Items
- [Unresolved risk/question]
```

### Alternatives Track

```markdown
# Research: $ARGUMENTS

**Track:** Alternatives

## Problem
[What we're trying to solve]

## Constraints
- ...

## Alternatives
### Option A: [Name]
- **How:** ...
- **Pros:** ...
- **Cons:** ...
- **Effort:** ...
- **Risk:** ...

### Option B: [Name]
...

## Recommendation
**Option [X]** because ...

## Next Step
`/create "[description based on chosen approach]"`
```

If there is no work directory, report inline unless the user asks for a saved artifact.

## Output

Report:

1. Track (Default or Alternatives) and depth.
2. Questions answered/partial/unanswered with confidence.
3. Key findings with evidence (file paths, docs URLs).
4. Open items requiring resolution.
5. Recommended approach (Alternatives track).
6. Next command: `/create`, `/plan <id>`, or `/ship <id>`.

## Related Commands

| Need | Command |
| --- | --- |
| Turn research into a plan | `/create "description"` |
| Plan details | `/plan <id>` |
