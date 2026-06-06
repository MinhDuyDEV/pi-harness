# Task Extension Architecture

**File**: `extensions/task/index.ts` (~780 lines)
**Purpose**: Delegate complex work to specialist sub-agents via isolated `pi` sessions in tmux.

---

## Overview

The task extension registers a single `task` tool that spawns a self-contained `pi` CLI session in a tmux split pane. The sub-agent reads instructions from a handoff artifact (`WORKER-CONTEXT.md`) and writes results back to `RESULT.md`. A polling loop detects completion and fires a notification.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TASK EXTENSION                                │
│                          index.ts                                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
   │   Agent Discovery │  │  Tool Registration │  │   Event Hooks       │
   │  discoverAgents() │  │  pi.registerTool() │  │  session_shutdown   │
   └────────┬─────────┘  └────────┬─────────┘  └──────────────────────┘
            │                      │
            ▼                      ▼
   ┌───────────────────────────────────────────────┐
   │              execute() Pipeline               │
   │                                               │
   │  1. Resolve agent by name                     │
   │  2. Create artifact dir                       │
   │  3. Write SYSTEM.md, WORKER-CONTEXT.md,       │
   │     USER-PROMPT.md                            │
   │  4. Build pi CLI command with env, model,     │
   │     tools, session-dir flags                  │
   │  5. Spawn tmux split pane → runs pi           │
   │  6. Register in backgroundTasks map           │
   │  7. Install live widget (1s refresh)          │
   └──────────────────────┬────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   ┌──────────────────┐   ┌─────────────────────────┐
   │  Polling Loop     │   │  Widget System           │
   │  10s checkInterval│   │  ┌─────────────────┐    │
   │  ┌──────────────┐ │   │  │ renderWidget()  │    │
   │  │ Atomic op:   │ │   │  │ 1s requestRender│    │
   │  │ delete task  │ │   │  │ timer → smooth  │    │
   │  │ from map,    │ │   │  │ elapsed update  │    │
   │  │ then check   │ │   │  └─────────────────┘    │
   │  │ RESULT.md    │ │   │  ┌─────────────────┐    │
   │  └──────────────┘ │   │  │ countInterval   │    │
   │  on completion:   │   │  │ 3s JSONL poll   │    │
   │  → kill tmux pane │   │  │ → live toolcall  │    │
   │  → parse XML      │   │  │   count display  │    │
   │  → sendMessage()  │   │  └─────────────────┘    │
   └──────────────────┘   └─────────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  Notification Pipeline│
   │                       │
   │  pi.sendMessage({     │
   │    customType:        │
   │    "task-complete",   │
   │    details: {         │
   │      status, summary, │
   │      findings,        │
   │      duration_ms,     │
   │      tool_uses,       │
   │      turn_count       │
   │    }                  │
   │  })                   │
   │                       │
   │  registerMessageRenderer│
   │  ("task-complete") →  │
   │  formatted TUI Text   │
   └──────────────────────┘
              │
              ▼
   ┌──────────────────────┐
   │  renderResult()      │
   │                       │
   │  Phase states:        │
   │  - background → ""    │
   │    (empty Text)       │
   │  - timeout/aborted/   │
   │    failed → "✗ ..."   │
   │  - done → "✓ ..."     │
   │    with stats & expand│
   └──────────────────────┘
