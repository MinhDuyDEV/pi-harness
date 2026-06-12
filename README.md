# pikit

Batteries-included configuration kit for [pi](https://github.com/badlogic/pi-mono) coding agent. Installs as a pi package — adds extensions, agents, skills, prompts, and themes in one shot.

## Install

```bash
pi install git:github.com/heyhuynhgiabuu/pikit
```

**Compatibility:** requires `@earendil-works/pi-coding-agent` `0.65.0+` and is verified against 0.79.0.

Then install the package dependencies declared in `.pi/settings.json`:

```bash
pi install
```

This pulls in the delegation stack (`@tintinweb/pi-subagents`, `@tintinweb/pi-tasks`, `pi-teams`) and other packages automatically. `TaskExecute` is expected to work directly against `@tintinweb/pi-subagents` without a custom bridge.

## What's Included

### Extensions (15)

Extensions auto-loaded from `.pi/extensions/`:

| Extension | Purpose |
|-----------|---------|
 | `setup-global-agents` | Auto-installs `~/.pi/agent/AGENTS.md` on first run (non-destructive) |
 | `deepseek-provider` | DeepSeek provider with thinking mode support (reasoning_content) |
| `mimo-provider` | Xiaomi MiMo provider via OpenAI-compatible API |
| `usage-tracker` | Token usage tracking via `/usage` command |
| `guard` | Blocks dangerous patterns before tool execution |
| `safety` | Unified safety module with composable rule system |
| `srcwalk` | Code intelligence via `srcwalk` binary |
| `webclaw` | Web scraping via `webclaw` CLI binary |
| `tps` | Tokens-per-second tracking during streaming |
| `memory` | Persistent knowledge pipeline (observations, distillations, handoffs) |
| `dcp` | Dynamic context pruning — compress conversation to stay under token limits |
| `openpi-bridge` | Bridge for custom tool execution |
| `harness` | Multi-agent build harness (planner → generator ↔ evaluator) |
| `tui` | Fixed-editor compositor with scrollable chat, sticky editor/footer, right sidebar, selection-to-clipboard, animated streaming prompt — overrides Pi's default TUI layout |

### Agents (7)

Specialist agent definitions in `.pi/agents/`:

| Agent | Role |
|-------|------|
| `worker` | Small implementation tasks (1-3 files) |
| `explore` | Read-only codebase search and pattern discovery |
| `scout` | External research and documentation lookup |
| `reviewer` | Code review, debugging, security audit |
| `planner` | Architecture and implementation planning |
| `vision` | UI/UX and accessibility analysis |
| `painter` | Image generation and editing |

### Prompts (7)

Slash-command workflows in `.pi/prompts/`. Each core command has flag-based sub-tracks — no separate prompt file needed.

| Command | Flags | Coverage |
|---------|-------|----------|
| `/create` | `--design`, `--spec-only`, `--type` | Clarify ambiguity → design exploration → spec writing → workspace setup |
| `/fix` | `--refactor`, `--scope` | Bug fix (default) or refactoring with scope levels |
| `/init` | `--context`, `--user`, `--all`, `--deep` | Core setup, planning context (roadmap/state), or user profile |
| `/plan` | `--split`, `--architecture` | Implementation plan with institutional research, goal-backward analysis, safety gate |
| `/research` | `--quick`, `--thorough`, `--alternatives` | Evidence-gathering or alternatives/tradeoffs generation |
| `/ship` | `--pr` | Execute tasks wave-by-wave, verify, commit, optionally create PR |
| `/verify` | `--quick`, `--full`, `--fix`, `--test`, `--review`, `--ui-review` | Gates, completeness tracking, test writing, code review, UI audit |

**Merged into core:** clarify, explore, design, commit, pr, test, refactor, review-codebase, ui-review, improve-architecture — all now available as flags on the 7 core commands above.

### Skills (76)

Reusable procedures in `.pi/skills/` — loaded on demand:

Covers: accessibility auditing, browser automation, Cloudflare, context management, Core Data, debugging, design systems, Figma, frontend design, git worktrees, Jira, memory systems, mockup-to-code, Obsidian, PDF extraction, Playwright, React best practices, Resend, Supabase, Swift/SwiftUI, TDD, Vercel deployment, and more.

### Themes

Dark and light TUI themes in `.pi/themes/`.

## Three-Layer Delegation

pikit configures a three-layer delegation stack:

```
Layer 1: @tintinweb/pi-subagents  →  Fast in-process agents
Layer 2: @tintinweb/pi-tasks      →  DAG task orchestration + auto-cascade
Layer 3: pi-teams                  →  Multi-process tmux coordination
```

See `.pi/APPEND_SYSTEM.md` for the full delegation guide with decision flowchart and combo patterns.

## Global Agent Rules

On first session start, pikit auto-installs `~/.pi/agent/AGENTS.md` if it doesn't exist. This file contains universal rules (tone, execution approach, tool priorities, edit protocol) that stack into every project. The template now includes a compact **Behavioral Kernel** that keeps Pi agents anchored on four always-on habits: clarify uncertainty, choose the smallest working change, keep diffs surgical, and define proof before acting.

The template lives at `.pi/templates/AGENTS.md`. To update after install:

```bash
cp .pi/templates/AGENTS.md ~/.pi/agent/AGENTS.md
```

To customize, edit `~/.pi/agent/AGENTS.md` directly — it's your personal config, not overwritten on updates.

If you update the kernel source in `.pi/templates/behavioral-kernel.md`, run `npm run sync:behavioral-kernel` to refresh Pikit's Pi-native instruction surfaces.

## Configuration

pikit's settings live in `.pi/settings.json`. Key defaults:

- **Provider**: `github-copilot`
- **Model**: `claude-opus-4.6`
- **Thinking**: `high`
- **Compaction**: enabled (reserves 16K tokens)
- **Retry**: 3 retries with exponential backoff

Override any setting in your project's `.pi/settings.json` — project settings merge over pikit's.

## Customizing

- **Add agents**: create `.pi/agents/<name>.md` with frontmatter (`model`, `description`)
- **Add prompts**: create `.pi/prompts/<name>.md` — available as `/<name>`
- **Add extensions**: create `.pi/extensions/<name>.ts` — auto-loaded on startup
- **Add skills**: create `.pi/skills/<name>/SKILL.md` — loaded on demand

## License

MIT
