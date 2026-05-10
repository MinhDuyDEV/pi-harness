# Skill Inventory Audit

Current status: **68 active skills** (`33` core, `35` optional).

Pi keeps a small active core and removes redundant workflow skills after their useful behavior is merged into canonical skills.

## Addy Agent-Skills Compatibility

Pi covers the upstream 20 core workflows. Name differences are intentional: `brainstorming` covers `idea-refine`, `frontend-design` covers `frontend-ui-engineering`, and `code-cleanup` covers `code-simplification`.

## Policy

- Core skills define Pi default behavior and lifecycle commands.
- Optional packs are loaded only by trigger, domain, or tool need.
- Removed redundant skills are documented in `docs/removed-redundant-skills.md`; do not restore them unless they regain unique behavior.
- Prefer adding aliases/notes to canonical skills over restoring duplicate active skills.

## Core Skills

- `api-and-interface-design`
- `behavioral-kernel`
- `brainstorming`
- `browser-testing-with-devtools`
- `ci-cd-and-automation`
- `code-cleanup`
- `code-navigation`
- `code-review-and-quality`
- `condition-based-waiting`
- `context-engineering`
- `debugging-and-error-recovery`
- `defense-in-depth`
- `deprecation-and-migration`
- `development-lifecycle`
- `documentation-and-adrs`
- `frontend-design`
- `git-workflow-and-versioning`
- `incremental-implementation`
- `memory-system`
- `performance-optimization`
- `planning-and-task-breakdown`
- `root-cause-tracing`
- `security-and-hardening`
- `shipping-and-launch`
- `source-driven-development`
- `spec-driven-development`
- `structured-edit`
- `subagent-driven-development`
- `test-driven-development`
- `testing-anti-patterns`
- `using-git-worktrees`
- `using-pi-skills`
- `verification-before-completion`

## Optional Packs

### agent-coordination
- `agent-teams`
- `beads`
- `writing-skills`

### browser-automation
- `chrome-devtools`
- `playwright`

### design-tools
- `figma`
- `openpencil`
- `stitch`
- `v0`

### frontend
- `accessibility-audit`
- `design-system-audit`
- `design-taste-frontend`
- `high-end-visual-design`
- `industrial-brutalist-ui`
- `minimalist-ui`
- `mockup-to-code`
- `react-best-practices`
- `redesign-existing-projects`

### integrations
- `cloudflare`
- `core-data-expert`
- `jira`
- `obsidian`
- `pdf-extract`
- `polar`
- `resend`
- `supabase`
- `supabase-postgres-best-practices`
- `swift-concurrency`
- `swiftui-expert-skill`
- `vercel-deploy-claimable`

### research-tools
- `augment-context-engine`
- `gemini-large-context`
- `opensrc`
- `srcwalk` (was: tilth)
- `webclaw`

## Removed Redundant Skills

See `docs/removed-redundant-skills.md`.
