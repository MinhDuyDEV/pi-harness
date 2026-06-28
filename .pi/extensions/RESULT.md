# `.pi/extensions/` — Comprehensive Directory Map

> Generated: 2026-06-06  
> Structure: pikit Pi AI extension system

---

## Overview

The `.pi/extensions/` directory contains 15 extension entry points and 7 subdirectories totaling ~50+ source files. Every top-level `.ts` file (except backups) exports a `default function(pi: ExtensionAPI)` which Pi loads at startup.

**Dependencies** (from `package.json`):
- `@huggingface/transformers` — local embeddings (`memory/embeddings.ts`)
- `sqlite-vec` — vector similarity search (`memory/db.ts`)
- Peer: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@sinclair/typebox`

---

## Top-Level Extensions (14 entry points)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `deepseek-provider.ts` | 957 | DeepSeek provider — thinking mode, tool-call repair, retry, storm breaker |
| 3 | `memory.ts` | ~400 | 4-tier persistent memory: capture → distill → curate → recall (SQLite + FTS5) |
| 4 | `mimo-provider.ts` | 200 | Xiaomi MiMo OpenAI-compatible provider — flat pricing, thinking level mapping |
| 5 | `safety.ts` | 2 | Re-export of `safety/extension.ts` — unified safety module |
| 6 | `srcwalk.ts` | 585 | Code navigation backend — `srcwalk_search/read/files/deps/callers/callees/map/review/compare` |
| 7 | `tps.ts` | ~60 | Tokens-per-second display — shows on agent_end when TUI is available |
| 8 | `usage-tracker.ts` | ~350 | Token usage & cost tracking — SQLite- persisted, `/usage` command |
| 9 | `webclaw.ts` | ~250 | Web scraping via `webclaw` CLI — `webclaw_scrape`, `webclaw_batch`, `/webclaw` |
| 10 | `setup-global-agents.ts` | ~40 | Auto-copies `AGENTS.md` template to `~/.pi/agent/` on first session |
| 11 | `dcp/index.ts` | ~300 | Dynamic Context Protocol — compression, nudges, artifact tracking, quality metrics |
| 12 | `harness/index.ts` | ~170 | Multi-agent build harness — planner → generator → evaluator GAN loop |
| 13 | `task/index.ts` | ~780 | Delegate work to specialist agents via AgentSessions (foreground + background) |
| 14 | `tui/index.ts` | ~765 | AmpTUI — full terminal UI with fixed editor, sidebar, footer, git status |

---

## Subdirectory Map

### `dcp/` — Dynamic Context Protocol (4 files)

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry — wires compress tool, nudge system, artifact tracking, quality metrics |
| `config.ts` | Pure data types + default config (compress, dedup, auto-compact, probes, etc.) |
| `compress.ts` | Compression engine — block storage, context stripping (compress-strip, dedup, purge-errors) |
| `nudge.ts` | Gradual context pressure system — 3 zones (none/gentle/critical), block-aware suggestion |

**Key exports**: `registerCompressTool`, `processContextMessages`, `addBlock`, `getBlocks`, `mergeIntoPersistentSummary`, `evaluateCompressionProbes`, `NudgeManager`

---

### `deepseek/` — DeepSeek Provider Internals (9 files)

| File | Purpose |
|------|---------|
| `README.md` | Architecture docs, P0-P3 status, model registry, usage |
| `thinking.ts` | `isThinkingModeModel()`, `thinkingModeForModel()`, `stripHallucinatedToolMarkup()` |
| `repair.ts` | Tool-call repair: `stampMissingIds()`, `fixToolCallPairing()`, `repairTruncatedJson()`, `healMessages()` |
| `retry.ts` | `fetchWithRetry()` — exponential backoff, body draining, Retry-After respect |
| `sse.ts` | OpenAI-compatible SSE stream parser with `reasoning_content` support |
| `storm.ts` | StormBreaker — repeat-loop guard, detects identical tool calls in sliding window |
| `shrink.ts` | Token-aware message shrinking (conservative byte estimation) |
| `scavenge.ts` | Tool schema scavenging — flatten deep schemas, strip incompatible fields for DeepSeek |
| `flat-args.ts` | Schema flattening for deeply nested tool call schemas |
| `lifecycle.ts` | Structured event lifecycle (start/delta/end) for reasoning, text, tool calls |

**Ported from**: [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) (MIT)

---

### `harness/` — Multi-Agent Build Harness (17 files)

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry — registers `harness` tool with parameters |
| `agents.ts` | Agent loading from `.pi/agents/*.md` — frontmatter parsing, model resolution |
| `artifacts.ts` | Progress artifacts, `HarnessTracker`, workflow script generation |
| `gitSafety.ts` | Git workspace isolation — `createHarnessWorkspace()` (current/worktree modes) |
| `interactivePane.ts` | Tmux interactive pane session management |
| `orchestrator.ts` | Core execution orchestration — planning → generation → evaluation loop |
| `parsing.ts` | Sprint manifest parsing + eval output parsing |
| `policy.ts` | Safety policy — `isCommandAllowed()`, `filterToolsForRole()`, protected paths |
| `runner.ts` | Agent runner — SDK mode + interactive-pane mode |
| `skills.ts` | Skill registry — load skills from `.pi/skills/` JSON |
| `tmuxWatch.ts` | Tmux observability — create watch panes for harness execution |
| `traceQuality.ts` | Trace quality assessment — `assessRunTrace()`, `assessSprintTrace()` |
| `verification.ts` | Deterministic verification command runner |
| `widgets.ts` | Live TUI widget — spinner, phase display, agent metadata |
| `agents.test.ts` | Unit tests for agent loading |
| `artifacts.test.ts` | Unit tests for artifact utilities |
| `gitSafety.test.ts` | Unit tests for git workspace modes |
| `interactivePane.test.ts` | Unit tests for interactive pane helpers |
| `parsing.test.ts` | Unit tests for sprint/eval parsing |
| `policy.test.ts` | Unit tests for safety policy |
| `traceQuality.test.ts` | Unit tests for trace quality scoring |
| `verification.test.ts` | Unit tests for verification commands |
| `widgets.test.ts` | Unit tests for widget rendering |

---

### `lib/` — Shared Utilities (1 file)

| File | Purpose |
|------|---------|
| `util.ts` | `isAbortError()`, `abortOnSignal()`, `execFilePromise()` — cross-extension helpers |

**Used by**: `srcwalk.ts`, `webclaw.ts`, `deepseek/retry.ts`

---

### `memory/` — Persistent Memory System (16 files)

| File | Purpose |
|------|---------|
| `memory.ts` (top-level) | Extension entry — registers 2 tools (observation, memory-search) |
| `config.ts` | Types: `ConfidenceLevel`, `ObservationType`, `MemoryConfig`, `MEMORY_CONFIG` default |
| `db.ts` | SQLite database layer — `getMemoryDB()`, `closeMemoryDB()`, FTS5 setup |
| `pipeline.ts` | Capture pipeline — `storeTemporalMessage()`, `getRelevantKnowledge()`, distillation ops |
| `distill.ts` | TF-IDF distillation — `distillSession()` — stop-word filtering, term frequency |
| `curator.ts` | Pattern-based curation — regex patterns for decisions, bugfixes, features |
| `observations.ts` | CRUD for observations — `storeObservation()`, `searchObservations()` |
| `scoring.ts` | Time-decay scoring — maturity state machine (candidate → established → proven) |
| `embeddings.ts` | Local embeddings via `@huggingface/transformers` (all-MiniLM-L6-v2, 384d) |
| `sanitize.ts` | Secret sanitization — strips API keys, tokens, passwords before storage |
| `maintenance.ts` | Database maintenance — `optimizeFTS5()`, `checkpointWAL()`, `getDatabaseSizes()` |
| `storage.ts` | Low-level memory file CRUD — `upsertMemoryFile()`, `getMemoryFile()` |
| `persona.ts` | L3 Persona Generator — user profile from weighted observations |
| `scene.ts` | L2 Scene Layer — concept clustering, single-pass grouping |
| `tools.ts` | Compact tool registrations (3 tools) |
| `index-generator.ts` | Auto-generated knowledge catalog (Karpathy-style LLM Wiki) |
| `helpers.ts` | Constants, formatting, file helpers |
| `admin.ts` | (removed in ADR-002) — was admin tool dispatcher |
| `scripts/smoke-lifecycle.ts` | End-to-end lifecycle smoke test |

---

### `safety/` — Unified Safety Module (11 files)

| File | Purpose |
|------|---------|
| `extension.ts` | Entry — `before_tool_call` hook, audit log, `/safety` command |
| `types.ts` | Core types: `Verdict`, `VerdictKind`, `Severity`, `ThreatCategory`, `ToolCallContext` |
| `evaluate.ts` | Rule evaluator — first-match or highest-severity strategy |
| `context.ts` | Event normalization — converts raw events to `ToolCallContext` |
| `compose.ts` | Composition operators — `merge()`, `exclude()`, `forTool()`, `sortBySeverity()` |
| `audit.ts` | Ring-buffer audit trail (max 500 entries) |
| `env-policy.ts` | `buildSubprocessEnv()` — restricted env for child processes (base + per-tool allowlist) |
| `rules/presets.ts` | `defaultRules()` — composes all 26 rules + `VerificationTracker` |
| `rules/credentials.ts` | 2 rules: credential echo block, sensitive file write |
| `rules/destructive.ts` | 6 rules: rm -rf, pipe-to-shell, sudo, eval-remote |
| `rules/git.ts` | 11 rules: force push, reset --hard, clean, add ., no-verify, rebase, etc. |
| `rules/injection.ts` | Prompt injection scanning (context file + memory observation) |
| `rules/network.ts` | Network access controls — curl/wget/ssh to localhost/private/cloud-metadata |
| `rules/publish.ts` | 4 rules: npm/cargo publish, docker prune, database drop |
| `rules/system.ts` | 2 rules: dangerous chmod, shell profile mutation |
| `rules/verification.ts` | Verification tracking — detects unverified completions |
| `rules/workspace.ts` | Workspace boundary enforcement — protected system paths |

**26 rules total** across 7 categories. Modes: `block` (hard deny), `confirm` (soft deny with prompt). `env-policy.ts` provides the subprocess allowlist used by `srcwalk.ts` and `webclaw.ts`.

---

### `task/` — Specialist Agent Delegation (1 file)

| File | Purpose |
|------|---------|
| `index.ts` | ~780 lines — delegates work to specialist agents via AgentSessions. Foreground (blocking with streaming) + background (tmux) modes. Three agent sources: `.pi/agents/*.md`, `~/.pi/agent/*.md`, built-in |

---

### `tui/` — AmpTUI Terminal UI (12 files)

| File | Purpose |
|------|---------|
| `index.ts` | Main extension — wires editor, sidebar, footer, git status, todos, queue, usage |
| `editor.ts` | AmpBoxEditor — background-filled editor with `$`/`$$` prompt |
| `editor-prompt.ts` | Editor prompt state (isShell, streamingPrompt) |
| `fixed-editor/compositor.ts` | FixedEditorCompositor — splits terminal: scrollable messages + fixed editor |
| `fixed-editor/cluster.ts` | Fixed-editor cluster — packs editor + status + transcript into reserved rows |
| `footer.ts` | Footer renderer — git branch, tokens, cost, queue, turn info |
| `git-status.ts` | Git status — async refresh of branch, staged/unstaged/untracked counts |
| `sidebar.ts` | Sidebar — model, token, cost, todo, git, queue info |
| `todos-panel.ts` | TODO scanner — reads `artifacts/TODO.md` from project |
| `queue-panel.ts` | Queue state tracker — steer/followUp counts |
| `settings.ts` | Settings reader — keyboard scroll shortcuts from `.pi/settings.json` |
| `usage.ts` | Token usage metrics aggregation + cost estimation |
| `tests/fixed-editor.test.ts` | Unit tests for fixed editor |
| `tests/footer.test.ts` | Unit tests for footer |
| `tests/sidebar.test.ts` | Unit tests for sidebar |
| `tests/todos-panel.test.ts` | Unit tests for todos panel |

---

### Backup Files (inactive)

| File | Purpose |
|------|---------|
| `openpi-bridge.ts.bak` | OpenPi ↔ Pi TUI sync bridge (writes lifecycle events to shared JSON) |
| `stitch.ts.bak` | Google Stitch AI UI design & code generation (11 tools via @google/stitch-sdk) |
| `task/index.ts.bak` | Previous version of task |

---

## Dependency Graph (Key Relationships)

```
                 ┌─────────────────┐
                 │  Pi Core (peer)  │
                 │  pi-ai           │
                 │  pi-coding-agent │
                 │  pi-tui          │
                 └────────┬────────┘
                          │ loads
          ┌───────────────┼───────────────────┐
          │               │                   │
  ┌───────▼───────┐ ┌────▼────┐ ┌────────────▼────┐
  │  copilot-     │ │ deepseek│ │  safety/        │
  │  provider     │ │-provider│ │  extension.ts   │
  └───────┬───────┘ └────┬────┘ └────────┬────────┘
          │              │               │
          │       ┌──────▼──────┐  ┌─────▼──────┐
          │       │ deepseek/   │  │ safety/    │
          │       │ *.ts (8)    │  │ rules/*.ts │
          │       └─────────────┘  │ (9 files)  │
          │                        └────────────┘
  ┌───────▼───────┐ ┌────────────┐ ┌────────────┐
  │  lib/util.ts  │ │ safety/    │ │ tui/       │
  │ (shared util) │ │ env-policy │ │ (12 files) │
  └───────▲───────┘ └─────▲──────┘ └────────────┘
          │                │
  ┌───────┴───────┐ ┌─────┴──────┐
  │  srcwalk.ts   │ │ webclaw.ts │
  └───────────────┘ └────────────┘

  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │  memory/   │  │  dcp/      │  │  harness/  │
  │ (16 files) │  │ (4 files)  │  │ (17 files) │
  └────────────┘  └────────────┘  └────────────┘
```

---

## Extension API Surface Summary

**Tools registered** (via `pi.registerTool`):
- `compress` (dcp) — conversation compression
- `harness` (harness) — multi-agent build loop
- `observation`, `memory-search` (memory) — memory CRUD (memory-admin removed in ADR-002)
- `webclaw_scrape`, `webclaw_batch` (webclaw) — web scraping
- `srcwalk_search`, `srcwalk_read`, `srcwalk_files`, `srcwalk_deps` (srcwalk)
- `srcwalk_map`, `srcwalk_callers`, `srcwalk_callees`, `srcwalk_context` (srcwalk)
- `srcwalk_impact`, `srcwalk_review`, `srcwalk_compare` (srcwalk)
- `task` (task) — delegate work to specialist agents

**Commands** (`pi.registerCommand`):
- `/dcp` — DCP status
- `/safety` — safety status + audit log
- `/usage` — usage tracker stats
- `/webclaw` — webclaw version check

**Providers** (`pi.registerProvider`):
- `deepseek` (deepseek-provider.ts)
- `mimo` (mimo-provider.ts)

**Event hooks** used across extensions:
- `tool_call` / `before_tool_call` / `tool_result` (guard, safety, dcp, harness)
- `input` (dcp, tui)
- `agent_start` / `agent_end` (tps, tui, setup-global-agents)
- `session_start` / `session_shutdown` (setup-global-agents, dcp)
- `turn_end` (dcp, usage-tracker)
- `context` (dcp)
- `session_before_compact` (dcp)
- `before_agent_start` (dcp)

---

## Files Not Yet Read (for full coverage, inspect these)

These were identified from grep output but not fully read — they are deep internals:
- `safety/context.ts` (full) — event normalization
- `safety/evaluate.ts` (full) — rule evaluation logic
- `memory/*.ts` (most) — extensive internals (embeddings, scenes, persona)
- `tui/*.ts` (most) — full UI implementation (editor, compositor, sidebar)
- `harness/*.ts` (most) — orchestrator, runner, interactive pane internals
- `task/index.ts` (full, 780 lines) — agent delegation

---

## File Count Summary

| Directory | Source Files | Test Files | Total |
|-----------|-------------|------------|-------|
| Root (.ts) | 14 | 0 | 14 |
| `dcp/` | 3 | 0 | 3 |
| `deepseek/` | 8 | 0 | 8 |
| `harness/` | 13 | 8 | 21 |
| `lib/` | 1 | 0 | 1 |
| `memory/` | 16 | 0 | 16 |
| `safety/` | 8 | 0 | 8 |
| `scripts/` | 2 | 0 | 2 |
| `security/` | 1 | 0 | 1 |
| `task/` | 1 | 0 | 1 |
| `tui/` | 10 | 4 | 14 |
| Backups | 3 | 0 | 3 |
| **Total** | **80** | **12** | **92** |
