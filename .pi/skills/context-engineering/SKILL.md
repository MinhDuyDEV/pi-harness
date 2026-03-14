---
name: context-engineering
description: Use when designing AGENTS.md hierarchies, understanding autonomous duration, or writing intent layers - covers principles for extending agent work capacity
version: 1.0.0
tags: [context, documentation]
dependencies: []
---

# Context Engineering

## When to Use

- Designing or refactoring AGENTS.md hierarchies and intent layers
- You need to extend autonomous work duration via better context structure

## When NOT to Use

- You only need pruning/distillation mechanics (use context-management)
- Simple tasks where context design is not relevant



## Core Principle

**Autonomous Duration**: How long can an agent work before losing the plot?

Extend it by:

- Binding tighter to intent (clear specs, constraints, invariants)
- Providing systematic context (AGENTS.md hierarchy, memory files)
- Verification loops (test → iterate → verify)

## Three Context Constraints

1. **Blind spots cause hallucinations** - Agent fills gaps with generic priors
2. **Everything influences everything** - Noise degrades ALL output quality
3. **Window is finite** - Performance degrades BEFORE hard token limits

## Intent Layer Principles

### What Belongs in Each AGENTS.md

- **Purpose & Scope** - What this area does. What it DOESN'T do.
- **Entry Points & Contracts** - Main APIs, invariants
- **Usage Patterns** - Canonical examples
- **Anti-patterns** - What NOT to do
- **Dependencies & Downlinks** - Pointers to related context

### Key Mechanics

| Principle                | Meaning                                                  |
| ------------------------ | -------------------------------------------------------- |
| **Hierarchical loading** | When node loads, all ancestors load too (T-shaped view)  |
| **Compression**          | Good nodes compress code; don't add bloat                |
| **LCA placement**        | Place shared knowledge at shallowest node covering paths |
| **Downlinks**            | Point to related context without loading everything      |

## Practical Implications

| Instead of              | Do This                                 |
| ----------------------- | --------------------------------------- |
| Reading entire files    | Use `lsp documentSymbol` for outline    |
| Loading whole documents | Read specific line ranges               |
| Flat file loading       | Navigate AGENTS.md hierarchy            |
| Keeping completed work  | Prune aggressively (context-management) |

## Anti-Patterns

❌ Loading "everything that might be relevant"
❌ Keeping old file reads after editing complete
❌ Reading entire files when you only need a function
❌ Ignoring AGENTS.md hierarchy

## Static vs Runtime Context (Longshot Pattern)

At scale (10+ agents), the difference between **static context** and **runtime context** is the difference between a coherent swarm and chaos.

### Definitions

| Type                | What It Is                                                   | When Loaded            | Example                                 |
| ------------------- | ------------------------------------------------------------ | ---------------------- | --------------------------------------- |
| **Static Context**  | Always-on knowledge — invariants, constraints, project shape | Always (auto-injected) | AGENTS.md, tech-stack.md, user.md       |
| **Runtime Context** | Per-task injections — what THIS task needs right now         | Per-task               | Delegation packet, task spec, file list |

### Why the Split Matters

Without separation, context becomes soup:

- Agent loads everything → hits token limit → degrades
- Agents share stale context → conflicting decisions
- No clear source of truth for "what is the objective"

With separation:

- Static = immune to session pollution (always fresh)
- Runtime = scoped to task (cleaned up when done)
- Result: agents stay coherent at 200-agent scale

### Task Packet Format

Every task dispatched to a worker agent MUST include an explicit context block:

```markdown
## Task Packet

### Static Context (always available)

- Project rules: AGENTS.md
- Tech stack: docs/project/tech-stack.md
- Gotchas: docs/project/gotchas.md

### Runtime Context (this task only)

- Objective: [one sentence]
- Scope: [files this task may touch]
- Constraints: [must_do / must_not_do]
- Dependencies: [what was produced by prior tasks]
- Verification: [acceptance commands]
```

### Injection Pattern

When spawning workers, always inject runtime context explicitly:

```typescript
// WRONG: Vague prompt — agent guesses context
Task({ prompt: "Implement auth service" });

// RIGHT: Explicit static + runtime context split
Task({
  prompt: `## Static Context
AGENTS.md governs all decisions. Tech stack: Bun, TypeScript strict mode.

## Runtime Context
Objective: Implement JWT auth service in src/auth/service.ts.
Scope: Only modify src/auth/ directory.
Dependencies: Schema defined in src/db/schema.ts (from task-1).
Constraints:
  MUST DO: Use zod for input validation
  MUST NOT DO: Add new dependencies without approval
Verification:
  npm run typecheck && npm run lint && vitest src/auth/`,
});
```

### Context Pollution Anti-Patterns

| Anti-Pattern                                | Problem                           | Fix                                   |
| ------------------------------------------- | --------------------------------- | ------------------------------------- |
| Passing entire AGENTS.md as runtime context | Bloats token budget on every task | Load via static injection only        |
| Runtime state persisting across waves       | Stale context poisons next wave   | Clear runtime state between waves     |
| No objective in task packet                 | Agent drifts from goal            | Always include one-sentence objective |
| Injection without scope                     | Agent modifies wrong files        | Always declare file scope             |

### Static Context Files (Always Inject)

These files are the project's invariant layer. Always available, never stale:

```
docs/project/
├── user.md          # User preferences, workflow rules
├── tech-stack.md    # Frameworks, constraints
├── gotchas.md       # Footguns, warnings
└── project.md       # Vision, success criteria
```

### Runtime Context Files (Per-Task)

These are created fresh per task and cleaned up after:

```
.beads/artifacts/<task-id>/
├── delegation.md    # Task-specific instructions
├── spec.md          # Technical requirements
└── progress.txt     # Task state (append-only)
```
