---
name: fallow
description: Deterministic static analysis for TS/JS via the Fallow CLI — dead code, duplication, complexity, blast radius. Use when cleaning a codebase, hunting dead code or dupes, or verifying generated code added no waste.
metadata:
  version: 1.0.0
  tags:
  - code-quality
  - static-analysis
  - cleanup
  - typescript
  - javascript
  dependencies: []
---

# Fallow — Codebase Intelligence

Deterministic static analysis for TS/JS. Answers: dead code, duplication, complexity, architecture drift, (optionally) runtime behavior. **Does not generate code** — provides evidence.

**Always `--format json`** for structured output.

## When to Use

- **Before cleanup**: find unused files, exports, deps
- **Before refactor**: complexity hotspots + targets
- **Before editing**: blast radius via `fallow audit`
- **After generation**: verify no dead code or new duplication
- **When reviewing**: did the change land on a hot path?

## When NOT to Use

Non-TS/JS (Fallow is JS/TS only); one-line edits (overhead); runtime data without the runtime layer set up.

## Core Commands

```bash
# Dead code: unused exports, files, deps
fallow dead --format json

# Duplication: similar code blocks
fallow dupes --format json

# Health: complexity, size, blast radius per file
fallow health --format json

# Audit: change impact
fallow audit --changed-since main --format json

# Combined report
fallow report --format json
```

## Interpreting Output

```json
{
  "dead": {
    "files": ["src/legacy/foo.ts"],
    "exports": [{ "file": "...", "name": "bar", "used": false }],
    "deps": ["lodash.debounce"]
  },
  "dupes": {
    "blocks": [{ "files": ["a.ts", "b.ts"], "lines": 12, "hash": "..." }]
  },
  "health": {
    "files": [{
      "path": "src/services/user.ts",
      "complexity": 23,        // high
      "blast": 47,            // files affected
      "lines": 312
    }]
  }
}
```

Read the JSON. Cite the files and line counts. Don't paraphrase — the numbers are the evidence.

## Workflow

1. **Baseline first.** Run `fallow health` before changes. Save the JSON.
2. **Make your change.**
3. **Re-run.** Compare new JSON to baseline. Did complexity go up? New dead code? New dupes?
4. **Clean up.** If new dead code, delete. If new dupes, extract. If complexity spike, split.
5. **Verify.** Run typecheck + tests + the diff didn't grow unrelated changes.

## Red Flags

"Code quality" claims without Fallow output; skipping the run because "we know it's bad" (run Fallow); "small project, no need" (even small projects have dead code); reading the summary instead of the JSON (the JSON is the contract); no baseline = no diff = no signal; running once and never again; deleting "unused" exports without checking consumers (might be a public API); treating low-dead-code % as the goal (the goal is fewer bugs); trying to clean a whole project at once; "fallow said so" — Fallow is evidence, not authority; use judgment.
