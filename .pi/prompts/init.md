---
description: Initialize core project setup — AGENTS.md, tech-stack, git conventions, and vocabulary
argument-hint: "[--deep]"
---

# Init: $ARGUMENTS

Core project setup. Creates AGENTS.md, detects tech stack, establishes git conventions, and sets up project vocabulary. Run once per project.

> **AGENTS.md is the most important context file for AI agents** (Pocock). Getting init right reduces every future ambiguity error.
>
> **Next steps:** `/review-codebase` for deep codebase analysis

## Load Skills

```typescript
skill({ name: "context-engineering" });    // AGENTS.md structure and optimization
skill({ name: "memory-system" });           // Persist detected values
skill({ name: "ubiquitous-language" });     // Establish project vocabulary
skill({ name: "git-workflow-and-versioning" }); // Git conventions
```

## Options

| Argument | Default | Description                               |
| -------- | ------- | ----------------------------------------- |
| `--deep` | false   | Comprehensive research (~100+ tool calls) |

## Before You Init

- **Don't overwrite blindly** — if AGENTS.md exists, improve it, don't replace
- **Validate every command** — test each detected build/test/lint command actually runs
- **Establish vocabulary early** — terms set here become the ubiquitous language for all future agents
- **Keep it minimal** — every line in AGENTS.md is a constraint on future agents. Less is more.

## Phase 1: Detect Project

Detect and validate:

- Package manager and dependencies with versions
- Build, test, lint, dev commands — **validate each actually works**
- CI/CD configuration and conventions
- Existing AI rules (`.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`)
- Git branching strategy and commit conventions
- Top-level directory structure
- Existing domain vocabulary from type names, module names, route names

With `--deep`: Also analyze git history, source patterns, subsystem candidates.

## Phase 2: Preview Detection

After detecting project, show summary and ask for confirmation:

```typescript
ask_user_question({
  questions: [
    {
      header: "Preview",
      question: `Detected: ${detectedTechStack}. Create AGENTS.md?`,
      options: [
        { label: "Yes, create it (Recommended)" },
        { label: "Show me what you'll write first" },
        { label: "Cancel" },
      ],
      multiSelect: false,
    },
  ],
});
```

**If "Show me":** Display detected values without writing files, then ask again.

## Phase 3: Create AGENTS.md

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

## Phase 4: Set Git Conventions

Establish project git conventions based on detected patterns:

- **Branch naming**: `feat/`, `fix/`, `refactor/` prefixes
- **Commit style**: conventional commits (`type(scope): description`)
- **Pre-commit hooks**: if detected, note what they enforce
- **Merge strategy**: squash, merge commit, or rebase

Record these in AGENTS.md under a `## Git` section (2-3 lines max).

## Phase 5: Establish Vocabulary

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

## Phase 6: Create tech-stack.md

From template `.pi/memory/_templates/tech-stack.md`:

Read the template from `.pi/memory/_templates/tech-stack.md` and write it to `.pi/memory/project/tech-stack.md`.

Fill detected values:

- Framework, language, runtime
- Styling, components, design system
- Database, ORM, state management
- Testing tools
- Verification commands

## Phase 7: Detect Broken Windows

Flag any existing issues that should be fixed early (before they normalize):

- Outdated or conflicting linter/formatter configs
- Missing `.gitignore` entries for the detected stack
- Dead CI configuration referencing removed tools
- Mixed conventions (tabs vs spaces, semicolons vs nosemi)
- Untracked generated files in source control

Log findings — don't fix them unless the user asks. This is the "broken windows" principle (Pragmatic Programmer): flagging them early contains the decay.

## Phase 8: Subsystems (--deep only)

Identify candidates for nested AGENTS.md:

- `packages/*/` in monorepos
- `frontend/` vs `backend/` directories
- Significantly different subsystem patterns

Ask user before creating nested files.

## Phase 9: Persist to Memory

Store the init results for cross-session retrieval:

```typescript
observation({
  type: "decision",
  title: "Project init: [name]",
  narrative: "Project setup complete. Tech stack: [detected]. Vocabulary: [key terms]. Branching: [convention].",
  concepts: "project-init, tech-stack, [framework], [language]",
  confidence: "high",
  files_modified: "AGENTS.md, .pi/memory/project/tech-stack.md",
});
```

## Phase 10: Verify and Report

Verify:

- [ ] AGENTS.md is <60 lines (or justified for complexity)
- [ ] Commands validated and actually work
- [ ] Boundaries include explicit Never rules
- [ ] Code example from actual codebase (not hypothetical)
- [ ] Glossary of 5-10 domain terms included
- [ ] Git conventions recorded
- [ ] tech-stack.md created with detected values
- [ ] Broken windows flagged if found
- [ ] Init results persisted to memory

Output:

1. Files created (with line counts)
2. Tech stack detected
3. Commands validated (yes/no per command)
4. Domain terms recorded
5. Git conventions set
6. Broken windows flagged (if any)
7. Suggested next steps:
   - `/review-codebase` — Deep codebase analysis
   - `/create "first feature"` — Start building
