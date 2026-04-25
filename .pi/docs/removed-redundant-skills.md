# Removed Redundant Skills

These skills were removed from the active inventory because their useful behavior was merged into canonical core or optional skills. This file records the removal map; the redundant skill directories are intentionally gone.

| Removed skill | Canonical home |
| --- | --- |
| `code-search-patterns` | Merged into code-navigation and tilth/tilth-cli. |
| `code-simplification` | Merged into code-cleanup. |
| `compaction` | Merged into context-engineering. |
| `context-initialization` | Merged into context-engineering. |
| `context-management` | Merged into context-engineering. |
| `deep-research` | Merged into source-driven-development. |
| `dynamic-context-pruning` | Merged into context-engineering. |
| `executing-plans` | Merged into incremental-implementation and subagent-driven-development. |
| `figma-go` | Merged into figma. |
| `figma-mcp-go` | Merged into figma. |
| `full-output-enforcement` | Moved to policy, not a standalone skill. |
| `memory-grounding` | Merged into memory-system/context-engineering. |
| `pencil` | Merged into openpencil. |
| `prd` | Merged into spec-driven-development. |
| `receiving-code-review` | Merged into code-review-and-quality. |
| `reconcile` | Merged into verification-before-completion and code-review-and-quality. |
| `reflection-checkpoints` | Merged into development-lifecycle and memory-system. |
| `requesting-code-review` | Merged into code-review-and-quality. |
| `session-management` | Merged into context-engineering. |
| `source-code-research` | Merged into source-driven-development/opensrc. |
| `sprint` | Redundant with Pi lifecycle commands. |
| `sprint-plan` | Redundant with planning-and-task-breakdown. |
| `sprint-qa` | Redundant with test-driven-development/verification-before-completion. |
| `sprint-retro` | Redundant with memory-system. |
| `sprint-review` | Redundant with code-review-and-quality. |
| `sprint-ship` | Redundant with shipping-and-launch. |
| `sprint-think` | Redundant with spec-driven-development/brainstorming. |
| `systematic-debugging` | Merged into debugging-and-error-recovery. |
| `using-skills` | Redundant with using-pi-skills. |
| `verification-gates` | Merged into verification-before-completion. |
| `workspace-setup` | Merged into using-git-worktrees. |
| `writing-plans` | Merged into planning-and-task-breakdown. |
| `playwriter` | Removed optional browser automation variant; use playwright unless existing Chrome-session automation becomes a frequent need. |
| `lightpanda` | Removed optional lightweight browser/web reader; use webclaw for scraping or playwright for browser interaction. |
| `sharing-skills` | Removed optional upstream-contribution workflow; use normal git/PR workflow or writing-skills for skill authoring. |
| `testing-skills-with-subagents` | Removed optional skill pressure-testing workflow; merged into writing-skills. |
| `ralph` | Removed optional autonomous-loop workflow; use subagent-driven-development or agent-teams for coordinated autonomy. |
| `mqdh` | Removed optional Meta Quest/XR integration; restore only if Quest development becomes active. |
| `v1-run` | Removed optional npm package-health integration; use source-driven-development plus normal package audit tools. |
| `agent-browser` | Merged into playwright as the canonical browser automation/testing skill. |
| `stitch-design-taste` | Merged into stitch as Stitch-specific design-quality guidance. |
| `html-design-prototyping` | Merged into frontend-design as the non-production HTML prototype mode. |
| `web-design-guidelines` | Merged into accessibility-audit and design-system-audit as UI review checklists. |
| `ui-ux-research` | Merged into design-system-audit as existing-pattern and consistency research. |
| `visual-analysis` | Merged into mockup-to-code as screenshot/mockup analysis input workflow. |
| `beads-bridge` | Merged into beads as Beads ecosystem bridge workflow. |
| `prd-task` | Merged into beads as PRD-to-task conversion. |
| `best-of-n` | Merged into agent-teams as a competing-attempts team pattern. |
| `dispatching-parallel-agents` | Merged into agent-teams as parallel investigation/fan-out mode. |
| `swarm-coordination` | Merged into agent-teams as large-plan swarm coordination mode. |
| `skill-creator` | Merged into writing-skills as canonical skill-authoring workflow. |
| `index-knowledge` | Merged into context-engineering and documentation-and-adrs as knowledge-base generation. |
| `finishing-a-development-branch` | Merged into shipping-and-launch as branch completion/release handoff. |
| `tilth-cli` | Merged into tilth as CLI/subagent mode. |
| `tool-priority` | Removed as a standalone core skill; tool choice is now covered by AGENTS.md policy plus code-navigation, source-driven-development, context-engineering, and tool-specific skills. |
