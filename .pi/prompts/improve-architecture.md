---
description: Proactive architecture health check — find shallow modules, propose deep-module redesigns
argument-hint: "[path|module|'all'] [--scope surface|deep]"
---

# Improve Architecture: $ARGUMENTS

Proactive codebase health maintenance. Find architectural weaknesses and
propose concrete improvements using deep-module design principles.

This is NOT bug-finding or refactoring. This is **design exploration** —
identifying where the codebase fights its own users (including AI agents)
and proposing better interfaces.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
```

## Core Concept: Deep vs Shallow Modules

From John Ousterhout's *A Philosophy of Software Design*:

- **Deep module** = small, stable interface hiding significant complexity
  → Easy to test, mock, reason about. One import, one call, clear result.
- **Shallow module** = large, leaky interface with thin implementation
  → Forces reading 5 files to understand one concept. Impossible to test in isolation.

**Goal**: Find shallow modules and propose ways to deepen them.

## Phase 1: Explore

Scan the target area systematically. Use `explore` subagent or `tilth_search` for each:

1. **Module boundaries** — Where are the natural boundaries?
   - Look at import graphs: which files import from which?
   - Identify clusters of tightly-coupled files
   - Find files that are imported by many others (high fan-in = important interfaces)

2. **Interface surface area** — For each module boundary:
   - How many exports does it have?
   - How many parameters do the key functions take?
   - Are callers forced to understand internals to use it?

3. **Confusion signals** — Where does understanding one concept require bouncing between many files?
   - Long import chains
   - Circular dependencies
   - "Helper" files that exist only because the real module leaks complexity
   - Types that mirror each other across boundaries (mapping code = leaky abstraction)

4. **Test boundary clarity** — Can you draw a clean line for unit testing?
   - If testing module A requires mocking B, C, D → coupling problem
   - If test setup exceeds 20 lines → interface too complex

## Phase 2: Diagnose

Present findings as a table:

| Module/Area | Interface Size | Complexity Hidden | Depth Score | Issue |
|-------------|---------------|-------------------|-------------|-------|
| `auth/`     | 12 exports    | Low               | Shallow     | Leaks session management to every consumer |
| `db/`       | 3 exports     | High              | Deep        | Good — single query interface |
| `api/routes` | 45 exports   | None              | Shallow     | Each route handler does its own validation |

**Depth scoring:**
- **Deep**: Few exports, hides significant complexity, callers don't need to know internals
- **Moderate**: Reasonable interface, some leakage
- **Shallow**: Many exports, callers must understand internals, hard to test in isolation

Focus on the **2-3 shallowest modules** — highest leverage improvements.

Wait for user to confirm which modules to explore further.

## Phase 3: Design Exploration

For each selected shallow module, spawn **3 parallel sub-agents** to propose
radically different interface designs:

```typescript
// Spawn 3 explore agents with different design constraints
Agent({
  type: "planner",
  prompt: `Design a MINIMAL interface for [module]. 
    Constraint: maximum 3 public functions. 
    Hide all complexity behind those 3 functions.
    Show the interface (function signatures + types) and explain what each hides.`,
  run_in_background: true
});

Agent({
  type: "planner", 
  prompt: `Design a COMPOSABLE interface for [module].
    Constraint: small, orthogonal building blocks that compose.
    Think Unix pipes — each piece does one thing.
    Show the interface and example composition patterns.`,
  run_in_background: true
});

Agent({
  type: "planner",
  prompt: `Design a DOMAIN-DRIVEN interface for [module].
    Constraint: interface reflects the business domain, not the implementation.
    Callers should never see database, HTTP, or framework concepts.
    Show the interface and how it maps to domain concepts.`,
  run_in_background: true
});
```

## Phase 4: Synthesize

After all sub-agents return:

1. **Compare** the 3 designs side-by-side:

| Aspect | Minimal | Composable | Domain-Driven |
|--------|---------|------------|---------------|
| Exports | 3 | 8 | 5 |
| Testability | High — mock one thing | High — test each piece | Medium — domain logic mixed |
| Migration effort | High — breaking changes | Low — additive | Medium |
| AI-friendliness | Best — simple to call | Good — discoverable | Good — readable |

2. **Propose a hybrid** — take the best aspects of each:
   - Interface signature (exact types and function names)
   - What it hides vs exposes
   - Migration path from current code (which changes are breaking?)
   - Estimated effort

3. **Check blast radius** with `tilth_deps` — how many files would change?

## Phase 5: Report

Output format:

```markdown
## Architecture Health Report

### Scope
[What was analyzed]

### Findings
[Depth score table from Phase 2]

### Proposed Improvements

#### 1. [Module Name]: [One-line description]

**Current interface**: [X exports, Y params average]
**Proposed interface**: [A exports, B params average]
**Depth improvement**: Shallow → Deep

**New interface:**
```typescript
// Exact proposed signatures
```

**Migration path:**
1. [Step 1 — non-breaking]
2. [Step 2 — deprecate old]
3. [Step 3 — remove old]

**Blast radius:** [N files affected]

### Recommended Cadence
Run after major feature merges or weekly during active development.
```

Record findings with `observation({ type: "pattern" })`.

## Scope Levels

- `--scope surface`: Phase 1-2 only (explore + diagnose). Fast, read-only.
- `--scope deep` (default): Full pipeline including parallel design exploration.

## Rules

- This is exploration, not execution. Do NOT refactor code.
- Present options, let the user decide.
- Every claim must cite `file:line` evidence.
- If a module is already deep, say so — don't invent problems.
- Prefer fewer, higher-impact suggestions over many small ones.
- The best interface change is one that **deletes code** from callers.

## Related Commands

| Need | Command |
|------|---------|
| Execute a refactor | `/refactor <path>` |
| Review code quality | `/review-codebase` |
| Plan implementation | `/plan` |
