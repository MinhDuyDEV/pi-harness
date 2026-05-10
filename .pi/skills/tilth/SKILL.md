---
name: tilth
description: DEPRECATED — use the srcwalk skill instead. Tilth MCP is no longer the default backend; all tilth_* tools are now backed by srcwalk.
version: 2.0.0
tags: [code-intelligence, deprecated]
dependencies: []
agent_types: []
tools: []
status: deprecated
---

# Tilth — DEPRECATED

> **This skill is deprecated.** Load the `srcwalk` skill instead.

All `tilth_*` Pi tools (`tilth_search`, `tilth_read`, `tilth_files`, `tilth_deps`) continue to work and are now backed by the `srcwalk` binary via the `srcwalk.ts` extension. The tilth MCP backend has been removed.

## Migration

Replace any reference to this skill with the `srcwalk` skill:

```
# Old
load skill: tilth

# New
load skill: srcwalk
```

The `tilth_*` tool names are preserved for backward compatibility — no changes needed in prompts or agents that call those tools.

For new code navigation work, prefer the native `srcwalk_*` Pi tools:
- `srcwalk_map` — repo map
- `srcwalk_callers` — reverse call graph with depth + filters
- `srcwalk_callees` — forward call graph with `--detailed`
- `srcwalk_flow` — compact orientation slice
- `srcwalk_impact` — heuristic blast-radius triage

See the `srcwalk` skill for full documentation.
