---
name: context-initialization
description: Initialize GSD-style project context files from templates
version: 1.0.0
tags: [context, workflow]
dependencies: []
---

# Context Initialization

## When to Use

- When initializing project context files (project.md, roadmap.md, state.md) from templates.

## When NOT to Use

- When context files already exist and only need minor manual edits.


## Process

### 1. Verify Templates

```bash
test -f .pi/templates/project.md
test -f .pi/templates/roadmap.md
test -f .pi/templates/state.md
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

**project.md**

- Read template
- Fill with answers
- Write to `docs/project/`

**roadmap.md**

- Read template
- Parse phases into table
- Write to `docs/project/`

**state.md**

- Read template
- Set initial state
- Write to `docs/project/`

### 4. Verify

```bash
ls docs/project/
```

Report created files.
