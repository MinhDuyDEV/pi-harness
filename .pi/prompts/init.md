---
description: Initialize core project setup (AGENTS.md + tech-stack detection only)
---

# Init: $@

Core project setup. Creates AGENTS.md and detects tech stack. Run once per project.

> **Next steps:** `/init-user` for personalization, `/init-context` for GSD planning workflow

## Options

| Argument | Default | Description                               |
| -------- | ------- | ----------------------------------------- |
| `--deep` | false   | Comprehensive research (~100+ tool calls) |

## Phase 1: Detect Project

Detect and validate:

- Package manager and dependencies (with versions)
- Build, test, lint, dev commands — **validate each actually works**
- CI/CD configuration
- Existing AI rules (`.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`)
- Top-level directory structure

With `--deep`: Also analyze git history, source patterns, subsystem candidates.

## Phase 2: Preview Detection

After detecting the project, show a summary of the detected tech stack. Ask the user to choose:

1. Proceed and create AGENTS.md
2. See what will be written first (display detected values without writing files, then ask again)
3. Cancel

Wait for the user's choice before creating any files.

## Phase 3: Create AGENTS.md

Create `./AGENTS.md` — **target <60 lines** (max 150). Include:

- Tech stack with versions
- File structure
- Commands (validated)
- Code example from actual codebase (5-10 lines)
- Testing conventions
- Boundaries (always/ask-first/never)
- Gotchas

**Principles**: Examples > explanations. Pointers > copies. If AGENTS.md exists, improve it — don't overwrite blindly.

## Phase 4: Create tech-stack.md

Create `docs/tech-stack.md` with detected values:

- Framework, language, runtime
- Styling, components, design system
- Database, ORM, state management
- Testing tools
- Verification commands

```bash
mkdir -p docs
```

## Phase 5: Subsystems (--deep only)

Identify candidates for nested AGENTS.md:

- `packages/*/` in monorepos
- `frontend/` vs `backend/` directories
- Significantly different subsystem patterns

Ask user before creating nested files.

## Phase 6: Verify and Report

Verify:

- [ ] AGENTS.md is <60 lines (or justified)
- [ ] Commands validated and work
- [ ] Boundaries include Never rules
- [ ] Code example from actual codebase
- [ ] tech-stack.md created in `docs/`

Output:

1. Files created (with line counts)
2. Tech stack detected
3. Commands validated (yes/no)
4. Suggested next steps:
   - `/init-user` — Create user profile
   - `/init-context` — Set up GSD planning workflow
   - `/review-codebase` — Deep codebase analysis
