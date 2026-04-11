---
name: writing-plans
description: Use when design is complete and you need detailed implementation tasks for engineers with zero codebase context - creates comprehensive implementation plans with exact file paths, complete code examples, and verification steps assuming engineer has minimal domain knowledge
version: 1.0.0
tags: [planning, documentation]
dependencies: []
---

# Writing Plans

> **Replaces** vague implementation plans that assume the engineer knows the codebase — produces zero-ambiguity plans with exact file paths and complete code examples
## When to Use

- Design/PRD is complete and you need a detailed, step-by-step implementation plan
- You need a plan for engineers with minimal codebase context and explicit file paths

## When NOT to Use

- Requirements are still being defined (use brainstorming or prd)
- You already have a vetted plan and only need execution (use executing-plans)

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by brainstorming skill).

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**

- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use skill({ name: "executing-plans" }) to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

### Goal-Backward Section (REQUIRED)

Document the reasoning that produced this plan using goal-backward methodology:

```markdown
## Must-Haves

**Goal:** [Outcome-shaped goal from PRD]

### Observable Truths

(What must be TRUE for the goal to be achieved?)

1. [Truth 1: User can...]
2. [Truth 2: User can...]
3. [Truth 3: User can...]

### Required Artifacts

(What must EXIST for truths to be true?)
| Artifact | Provides | Path |
|----------|----------|------|
| [File/component] | [What it does] | `src/path/to/file.ts` |

### Key Links

(Where is this most likely to break?)
| From | To | Via | Risk |
|------|-----|-----|------|
| [Component] | [API] | `fetch` | [Why it might fail] |
```

### Dependency Graph

```markdown
### Task Dependencies
```

Task A (User model): needs nothing, creates src/models/user.ts
Task B (Product model): needs nothing, creates src/models/product.ts
Task C (User API): needs Task A, creates src/api/users.ts

Wave 1: A, B (parallel)
Wave 2: C (after Wave 1)

````

## Tiered Task Hierarchy

For multi-agent execution at scale (10+ agents), use explicit tier declarations. This prevents flat decomposition that fails when many agents work in parallel.

### Tier Definitions

| Tier | Role | Description | Example |
|------|------|-------------|---------|
| **planner** | Lead orchestrator | Analyzes scope, decomposes into sub-tasks, coordinates workers | "Design auth system" |
| **sub-planner** | Mid-level coordinator | Takes planner output, further decomposes, assigns to workers | "Break auth into API, model, middleware" |
| **worker** | Execution agent | Executes assigned work, reports progress | "Implement auth service" |

### When to Use Tiers

- **<10 agents**: Optional - flat decomposition works
- **10-50 agents**: Recommended - planner + workers
- **50+ agents**: Required - planner + sub-planners + workers

### Tier Declaration Format

Add tier metadata to each task:

```markdown
### Task 1: Design Auth System

**Tier:** planner

**Files:**
- Create: `docs/auth-design.md`

This task decomposes the auth feature into sub-tasks for implementation.
````

### Handoff Contracts

Tasks must declare what they produce for downstream tasks:

```markdown
### Handoff Contract

**Produces:**

- `docs/auth-design.md` - Architecture decision document

**Consumed By:**

- Task 2: Implement Auth Service
- Task 3: Add Auth Tests
```

### Tier Enforcement in Plans

```markdown
# [Feature Name] Implementation Plan

> **Tier Structure:**
>
> - **Planners (2):** Task 1, Task 5
> - **Workers (6):** Tasks 2,3,4,6,7,8

## Task Hierarchy

### Tier 1: Planner Tasks (Orchestration)

### Task 1: [Planner] Design Auth System

### Task 5: [Planner] Design API Layer

### Tier 2: Worker Tasks (Execution)

### Task 2: [Worker] Implement Auth Service

### Task 3: [Worker] Add Auth Middleware

### Task 4: [Worker] Write Auth Tests
```

### Wave Execution with Tiers

When executing with tiers:

1. **Planner waves** execute first (scope definition)
2. **Worker waves** execute after planner output is ready
3. **Sub-planners** sit between, bridging planner → worker

```markdown
Wave 1 (Planners): Task 1, Task 5
Wave 2 (Workers): Tasks 2, 3, 4 (after Task 1)
Wave 3 (Workers): Tasks 6, 7, 8 (after Task 5)
```

### Anti-Pattern: Flat Decomposition at Scale

Without tiers, 20 agents get 20 flat tasks → chaos:

- Workers step on each other
- No coordination between related work
- Merge conflicts everywhere

With tiers, the structure emerges:

```
Planner → Sub-planner A → Worker 1, 2, 3
                     → Worker 4, 5
        Sub-planner B → Worker 6, 7
```

This mirrors real engineering orgs: lead → tech lead → IC.

`````

## Context Budget

Target: ~50% context per plan execution
Maximum: 2-3 tasks per plan

| Task Complexity | Max Tasks | Typical Context |
| --------------- | --------- | --------------- |
| Simple (CRUD)   | 3         | ~30-45%         |
| Complex (auth)  | 2         | ~40-50%         |
| Very complex    | 1-2       | ~30-50%         |

**Split signals:**

- More than 3 tasks → Create child plans
- Multiple subsystems → Separate plans
- Any task with >5 file modifications → Split
- Checkpoint + implementation → Split
- Discovery + implementation → Split

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**

- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
`````

````

**Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```

```

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with @ syntax
- DRY, YAGNI, TDD, frequent commits

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `.beads/artifacts/<bead-id>/plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use skill({ name: "subagent-driven-development" })
- Stay in this session
- Fresh subagent per task + code review

**If Parallel Session chosen:**
- Guide them to open new session in worktree
- **REQUIRED SUB-SKILL:** New session uses skill({ name: "executing-plans" })
```
````

## See Also

- `executing-plans` - Execute vetted plans in controlled batches with checkpoints
- `prd` - Convert validated design into explicit behavioral requirements
- `brainstorming` - Refine rough ideas and constraints before specification/planning
