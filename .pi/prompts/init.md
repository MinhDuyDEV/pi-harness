---
description: Initialize project setup — AGENTS.md, tech-stack, planning context, user profile, and vocabulary
argument-hint: "[--deep] [--context|--user|--all]"
---

# Init: $ARGUMENTS

Resolve `<repo-root>` before using any durable path below: prefer the Git top-level containing both `package.json` and `.pi`; if Git fails or validation fails, walk ancestors from the current directory for that pair. Stop if none exists, then use absolute `<repo-root>/.pi/...` paths.

Initialize project setup. Run once per project.

> **AGENTS.md is the most important context file for AI agents** (Pocock). Getting init right reduces every future ambiguity error.
>
> **Next step for fresh projects:** `/create "first feature"` to start building.
> **Next step for existing codebases:** `/create "review-existing-code"`, then `/plan review-existing-code`; `/verify` is only valid after that work session has been shipped.

## Load Skills

Load these available skills using the current session's skill-loading instructions. If no dedicated loader is exposed, read each skill's listed `SKILL.md` file.

- skill: `brainstorming`
- skill: `shipping-and-launch`
- skill: `verification-before-completion`

## Idempotency Rules

| File | Rule |
|---|---|
| `AGENTS.md` | Improve in-place — never overwrite blindly |
| `<repo-root>/.pi/memory/project/tech-stack.md` | Overwrite with detected values (auto-regenerated) |
| `<repo-root>/.pi/memory/project/roadmap.md` | Skip if exists, ask before overwrite |
| `<repo-root>/.pi/memory/project/user.md` | Skip if exists, ask before overwrite |

## Parse Arguments

| Argument | Default | Description |
|---|---|---|
| `--deep` | false | Comprehensive research for AGENTS.md (~100+ tool calls) |
| `--context` | false | Init planning context (roadmap.md, state.md) |
| `--user` | false | Init user profile (user.md) |
| `--all` | false | Full init: AGENTS.md + context + user profile |

**Mode rules:**
- No flags (default): Core project setup — AGENTS.md + tech-stack.md + vocabulary + git conventions
- `--context`: Planning context (roadmap.md, state.md)
- `--user`: User profile (user.md)
- `--all`: Everything
- `--deep` applies to AGENTS.md generation only

**Brownfield auto-detection:** Existing codebase = any `src/`, `lib/`, or `app/` directory with source files. Affects Mode 1 discovery scope.

## Before You Init

- Don't overwrite blindly — if AGENTS.md exists, improve it, don't replace
- Validate every command — test each detected build/test/lint command actually runs
- Establish vocabulary early — terms set here become the ubiquitous language for all future agents
- Keep it minimal — every line in AGENTS.md is a constraint on future agents. Less is more

---

## Mode 1: Core Setup (Default)

### Phase 1: Detect Project

Detect and validate:

- Package manager, dependencies (with versions)
- Build, test, lint, dev commands — **validate each actually works**
- CI/CD configuration and conventions
- Existing AI rules (`.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`)
- Git branching strategy and commit conventions
- Top-level directory structure
- Existing domain vocabulary from type names, module names, route names

With `--deep`:
- Analyze git history (last 50 commits for patterns)
- Map source directory structure and subsystem candidates
- Identify common patterns (error handling, logging, data flow)
- Detect testing patterns and coverage gaps

### Phase 2: Preview Detection

After detecting project, show summary and ask for confirmation:

Use the loaded `ask_user` tool for one choice question: create both files (recommended), create only `AGENTS.md`, or cancel. Include the detected stack in the form intro and wait for the answer before writing. If `ask_user` is unavailable or the session is non-TUI, ask the same choices as a numbered plain-text question and wait.

### Phase 3: Create AGENTS.md

Create `./AGENTS.md` — **target <60 lines** (max 150). Keep it index-style and concise:

- Tech stack with versions
- Key domain vocabulary and their code symbols (start the ubiquitous language)
- File structure with entry points
- Commands (validated) — build, test, lint, dev, typecheck
- Code example from actual codebase (5-10 lines showing typical patterns)
- Testing conventions (framework, where tests live, how to run single test)
- Boundaries (always/ask-first/never)
- Gotchas specific to this project
- Git conventions (branch naming, commit style)

**Principles**: Examples > explanations. Pointers > copies. Every line must earn its place — if an AI agent doesn't need to know it, don't put it in AGENTS.md.

If AGENTS.md exists, improve it — never overwrite blindly.

### Phase 4: Create tech-stack.md

Write detected values to `<repo-root>/.pi/memory/project/tech-stack.md`:

```markdown
# Tech Stack

- **Framework:** [framework vX]
- **Language:** [language vX]
- **Runtime:** [runtime vX]
- **Styling:** [styling solution]
- **Components:** [component library]
- **Database:** [database/ORM]
- **State Management:** [tool]
- **Testing:** [framework vX]
- **Build:** `<validated command or "not configured">`
- **Test:** `<validated command or "not configured">`
- **Lint:** `<validated command or "not configured">`
- **Typecheck:** `<validated command or "not configured">`
- **Dev:** `<validated command or "not configured">`
```

