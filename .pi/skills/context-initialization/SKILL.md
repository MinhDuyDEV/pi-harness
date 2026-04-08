---
name: context-initialization
description: Initialize project context files from templates. Creates on-demand planning files (roadmap.md, state.md) and updates auto-injected project.md.
version: 2.0.0
tags: [context, workflow]
dependencies: []
---

# Context Initialization

## When to Use

- When initializing project context files (project.md, roadmap.md, state.md) from templates.
- project.md is auto-injected into every prompt; roadmap.md and state.md are on-demand.

## When NOT to Use

- When context files already exist and only need minor manual edits.

## Process

### 1. Verify Templates

```typescript
tilth_tilth_files({ pattern: "*.md", scope: ".opencode/memory/_templates" });
// Required templates: project.md, roadmap.md, state.md
```

Stop if missing.

### 2. Gather Input

Ask 5 questions:

1. Project vision
2. Success criteria
3. Target users
4. Phases
5. Current phase

Skip if `--skip-questions` flag set.

### 3. Create Files

**project.md** (auto-injected — keep concise)

- Read template via `Read({ filePath: ".opencode/memory/_templates/project.md" })`
- Fill with answers
- Write via `memory-update({ file: "project/project", content: ..., mode: "replace" })`

**roadmap.md** (on-demand — access via `memory-read({ file: "project/roadmap" })`)

- Read template
- Parse phases into table
- Write via `memory-update({ file: "project/roadmap", content: ..., mode: "replace" })`

**state.md** (on-demand — access via `memory-read({ file: "project/state" })`)

- Read template
- Set initial state
- Write via `memory-update({ file: "project/state", content: ..., mode: "replace" })`

### 4. Verify

```typescript
tilth_tilth_files({ pattern: "*.md", scope: ".opencode/memory/project" });
```

Report created files with their injection status (auto-injected vs on-demand).
