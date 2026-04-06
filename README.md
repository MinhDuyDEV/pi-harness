# pikit

Batteries-included configuration kit for [pi](https://github.com/badlogic/pi-mono) coding agent. Installs as a pi package — adds extensions, agents, skills, prompts, and themes in one shot.

## Install

```bash
pi install git:github.com/heyhuynhgiabuu/pikit
```

**Compatibility:** requires `@mariozechner/pi-coding-agent` `0.65.0+` and is verified against the 0.65.x line, including 0.65.2.

Then install the package dependencies declared in `.pi/settings.json`:

```bash
pi install
```

This pulls in the delegation stack (`@tintinweb/pi-subagents`, `@tintinweb/pi-tasks`, `pi-teams`) and other packages automatically. `TaskExecute` is expected to work directly against `@tintinweb/pi-subagents` without a custom bridge.

## What's Included

### Extensions (11)

Custom tools that register into pi's tool system:

| Extension | Purpose |
|-----------|---------|
| `setup-global-agents` | Auto-installs `~/.pi/agent/AGENTS.md` on first run (non-destructive) |
| `copilot-provider` | GitHub Copilot provider with rate-limit fallback |
| `usage-tracker` | Token usage tracking via `/usage` command |
| `guardrails` | Bounded safety guardrails for agent behavior |
| `tilth` | Tree-sitter AST-aware code search and smart file reading |
| `lsp` | Language Server Protocol integration (definition, references, hover) |
| `memory` | Persistent knowledge pipeline (observations, distillations, handoffs) |
| `dcp` | Dynamic context pruning — compress conversation to stay under token limits |
| `context7` | Library documentation lookup |
| `exa-search` | Web and code search via Exa AI |
| `grepsearch` | Real-world code examples from GitHub via grep.app |

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

### Prompts (24)

Slash-command workflows in `.pi/prompts/`:

`/init` `/plan` `/design` `/create` `/ship` `/review` `/review-codebase` `/research` `/test` `/fix` `/refactor` `/explain` `/commit` `/pr` `/verify` `/status` `/start` `/resume` `/handoff` `/lfg` `/compound` `/ui-review` `/init-context` `/init-user`

### Skills (75)

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

On first session start, pikit auto-installs `~/.pi/agent/AGENTS.md` if it doesn't exist. This file contains universal rules (tone, execution approach, tool priorities, edit protocol) that stack into every project.

The template lives at `.pi/templates/AGENTS.md`. To update after install:

```bash
cp .pi/templates/AGENTS.md ~/.pi/agent/AGENTS.md
```

To customize, edit `~/.pi/agent/AGENTS.md` directly — it's your personal config, not overwritten on updates.

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
