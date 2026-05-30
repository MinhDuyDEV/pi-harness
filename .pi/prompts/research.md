---
description: Research a topic or file-backed work item before implementation
argument-hint: "<topic-or-work-id> [--quick|--thorough]"
agentType: scout
---

# Research: $ARGUMENTS

Gather information before implementation. Find answers, document findings, stop when evidence is sufficient.

## Load Skills

```typescript
skill({ name: "memory-system" });
skill({ name: "behavioral-kernel" });
skill({ name: "source-driven-development" });
```

## Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<topic-or-work-id>` | required | Research topic or directory under `.pi/plans/` |
| `--quick` | false | Narrow pass, one concrete question |
| `--thorough` | false | Comprehensive source-backed analysis |

Default depth: enough direct evidence to unblock planning or implementation.

## Determine Input Type

| Input | Detection | Action |
| --- | --- | --- |
| Work ID | `.pi/plans/$ARGUMENTS/` exists | Research in that work context and write `RESEARCH.md` |
| Topic | otherwise | Standalone research and report inline unless asked to save |

## Before You Research

- State the concrete question first.
- Define the evidence threshold for “enough to proceed”.
- Prefer source priority: codebase → official docs → source code → examples → web.
- Stop when answers reach medium+ confidence.
- Do not use hidden orchestration; if fresh context is needed, write a brief file and run explicit tmux/print mode.

## Phase 1: Load Context

If this is a work ID:

```bash
WORK_DIR=.pi/plans/$ARGUMENTS
find "$WORK_DIR" -maxdepth 2 -type f | sort
[ -f "$WORK_DIR/SPEC.md" ] && sed -n '1,220p' "$WORK_DIR/SPEC.md"
[ -f "$WORK_DIR/PLAN.md" ] && sed -n '1,220p' "$WORK_DIR/PLAN.md"
```

Search memory for relevant decisions, warnings, and failed approaches. Use findings to narrow scope and avoid contradictions.

## Phase 2: Research Sources

1. **Codebase patterns** — `srcwalk_search`, `srcwalk_files`, `srcwalk_deps`, `grep`.
2. **Official docs** — `context7` for API references when available.
3. **Source code** — `opensrc` or package source when docs are insufficient.
4. **Real-world examples** — `codesearch` / `grepsearch`.
5. **Web** — only if the above tiers do not answer.

For internal codebase research, cite file paths and line numbers. For external research, cite docs/source URLs or package versions.

## Phase 3: Optional Visible Self-Spawn

Use only when the research is independent and large enough to benefit from fresh context:

```bash
mkdir -p .pi/plans/$ARGUMENTS
cat > .pi/plans/$ARGUMENTS/RESEARCH-BRIEF.md <<'EOF'
[question, constraints, sources already checked, required output]
EOF
pi --name "research-$ARGUMENTS" --print-turn "Read .pi/plans/$ARGUMENTS/RESEARCH-BRIEF.md and write findings to .pi/plans/$ARGUMENTS/RESEARCH.md"
```

Afterward, read the output and verify claims before relying on it.

## Phase 4: Document

If `.pi/plans/$ARGUMENTS/` exists, write `.pi/plans/$ARGUMENTS/RESEARCH.md`:

```markdown
# Research: $ARGUMENTS

## Questions
| Question | Answer | Confidence | Evidence |
| --- | --- | --- | --- |

## Findings
- [Finding with source]

## Recommendation
- [What to do next]

## Open Items
- [Unresolved risk/question]
```

If there is no work directory, report inline unless the user asks for a saved artifact.

## Output

Report:

1. Depth and source count.
2. Questions answered/partial/unanswered with confidence.
3. Key findings with evidence.
4. Open items.
5. Next command: `/create`, `/plan <id>`, or `/ship <id>`.
