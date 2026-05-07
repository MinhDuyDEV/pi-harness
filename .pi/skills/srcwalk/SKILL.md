---
name: srcwalk
description: Use when navigating code with srcwalk’s native CLI-first workflow — repo maps, large-file reads, symbol search, callers/callees, flow slices, impact checks, and precise drill-ins.
version: 1.0.0
tags: [code-intelligence, search, cli, srcwalk]
dependencies: []
agent_types: [planner, worker, reviewer]
tools: [bash]
---

# Srcwalk — Native CLI Workflow

Use this skill when you want the installed `srcwalk` binary directly, not just the project’s `tilth_*` compatibility tools.

## When to Use

- You need native srcwalk commands not exposed by the compatibility layer
- You want repo maps via `srcwalk map`
- You want downstream call tracing via `srcwalk callees`
- You want quick orientation slices via `srcwalk flow`
- You want heuristic blast-radius triage via `srcwalk impact`
- You are validating actual srcwalk CLI behavior or flags

## When NOT to Use

- You only need the project’s stable `tilth_*` tool contract
- You are following existing project prompts that already assume `tilth_search`, `tilth_read`, `tilth_files`, or `tilth_deps`
- You only need a small known-file read that built-in `read` already handles well

## Relationship to the Tilth Skill

- `tilth` skill = project-local compatibility layer exposed as Pi tools (`tilth_search`, `tilth_read`, `tilth_files`, `tilth_deps`)
- `srcwalk` skill = native direct CLI workflow through the installed `srcwalk` binary

Use `tilth` when you need compatibility with existing prompts and tooling.
Use `srcwalk` when you need native commands such as `map`, `callees`, `flow`, `impact`, `guide`, or `version`.

## Critical Rules

**Run `srcwalk guide` before non-trivial use.** It is the installed binary’s source of truth for routing and caveats.

**Do not assume the `tilth_*` compatibility layer exposes all srcwalk commands.** It currently does not.

**Prefer direct path configuration for repeatability.** In this repo the most reliable setup is:

```sh
export PI_CODE_NAV_BACKEND=srcwalk
export PI_SRCWALK_BIN="$HOME/.cargo/bin/srcwalk"
```

## Setup Checks

Use the configured binary when available:

```sh
"${PI_SRCWALK_BIN:-srcwalk}" --help
"${PI_SRCWALK_BIN:-srcwalk}" guide
```

If the binary path is wrong, fix `PI_SRCWALK_BIN` or ensure `srcwalk` is on `PATH`.

## Core Command Routing

| Intent | Command |
|---|---|
| Understand repo shape / entry points | `srcwalk map --scope .` |
| Read a large known file | `srcwalk <path>` |
| Jump to a known line | `srcwalk <path>:<line>` |
| Read exact body/range | `srcwalk <path> --section <symbol|start-end>` |
| Find definitions/usages/text | `srcwalk find <query> --scope <dir>` |
| Find files by glob | `srcwalk files '<glob>' --scope <dir>` |
| Find direct callers | `srcwalk callers <symbol> --scope <dir>` |
| Find downstream callees | `srcwalk callees <symbol> --scope <dir>` |
| Quick orientation slice | `srcwalk flow <symbol> --scope <dir>` |
| Heuristic impact triage | `srcwalk impact <symbol> --scope <dir>` |
| File imports/dependents | `srcwalk deps <file>` |

## Default Workflow

### Explore unfamiliar code

```bash
srcwalk guide
srcwalk map --scope .
srcwalk map --scope src --depth 2
srcwalk find <likely_symbol> --scope src
srcwalk <path>:<line>
```

### Read a large file safely

```bash
srcwalk <path>
srcwalk <path>:123
srcwalk <path> --section <symbol|start-end>
```

Prefer outline/section reads before `--full`.

### Trace behavior from a known symbol

```bash
srcwalk callers <symbol> --scope <dir>
srcwalk callees <symbol> --detailed --scope <dir>
srcwalk flow <symbol> --scope <dir>
```

### Check blast radius before changes

```bash
srcwalk deps <file>
srcwalk impact <symbol> --scope <dir>
```

Use `impact` as triage, then verify important claims with `callers`, `callees`, or exact file reads.

## Caveats

- `impact` is heuristic and not proof by itself
- `find` can include text matches; use `callers` for actual call-site evidence
- Some output is capped; follow `> Next:` suggestions with narrower reads or deeper commands
- The native srcwalk workflow is broader than the current `tilth_*` compatibility layer

## Recommended Use in This Repo

- Keep loading `tilth` for existing project-local prompts and compatibility workflows
- Load `srcwalk` when a task benefits from native CLI-only capabilities or when validating upstream srcwalk behavior directly