```

---

## Core Components

### 1. Agent Discovery (`discoverAgents`)
```
┌─────────────────────────────────────────┐
│  discoverAgents(cwd)                    │
│                                         │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ project dir │  │ user global dir  │  │
│  │ .pi/agents/ │  │ ~/.pi/agent/     │  │
│  │             │  │ agents/          │  │
│  └──────┬──────┘  └───────┬──────────┘  │
│         │                 │              │
│         └──────┬──────────┘              │
│                ▼                         │
│   Merge into Map<name, AgentConfig>      │
│   Project agents override user agents    │
└─────────────────────────────────────────┘
```

- Scans `.pi/agents/*.md` (project) and `~/.pi/agent/agents/*.md` (user)
- Uses `parseFrontmatter()` to extract `description`, `model`, `thinking`, `disallowed_tools`
- Project agents override user agents with the same name

### 2. Background Task Lifecycle

```
create (execute) → register in Map → poll (10s) → complete → cleanup
                                                      ↓
                                         atomic delete-before-read:
                                         1. delete from Map
                                         2. try readFile(RESULT.md)
                                         3. if fails → put back in Map
                                         4. if success → process + notify
```

**Key invariant**: The Map entry is deleted *before* the I/O read. If the read fails (file not ready), the entry is re-inserted. This prevents two concurrent interval ticks from processing the same task.

### 3. Widget System

Two independent timers:

| Timer | Interval | Purpose |
|-------|----------|---------|
| `widgetTimer` | 1s | Calls `tui.requestRender()` — smooth elapsed time updates |
| `countInterval` | 3s | `countToolUses()` — polls JSONL session files for live toolcall counts |

The widget renders as a sticky line above the editor:
```
Agent - description  N toolcalls • elapsed
```

### 4. Execution Artifact Layout

```
.pi/artifacts/task-<id>/
├── SYSTEM.md           # Agent system prompt (from agent .md frontmatter body)
├── WORKER-CONTEXT.md   # Task instructions, prompt, output format
├── USER-PROMPT.md      # Entry point: "Read WORKER-CONTEXT.md, write RESULT.md"
├── RESULT.md           # Output: <status><summary><findings><evidence>
└── sessions/           # pi --session-dir output (JSONL files)
    └── *.jsonl         # Used by countToolUses() for live metrics
```

### 5. pi CLI Command Construction

```
PI_TASK_TOOL_DISABLED=1 pi        # ← recursive load guard
  --name task-<id>                # ← tmux session name
  --model <agent.model>           # ← from agent config
  --tools <allowed tools>         # ← filtered by disallowed_tools
  --session-dir <artifactDir>/sessions  # ← JSONL output
  --append-system-prompt SYSTEM.md      # ← agent system prompt
  @USER-PROMPT.md                 # ← instruction file
```

---

## Render State Machine

```
┌─────────┐
│  CALL   │  renderCall() → "agent_type - description"
└────┬────┘
     │ execute starts
     ▼
┌──────────┐
│ RUNNING  │  renderResult(background=true) → empty Text("", 0, 0)
│          │  (result hidden — shown via widget above editor)
└────┬─────┘
     │ task completes
     ▼
┌──────────┐        ┌────────────────┐
│  DONE    │  ✓     │  FAILED        │  ✗
│  ✓ agent│  agent │  ✗ agent       │
│  stats  │        │  [phase label] │
│  summary│        │  status message│
└──────────┘        └────────────────┘
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Atomic delete-before-read** (polling) | Prevents duplicate notifications when two interval ticks overlap. Delete from Map first, re-insert on read failure. |
| **Return `new Text("", 0, 0)` instead of `undefined`** | `ToolExecutionComponent` crashes with `TypeError` when `renderResult` returns `undefined` (adds `undefined` to `Box` children array). |
| **Separate `countInterval` (3s) from widget timer (1s)** | JSONL file reads are I/O-bound. Keeping them on a separate longer interval prevents blocking the widget's smooth elapsed animation. |
| **`requestRender()` at 1s** | The pi-tui render cycle is request-driven, not continuous. Calling `requestRender()` on an interval is the correct pattern for time-based UI updates. |
| **`PI_TASK_TOOL_DISABLED=1` env var** | Prevents recursive loading when the sub-agent `pi` process loads the same extension. Without this, spawning a sub-agent would try to register the `task` tool again. |
| **Three-file handoff (SYSTEM.md + WORKER-CONTEXT.md + USER-PROMPT.md)** | Separates concerns: system prompt (agent identity), worker context (task instructions), user prompt (entry point). Makes debugging easier — each file is independently readable. |
| **Widget is component factory, not `string[]`** | The first version used static `string[]` widgets. Switched to a component factory with `requestRender()` timer for smooth elapsed time updates instead of stale snapshots. |

---

## Data Flow (End-to-End)

```
User invokes task tool
  │
  ▼
execute() called
  │
  ├── discoverAgents() → find agent by name
  ├── mkdir artifact dir
  ├── write 3 handoff files (SYSTEM, WORKER-CONTEXT, USER-PROMPT)
  ├── build pi CLI command string
  ├── tmux split-window → run pi command
  ├── register BackgroundTask in Map
  └── install widget (if first task)
        │
        ▼
Background polling (every 10s)
  │
  ├── snapshot Map keys
  ├── for each task id:
  │     ├── delete from Map (atomic)
  │     ├── try readFile(RESULT.md)
  │     │   ├── fail → put back in Map, continue
  │     │   └── success →
  │     │         ├── kill tmux pane
  │     │         ├── countToolUses() from JSONL
  │     │         ├── parseResultXml()
  │     │         └── pi.sendMessage("task-complete")
  │     ▼
  └── if Map empty → remove widget
        │
        ▼
Message rendered by registerMessageRenderer("task-complete")
  │
  └──→ TUI shows: "agent - description  N toolcalls • duration"
                  "summary text..."
```
