---
name: aislop
version: 1.0.0
description: "Use when checking for AI-generated code slop — narrative comments, swallowed exceptions, console.log leftovers, as any casts, thin wrappers, generic naming, and other patterns AI coding agents leave behind"
---

# aislop — AI Slop Detection

Detect and remove patterns that AI coding agents leave behind: narrative comments, swallowed exceptions, debug leftovers, dead patterns, and more. 50+ rules across 8 languages. Deterministic (no LLM), sub-second scans.

**Install:** `npm install -g aislop` or `npx aislop@latest scan`

**Hook:** Already installed — `aislop hook install --pi` runs after every Pi edit automatically.

## What it catches

| Category | Examples |
|---|---|
| **Narrative comments** | `// Import React`, `// Return the value`, decorative separators, phase headers |
| **Swallowed errors** | Empty `catch` blocks, catch-only-to-log, silent recovery |
| **Debug leftovers** | `console.log`, `print()`, `dbg!()`, `todo!()` |
| **Unnecessary code** | `as any`, `as unknown as X`, thin wrappers, redundant try-catch |
| **Generic names** | `helper_1`, `data2`, `temp1` |
| **Stubs** | Empty functions, TODO/FIXME without tracking, unreachable code |
| **Dead code** | Unused imports, duplicate imports, duplicate type declarations |
| **Security** | Hardcoded secrets, eval, SQL injection, vulnerable dependencies |

## Commands

```bash
# Quick scan (current dir)
aislop scan                    # Text output
aislop scan --json             # Structured JSON for agents
aislop scan --changes          # Only changed files from HEAD
aislop scan --staged           # Only staged files

# Auto-fix what's safe
aislop fix                     # Auto-fix mechanical issues
aislop fix --safe              # Only reversible fixes (imports, comments)
aislop fix -f                  # Aggressive: deps, unused files

# CI gate
aislop ci                      # Exit 1 if score < threshold
aislop ci --changes --base origin/main  # Gate only PR changes

# Init (creates .aislop/config.yml)
aislop init                    # Default config
aislop init --strict           # Enterprise: all engines, failBelow 85

# Other
aislop rules                   # List all rules
aislop badge                   # README badge URL
aislop doctor                  # Check engines
```

## How it's integrated

Three layers in Pi:

| Layer | When | What |
|---|---|---|
| **Auto-inject** | After every write/edit | The `aislop` Pi extension (installed via `aislop hook install --pi`) catches slop in real time |
| **Explicit diagnostics** | On-demand (`diagnostics` tool) | `aislop scan --json` runs alongside `tsc` and Fallow |
| **Manual** | When you ask | Run `aislop scan --json` via `bash` for deeper investigation |

## Slop score

aislop outputs a 0-100 score:
- **80-100**: Clean
- **50-79**: Some slop — review findings
- **0-49**: Heavy slop — needs cleanup

Configure a minimum score gate in `.aislop/config.yml`:
```yaml
ci:
  failBelow: 70
```

## Configuration

Create `.aislop/config.yml` in your project root:

```yaml
# Severity overrides
rules:
  ai-slop/narrative-comment: warning
  ai-slop/trivial-comment: "off"
  security/hardcoded-secret: error

# Exclusion paths
exclude:
  - "**/*.test.ts"
  - src/generated

# CI gate threshold
ci:
  failBelow: 70
```

Or suppress inline:
```typescript
// aislop-ignore-next-line ai-slop/empty-fallback -- options is validated upstream
const opts = { ...defaults, ...(input || {}) };
const legacy = doThing(); // aislop-ignore-line
// aislop-ignore-file  -- place at top of file to skip it entirely
```

## Languages

| Language | What's checked |
|---|---|
| TypeScript / JavaScript | All engines: formatting, linting, code quality, AI slop, security, architecture |
| Python | AI slop (imports, exceptions, comments, `print` debug), security, code quality |
| Go | AI slop, security, code quality |
| Rust | AI slop (unwrap, todo!), security, code quality |
| Ruby | AI slop, security, code quality |
| PHP | AI slop, code quality |
