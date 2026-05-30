---
description: Proactive architecture health check — find shallow modules, propose deep-module redesigns
argument-hint: "[path|module|'all'] [--scope surface|deep]"
---

# Improve Architecture: $ARGUMENTS

Proactive codebase health maintenance. Find architectural weaknesses and propose concrete improvements using deep-module design principles.

This is design exploration, not refactoring. Identify where the codebase forces callers or agents to understand too much, then propose better interfaces.

## Load Skills

```typescript
skill({ name: "verification-before-completion" });
skill({ name: "deep-module-design" });
skill({ name: "api-and-interface-design" });
```

## Core Concept: Deep vs Shallow Modules

- **Deep module**: small stable interface hiding significant complexity.
- **Shallow module**: large or leaky interface with thin implementation.

Goal: find shallow modules and propose ways to deepen them.

## Phase 1: Explore

Scan the target area systematically with direct tools:

1. **Module boundaries**
   - Use `srcwalk_deps`, `srcwalk_map`, and import reads.
   - Identify tightly-coupled clusters and high fan-in interfaces.
2. **Interface surface area**
   - Count exports and key function parameters.
   - Check whether callers need internal knowledge.
3. **Confusion signals**
   - Long import chains, circular dependencies, duplicate types, wrapper-only helpers.
4. **Test boundary clarity**
   - If testing a module requires many mocks, the interface is likely too leaky.

## Phase 2: Diagnose

Present evidence:

| Module/Area | Interface Size | Complexity Hidden | Depth Score | Issue |
| --- | --- | --- | --- | --- |
| `auth/` | 12 exports | Low | Shallow | Leaks session details |

Depth scoring:

- **Deep**: few exports, hides complexity, callers remain simple.
- **Moderate**: reasonable interface, some leakage.
- **Shallow**: many exports or callers must understand internals.

Focus on the 2-3 highest-leverage shallow modules. Wait for user confirmation before deeper design.

## Phase 3: Design Exploration

For each selected module, produce three interface designs in a visible artifact:

1. **Minimal interface** — maximum 3 public functions.
2. **Composable interface** — small orthogonal building blocks.
3. **Domain-driven interface** — public API reflects domain concepts, not infrastructure.

Write alternatives to `.pi/plans/<id>/INTERFACE-OPTIONS.md` or `docs/adr/<id>-INTERFACE-OPTIONS.md`. If independent fresh-context critique is worth the cost, explicitly self-spawn Pi in tmux/print mode with that artifact and require a written review file.

## Phase 4: Synthesize

Compare designs:

| Aspect | Minimal | Composable | Domain-Driven |
| --- | --- | --- | --- |
| Exports | 3 | 8 | 5 |
| Testability | High | High | Medium |
| Migration effort | High | Low | Medium |
| AI-friendliness | Best | Good | Good |

Propose a hybrid:

- Exact function/type signatures.
- What complexity is hidden.
- Migration path and compatibility impact.
- Blast radius from `srcwalk_deps`.
- Estimated effort.

## Phase 5: Report

```markdown
## Architecture Health Report

### Scope
[What was analyzed]

### Findings
[Depth score table]

### Proposed Improvements

#### 1. [Module Name]
**Current interface:** ...
**Proposed interface:** ...
**Depth improvement:** Shallow → Deep

```typescript
// Exact proposed signatures
```

**Migration path:**
1. ...

**Blast radius:** [N files]
```

Record durable findings with `observation({ type: "pattern" })` when useful.

## Scope Levels

- `--scope surface`: Phase 1-2 only; read-only.
- `--scope deep`: full design exploration.

## Rules

- Do not refactor code in this command.
- Present options and let the user decide.
- Every claim must cite `file:line` evidence.
- Prefer fewer, higher-impact suggestions.
- The best interface change deletes code from callers.

## Related Commands

| Need | Command |
| --- | --- |
| Execute a refactor | `/create "refactor ..."` |
| Review code quality | `/review-codebase` |
| Plan implementation | `/plan <id>` |
