---
name: fallow
description: Use when analyzing code quality, finding dead code, detecting duplication, assessing complexity, checking blast radius, or cleaning up a TS/JS codebase — Fallow provides deterministic static analysis (dead code, dupes, health) and optional runtime intelligence.
version: 1.0.0
tags: [code-quality, static-analysis, cleanup, typescript, javascript]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: [bash]
---

# Fallow — Codebase Intelligence

Fallow is a deterministic static analysis engine for TypeScript/JavaScript. It answers questions about dead code, duplication, complexity, architecture drift, and (optionally) production runtime behavior. It does not generate code — it provides evidence.

**Always use `--format json` for structured output** that's easy to parse and reason about.

## When to Use

- **Before cleanup**: find unused files, exports, dependencies
- **Before refactoring**: identify complexity hotspots and refactor targets
- **Before editing**: check blast radius of changes with `fallow audit`
- **After generating code**: verify no dead code or new duplication was introduced
- **When reviewing**: check if changed code landed on hot paths or complex functions

## When NOT to Use

- Non-TS/JS projects (Fallow is JS/TS only)
- Quick one-line edits (overhead isn't worth it)
- Runtime/production data without first setting up the runtime layer

## CLI Quick Reference

### Full suite (3 analyses in one pass)

```bash
npx fallow
```

### Individual commands

| Command | What it finds | Key flags |
|---|---|---|
| `npx fallow dead-code` | Unused files, exports, types, deps, circular deps, boundary violations | `--format json`, `--changed-since <ref>` |
| `npx fallow dupes` | Repeated logic across files | `--format json`, `--mode semantic` |
| `npx fallow health` | Complexity hotspots, file scores, refactor targets | `--format json`, `--coverage <path>` |
| `npx fallow fix --dry-run` | Preview of auto-removable dead code | `--format json` |
| `npx fallow fix --yes` | Apply auto-fixes | `--format json` |
| `npx fallow audit` | Changed-file gate check (pass/warn/fail) | `--base main`, `--gate new-only` |
| `npx fallow list` | Project info: plugins, entry points, files | `--format json` |
| `npx fallow flags` | Feature flag usage across codebase | `--format json` |

### Agent-specific flags

- `--format json` — structured output, always use this
- `--changed-since main` — only analyze files changed since a ref
- `--production` — only production entry points (skip test/dev configs)

## Workflows

### Cleanup workflow

```bash
# 1. Full scan
npx fallow --format json

# 2. Focus on specific category
npx fallow dead-code --format json
npx fallow dupes --format json
npx fallow health --format json

# 3. Preview auto-fixes
npx fallow fix --dry-run --format json

# 4. Apply auto-fixes
npx fallow fix --yes --format json
```

### Pre-edit check

```bash
# Before making changes, check current state of files you'll touch
npx fallow health --format json | grep -i "file-youre-editing"
```

### Post-edit verification

```bash
# After changes, verify no new issues introduced
npx fallow audit --base main --gate new-only --format json
```

## Reading the Output

### Dead code

```
● Unused files (N)
  path/to/file.ts
  ...
  Files not reachable from any entry point

● Unlisted dependencies (N)
  package-name
  Packages imported in code but missing from package.json

● Circular dependencies (N)
  file-a.ts → file-b.ts → file-a.ts
```

**Caveat for Pi projects**: `.pi/` extensions are dynamically loaded by the Pi runtime. Fallow may flag them as unused. If confident they're runtime-loaded, ignore those findings or add `.pi/` to `ignorePatterns` in a `fallow.json` config.

### Duplication

```
● Duplicates (N clone groups)

    XX lines  N instances  dup:hexhash
    file-a.ts:start-end
    file-b.ts:start-end

● Clone families (N with multiple groups)
  X groups, XX lines across file-a.ts, file-b.ts
    → Extract shared function (X lines) from file-a.ts, file-b.ts
```

### Health / Complexity

```
● Large functions (N total)
  file.ts:line  functionName  XX lines

● High complexity functions (N)
  file.ts:line functionName [CRITICAL|HIGH]
    XX cyclomatic  XX cognitive  XX lines  XX.X CRAP

● File health scores (N files)
  XX.X    file.ts                        [risk|structure]
          XXX LOC    X fan-in    X fan-out   XX% dead

● Refactoring targets (N)
  XX.X  pri:XX.X    file.ts
        [complexity|dead code] · effort:[low|medium|high]
```

## Common Findings & Responses

| Finding | Likely cause | Response |
|---|---|---|
| 100% unused files under `.pi/` | Dynamic Pi extension loading | Ignore or add to `ignorePatterns` in config |
| High dead-export % | Extensions export many symbols for dynamic dispatch | Check if they're `registerExtension()` or similar pattern |
| Circular dependencies | Import cycle in a module chain | Break the cycle by extracting shared logic or using lazy imports |
| Duplicate code blocks | Copy-pasted logic across files | Extract shared function, especially for clone families >2 groups |
| CRITICAL CRAP score | Function is complex AND untested | Split function, add tests, or both |
| Accelerating hotspot | File with high churn + high complexity | Prioritize refactoring before complexity compounds |

## Config

Fallow works without config. To customize:

```bash
npx fallow init
```

This auto-detects project structure and generates a `fallow.json`. It also adds `.fallow/` to `.gitignore`.

For Pi projects where `.pi/` is dynamically loaded, consider:

```json
{
  "ignorePatterns": [".pi/**"]
}
```

Or use `--production` to only analyze production entry points.

## MCP Integration (Optional)

When Fallow's MCP server is configured, agents can call structured tools directly instead of parsing CLI output:

```json
{
  "mcpServers": {
    "fallow": {
      "command": "fallow-mcp"
    }
  }
}
```

Available MCP tools: `analyze`, `check_changed`, `find_dupes`, `check_health`, `audit`, `fix_preview`, `fix_apply`, `get_hot_paths`, `get_blast_radius`, `project_info`, `feature_flags`.

Without MCP, use CLI with `--format json` — same data, one more step.
