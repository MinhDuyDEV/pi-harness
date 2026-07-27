---
name: documentation-and-adrs
description: Single source of truth for ADR format, plus doc structure and doc-sync rules. Use when writing an ADR, README, runbook, or postmortem, or when docs have drifted from code.
metadata:
  version: 1.0.0
  tags:
  - workflow
  - code-quality
  dependencies: []
---

# Documentation & ADRs

## When to Use

Project docs (README, contributing, onboarding); real architectural decisions (ADR); design docs that outlive the conversation; postmortems; runbooks.

## When NOT to Use

Doc is a code comment; no real decision was made; "let me document this" without audience; ephemeral context (use chat).

## Doc Hierarchy

```
README.md          ← first thing. What is this, who is it for, how to use it.
ARCHITECTURE.md    ← system shape, modules, data flow.
docs/
  adr/             ← WHY we chose X over Y.
  guides/          ← task-oriented.
  runbooks/        ← operational.
  postmortems/     ← incident retrospectives.
```

Don't mix levels. A guide is not an ADR. A runbook is not a guide.

## ADR Format (canonical)

This is the single ADR definition in this repo. The `DECISIONS.md` blocks described by `artifact-format` use the same fields in short form.

```markdown
# ADR-NNN: Title

**Status:** proposed | accepted | deprecated | superseded by ADR-XXX
**Date:** YYYY-MM-DD
**Context:** [What is the situation? What forces are at play?]
**Decision:** [What did we choose?]
**Consequences:** [What becomes easier? What becomes harder? What did we give up?]
**Alternatives considered:** [What else was on the table, and why not?]
```

**Context** and **Consequences** are the most-skipped and most-load-bearing. Without them, the next person can't tell if the decision still applies.

See [references/ADR-FORMAT.md](references/ADR-FORMAT.md) for the lighter-weight variant (1-3 sentence ADRs, lazy `docs/adr/` creation, numbering rules).

## ADR or Not

| Write an ADR | Skip the ADR |
|---|---|
| Two+ viable options with real trade-offs | Only one viable option |
| Hard to reverse | Easy to reverse (do it; document in code) |
| Will be questioned later | Implementation detail (names, signatures) |
| Affects system shape | No real trade-off |

## Keeping Docs in Sync

- Doc-as-code: docs live in the same repo, same review process; update on the same PR as the code change.
- Stale doc = no doc. A wrong doc is worse than no doc.
- Doc rot = 6+ months untouched. Delete or update.

## Red Flags

Doc rot (> 6 months); ADR without context, consequences, or alternatives; ADR for every trivial choice (noise); README without "Why" or tested install commands; runbook without commands; runbooks that assume context; examples that don't run; doc only in chat (lost); "we'll document later"; "comprehensive" doc walls no one reads; no link between doc and code; mixing levels.
