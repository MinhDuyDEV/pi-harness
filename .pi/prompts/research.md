---
description: Research a topic — explore alternatives and gather evidence; optionally append findings to a work session block in `<repo-root>/.pi/artifacts/PROGRESS.md`
argument-hint: "<topic> [--quick|--thorough] [--alternatives] [--into=<title>]"
---

# Research: $ARGUMENTS

Resolve `<repo-root>` before using any durable path below: prefer the Git top-level containing both `package.json` and `.pi`; if Git fails or validation fails, walk ancestors from the current directory for that pair. Stop if none exists, then use absolute `<repo-root>/.pi/...` paths.

Gather information before implementation. Standalone research (no work session) reports inline.

## 1. Parse Arguments

| Argument | Default | Description |
| --- | --- | --- |
| `<topic>` | required | Research question or topic |
| `--quick` | false | Narrow pass (~10 tool calls) |
| `--thorough` | false | Comprehensive (~100+ tool calls) |
| `--alternatives` | false | Generate 2-3 structured options with tradeoffs |
| `--into=<title>` | none | Append `#### Research` subsection to the work session with this title in `PROGRESS.md` |

## 2. Prior Context (one bounded pass)

If DCP is loaded, use `dcp_recall` once with the topic. Otherwise inspect relevant `<repo-root>/.pi/artifacts/` files and the current conversation. Cite relevant prior evidence and do not repeat what is already known.

## 3. Research (depth by flag)

| Flag | Tool budget | Source priority |
| --- | --- | --- |
| (default) | ~30 | codebase → official docs → package source → web |
| `--quick` | ~10 | codebase → official docs only |
| `--thorough` | ~100+ | codebase → docs → source → examples → web → arxiv/standards if relevant |

Cite each finding with the source. Distinguish "verified" (read the source) from "reported" (web claim, not verified).

## 4. Alternatives (with `--alternatives`)

Generate 2-3 options. For each:

```markdown
## Option N: <name>
**Approach:** <one sentence>
**Pros:** <list>
**Cons:** <list>
**Effort:** <S/M/L>
**Risk:** <S/M/L>
```

End with a recommendation and reasoning.

## 5. Portable artifact lookup

Use the harness semantic search tool when available (`semantic_grep`/`semantic_query`). Otherwise use the host repository's available text search. Do not assume `rg`, npm, a JavaScript repository, or package-relative script paths exist in the consumer.

## 6. Output

### Standalone (no `--into`)

Report inline:

1. **Track and depth** — `--quick` / default / `--thorough`
2. **Questions answered** — with confidence (high/medium/low)
3. **Key findings** — with evidence and source citations
4. **Open items** — what couldn't be answered
5. **Recommendation** (with `--alternatives`)
6. **Next step** — `/create <title>`, `/plan <title>`, or just proceed

### With `--into=<title>`

Update the work session block in `PROGRESS.md`:

- If the block exists, append or update only its `#### Research` subsection. Preserve the existing `status:` exactly; never downgrade `awaiting-verification` or `done` to `active`.
- If the block does not exist, create one with `status: active | updated: YYYY-MM-DD`, then add `#### Research`.
- Do not create a second block with the same date/title. Report the anchor and whether the block was appended or created.

## Related Commands

| Need | Command |
| --- | --- |
| Create a work session | `/create <title>` |
| Plan after research | `/plan <title>` |