### Phase 5: Set Git Conventions

Establish project git conventions based on detected patterns:

- **Branch naming**: `feat/`, `fix/`, `refactor/` prefixes
- **Commit style**: conventional commits (`type(scope): description`)
- **Pre-commit hooks**: if detected, note what they enforce
- **Merge strategy**: squash, merge commit, or rebase

Record these in AGENTS.md under a `## Git` section (2-3 lines max).

### Phase 6: Establish Vocabulary

Extract and record the project's key domain terms as the start of a ubiquitous language:

```bash
# Extract candidate terms from type definitions
grep -rn "^export (type|interface|class|enum)" src/ --include='*.ts' 2>/dev/null | head -20

# Extract module directories that correspond to domain concepts
ls -d src/*/ 2>/dev/null | xargs -I{} basename {} | sort -u
```

Record 5-10 key terms in AGENTS.md as a `## Glossary` section (1-2 lines each):

```markdown
## Glossary
- **Order** = src/orders/Order.ts — purchase request
- **Invoice** = src/billing/Invoice.ts — billing record
```

This directly reduces the "AI does the wrong thing" failure mode (Pocock).

### Phase 7: Detect Broken Windows

Flag any existing issues that should be fixed early (before they normalize):

- Outdated or conflicting linter/formatter configs
- Missing `.gitignore` entries for the detected stack
- Dead CI configuration referencing removed tools
- Mixed conventions (tabs vs spaces, semicolons vs nosemi)
- Untracked generated files in source control

**Do not fix them** — just log findings. This is the "broken windows" principle (Pragmatic Programmer): flagging early contains the decay.

### Phase 8: Subsystem Candidates (`--deep` only)

Identify candidates for nested AGENTS.md files:

- `packages/*/` in monorepos
- `frontend/` vs `backend/` directories
- Significantly different subsystem patterns

Ask user before creating nested files.

### Phase 9: Persist to Memory

Record the verified stack, vocabulary, conventions, and modified paths in the files created by this workflow. If the loaded learning runtime captures verified file and workflow signals, let those hooks observe the work; do not fabricate a memory tool call.

---

## Mode 2: Planning Context (`--context`)

Initialize project planning context with roadmap and state files.

### Phase 1: Discovery (brownfield)

If the project has existing code (brownfield — see auto-detection above), analyze:

```bash
git log --oneline -30
git branch --show-current
find . -maxdepth 3 -type f | sed 's#^./##' | grep -v node_modules | sort | head -200
```

Search memory for prior decisions, roadmap items, known constraints.

### Phase 2: Requirements Gathering

Use one `ask_user` form with three related questions: a text question for the 1–2 sentence vision, a multi-choice question for target users (developers, end users, internal team), and a multi-choice question for success criteria (stability, speed, UX, maintainability). Use stable ids/values, explain trade-offs in option details where useful, and wait for the complete result. If `ask_user` is unavailable or the session is non-TUI, ask the same questions in one numbered plain-text message and wait.

### Phase 3: Create Files

Create `<repo-root>/.pi/memory/project/roadmap.md`:

```markdown
# Roadmap

## Vision
[1-2 sentences from user]

## Target Users
- ...

## Feature Roadmap
- ...
```

Create `<repo-root>/.pi/memory/project/state.md`:

```markdown
# State

## Current Status
Initial setup

## Active Decisions
(none)

## Next Priorities
- ...
```

---

## Mode 3: User Profile (`--user`)

Create personalized user profile at `<repo-root>/.pi/memory/project/user.md`.

### Phase 1: Gather Preferences

Use one `ask_user` form with a text question for name/role, a single-choice communication preference (concise recommended, detailed, mixed), and a single-choice git preference (ask first recommended, auto-commit). Use stable ids/values and wait before writing `user.md`. If `ask_user` is unavailable or the session is non-TUI, ask the same questions in one numbered plain-text message and wait.

### Phase 2: Create user.md

Write to `<repo-root>/.pi/memory/project/user.md` with the captured preferences.

---

## Mode 4: Verify and Report

Before claiming done, verify mode-specific checks:

### Core Setup (default)
- [ ] AGENTS.md is <60 lines (or justified for complexity)
- [ ] Commands validated and actually work
- [ ] Boundaries include explicit Never rules
- [ ] Code example from actual codebase (not hypothetical)
- [ ] Glossary of 5-10 domain terms included
- [ ] Git conventions recorded
- [ ] tech-stack.md created with detected values
- [ ] Broken windows flagged if found
- [ ] Init results persisted to memory

### Planning Context (`--context`)
- [ ] roadmap.md created
- [ ] state.md created

### User Profile (`--user`)
- [ ] user.md created with preferences

Output:

1. Mode executed and files created (with line counts)
2. Tech stack detected
3. Commands validated (yes/no per command)
4. Domain terms recorded
5. Git conventions set
6. Broken windows flagged (if any)
7. Suggested next steps:
   - `/create "review-existing-code"` then `/plan review-existing-code` — Review or add coverage in a valid work session
   - `/create "first-feature"` — Start building with a spec
