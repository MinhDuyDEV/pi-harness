---
name: memory-grounding
description: >
  Use at the start of any command that needs prior context — searches memory for decisions, patterns, and handoffs before execution to avoid re-solving solved problems.
version: 1.0.0
tags: [memory, grounding, pre-flight]
---

# Memory Grounding

Search institutional memory before executing any command that modifies state or makes decisions.

## When to Use

- At the start of `/ship`, `/plan`, `/create`, `/pr`, `/research`, `/resume`
- Before any command that benefits from prior context
- When you need to check if work was already done or decisions already made

## When NOT to Use

- Read-only commands that don't need historical context (e.g., `/status`)
- Commands that explicitly skip grounding (e.g., `--no-memory` flag)

## Protocol

### Step 1: Search for relevant context

```typescript
// Primary: search by bead ID or topic
memory-search({ query: "$ARGUMENTS" });

// Secondary: search by keywords with limit
memory-search({ query: "<feature or topic keywords>", limit: 5 });

// Optional: filter by type for specific needs
memory-search({ query: "<keywords>", type: "decision" });  // Past decisions
memory-search({ query: "<keywords>", type: "bugfix" });    // Known issues
```

### Step 2: Check last session handoff

```typescript
memory-read({ file: "handoffs/last" });
```

### Step 3: Check session history (if resuming work)

```typescript
find_sessions({ query: "$ARGUMENTS", limit: 3 });
```

### Step 4: Apply findings

- **If relevant findings exist:** Incorporate them directly. Don't re-solve solved problems.
- **If prior decisions found:** Follow them unless there's a clear reason to diverge (document the divergence).
- **If known issues found:** Account for them in the current approach.
- **If nothing found:** Proceed normally — absence of memory is not a blocker.

## Command-Specific Variations

| Command     | Extra Focus                                            |
| ----------- | ------------------------------------------------------ |
| `/plan`     | Search bugfixes; check for existing plans to overwrite |
| `/ship`     | Search for failed approaches to avoid repeating        |
| `/create`   | Search for duplicate beads before creating             |
| `/pr`       | Include findings in PR description                     |
| `/research` | Search before spawning agents; narrow scope to gaps    |
| `/resume`   | Read handoff file by bead ID; check session history    |
