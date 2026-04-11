---
name: documentation-and-adrs
description: Use when writing technical documentation, Architecture Decision Records (ADRs), API docs, or project READMEs — covers documentation structure, ADR format, and keeping docs in sync with code
version: 1.0.0
tags: [workflow, code-quality]
dependencies: []
---

# Documentation & ADRs

> **Replaces** undocumented architectural decisions and stale wiki pages with living documentation that stays close to code

## When to Use

- Making a significant architectural decision that should be recorded
- Writing or updating project documentation (README, guides, API docs)
- Onboarding documentation needs updating
- Code has complex behavior that isn't obvious from reading it

## When NOT to Use

- Code is self-documenting (clear naming, simple logic, typed interfaces)
- Writing comments that restate what the code does (comment the why, not the what)
- Documentation for throwaway prototypes

## Overview

Documentation has two purposes: **decisions** (why things are the way they are) and **usage** (how to use them). ADRs handle the first. Guides, READMEs, and API docs handle the second.

**Core principle:** Document decisions when they're made, not months later when context is lost. Keep docs next to the code they describe.

## Architecture Decision Records (ADRs)

### When to Write an ADR

- Choosing between technologies, frameworks, or approaches
- Establishing a pattern that the team should follow
- Deviating from an existing convention (and why)
- Any decision you'd want to explain to a new team member in 6 months

### ADR Template

```markdown
# ADR-NNN: [Decision Title]

## Status

[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Context

What is the issue we're facing? What constraints exist?
[2-5 sentences describing the problem and constraints]

## Decision

What did we decide to do?
[1-3 sentences stating the decision clearly]

## Alternatives Considered

| Option   | Pros | Cons | Verdict            |
| -------- | ---- | ---- | ------------------ |
| Option A | ...  | ...  | Chosen             |
| Option B | ...  | ...  | Rejected: [reason] |
| Option C | ...  | ...  | Rejected: [reason] |

## Consequences

### Positive

- [Good outcomes]

### Negative

- [Trade-offs accepted]

### Risks

- [Things that could go wrong]
```

### ADR File Location

```
docs/adr/
├── 001-use-typescript.md
├── 002-choose-react-over-vue.md
├── 003-api-versioning-strategy.md
└── template.md
```

**Naming:** `NNN-kebab-case-title.md` — numbered for ordering, kebab-case for readability.

## README Structure

### Minimum Viable README

```markdown
# Project Name

One-line description of what this does.

## Quick Start

[3-5 commands to get running]

## Development

[How to build, test, lint]

## Architecture

[Brief overview or link to docs/]

## Contributing

[Link to CONTRIBUTING.md or inline guide]
```

### README Anti-Patterns

| Anti-Pattern                        | Fix                             |
| ----------------------------------- | ------------------------------- |
| "See wiki for docs" (wiki is stale) | Keep docs in repo, next to code |
| Huge README (>500 lines)            | Split into docs/ directory      |
| No Quick Start section              | First thing a new dev needs     |
| Setup instructions that don't work  | CI should verify setup steps    |

## API Documentation

### In-Code Documentation

````typescript
/**
 * Create a new project workspace.
 *
 * @param name - Project name (1-100 chars, alphanumeric + hyphens)
 * @param options - Configuration options
 * @returns The created project with generated ID
 * @throws {ValidationError} If name is invalid
 * @throws {ConflictError} If project name already exists
 *
 * @example
 * ```typescript
 * const project = await createProject('my-app', { template: 'react' });
 * console.log(project.id); // "proj_abc123"
 * ```
 */
export async function createProject(
  name: string,
  options?: CreateProjectOptions,
): Promise<Project> {
````

### Documentation Comments Rules

| Do                                               | Don't                                |
| ------------------------------------------------ | ------------------------------------ |
| Document the **why**                             | Restate the code as prose            |
| Document **contracts** (inputs, outputs, errors) | Document obvious getters/setters     |
| Document **non-obvious behavior**                | Document every function              |
| Include **examples** for complex APIs            | Write examples for self-evident APIs |

## Keeping Docs in Sync

### Documentation Debt Signals

- README references files that don't exist
- Setup instructions fail on clean checkout
- API docs describe removed/renamed endpoints
- ADRs reference superseded decisions without linking forward

### Automation

```yaml
# CI check: verify docs are not stale
- name: Check links
  run: npx markdown-link-check README.md docs/**/*.md

- name: Verify setup instructions
  run: |
    # Run the Quick Start commands from README
    npm install
    npm run build
    npm test
```

## Common Rationalizations

| Excuse                         | Rebuttal                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| "The code is self-documenting" | Code shows what, not why. Decisions need context.                       |
| "Nobody reads the docs"        | Because the docs are stale. Fresh docs get read.                        |
| "I'll document it later"       | You won't. Context decays faster than you think.                        |
| "ADRs are overhead"            | An ADR takes 10 minutes. Re-debating the decision takes hours.          |
| "We use Notion/Confluence"     | Docs in external tools drift from code. Keep docs in repo.              |
| "Comments get stale"           | So delete stale comments. But contracts and decisions need documenting. |

## Red Flags — STOP

- Architecture changed but no ADR recorded
- README setup instructions haven't been tested in >30 days
- API docs describe behavior that doesn't match implementation
- Decision was made in Slack/meeting with no written record
- New team member can't set up the project from docs alone

## Verification

- [ ] Significant decisions have ADRs with status, context, and alternatives
- [ ] README Quick Start works on a clean checkout
- [ ] API functions with complex behavior have JSDoc with examples
- [ ] No dead links in documentation
- [ ] Docs live in the repo (not external wiki only)

## See Also

- **api-and-interface-design** — API docs are part of the interface contract
- **deprecation-and-migration** — Deprecation decisions warrant ADRs
- **prd** — Product requirements docs (higher-level than ADRs)
