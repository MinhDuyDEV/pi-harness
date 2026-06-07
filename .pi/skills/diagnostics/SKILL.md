---
name: diagnostics
version: 1.1.0
description: "Use when checking for code errors, type issues, or lint warnings after making changes, before committing, or when troubleshooting build failures"
---

# Diagnostics Skill

Pi automatically runs code diagnostics (type checking, linting, static analysis) after you write or edit files, and appends any errors/warnings directly to the tool result. It **auto-detects project languages** by checking for known marker files.

## Supported languages

| Language    | Marker file(s)          | Tool / Analysis                                    |
|-------------|-------------------------|----------------------------------------------------|
| TypeScript  | `tsconfig.json`         | `tsc --noEmit --pretty false` + **Fallow** (quality)|
| Rust        | `Cargo.toml`            | `cargo check --quiet`                              |
| Go          | `go.mod`                | `go vet ./...`                                     |
| Python      | `pyproject.toml` / `setup.py` / `requirements.txt` | `ruff check .` → `mypy .`                |

If a project has **multiple** languages (e.g., a Rust backend with a TypeScript frontend), diagnostics run for all detected languages.

## Fallow integration (TS/JS only)

When you call `diagnostics` in a TypeScript/JavaScript project, the extension also runs **Fallow** — a deterministic static analysis engine for TS/JS that detects:

- **Dead code** — unused files, exports, and dependencies
- **Complexity hotspots** — large functions, high cyclomatic complexity, CRAP scores
- **Code quality issues** — file health scores, refactoring targets

Fallow is auto-detected and runs via `npx fallow`. No separate install needed.

Only runs in the explicit `diagnostics` tool, not in auto-injection (to keep post-edit feedback fast).

### What the output looks like

```
<diagnostics tool="Fallow (code quality)">
  3 high-complexity function(s):
    - parseRequest (src/parser.ts:142) — CRITICAL
    - handleAuth (src/auth.ts:89) — HIGH
  Health scores (worst 5 of 42 files):
    3.2  src/legacy/utils.ts (210 LOC, 34% dead)
    5.1  src/api/handler.ts (156 LOC)
</diagnostics>
```

---

## How it works

### Auto-injection (no action needed)

After writing or editing a file, diagnostics auto-run for matching languages:

```
---
<diagnostics tool="TypeScript (tsc)">
  src/main.ts:42:5 - error TS2304: Cannot find name 'foo'
</diagnostics>
```

The `<diagnostics tool="...">` tag tells you which language tool produced the output. Only diagnostics matching the edited file's language run (so editing a `.rs` file won't trigger TypeScript checks).

### On-demand project-wide check

Call the `diagnostics` tool to check **all** detected languages at once:

```
diagnostics
→ TypeScript (tsc): no errors
→ Rust (cargo check): error: unused variable `x`
→ Python (ruff): no errors
```

### When diagnostics are skipped

- `PI_DISABLE_AUTO_DIAGNOSTICS=true` is set
- Editing config files (package.json, Cargo.toml, go.mod, lock files, etc.)
- Same project checked within the last 15 seconds (debounce)
- No supported language detected in the project

## Configuration

| Env Var                      | Default | Description                              |
|------------------------------|---------|------------------------------------------|
| `PI_DISABLE_AUTO_DIAGNOSTICS`| `false` | Disable automatic post-edit diagnostics  |
| `PI_DIAGNOSTICS_TIMEOUT_MS`  | `30000` | Timeout per diagnostic run in ms         |

## Adding a new language

Edit `.pi/extensions/diagnostics.ts` and add a new entry to the `LANG_DIAGNOSTICS` array:

```typescript
{
  name: "my-lang",
  label: "MyLang (tool-name)",
  extensions: [".my"],
  detect(root) { return fs.existsSync(path.join(root, "my-project.config")); },
  resolve(root) {
    const bin = findBin(["path/to/tool"]);
    return bin ? { bin, args: ["check"] } : null;
  },
}
```

## Design rationale vs OpenCode LSP

OpenCode spawns ~30 long-running LSP server processes. Pi's diagnostics use **one-off CLI subprocesses** instead:

- **Zero resident memory** — no 100-500MB server processes
- **Zero lifecycle management** — no crashes, version mismatches, or sync issues
- **10% complexity** for 90% of agent-feedback value
- Auto-cleanup via timeout

OpenCode's own docs: *"LSP can help... but it is not always a net positive. Language servers can get out of sync, use significant memory, vary by version or project, and slow down agent workflows."*
