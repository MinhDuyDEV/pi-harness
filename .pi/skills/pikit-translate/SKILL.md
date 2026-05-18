---
name: pikit-translate
description: >-
  Translates articles and documents between languages with three modes — quick
  (direct), normal (analysis-informed), and refined (full publication-quality
  workflow with review and polish). Supports custom glossaries and
  terminology consistency via config.md. Use when user asks to "translate",
  "翻译", "convert to Chinese", "localize", or any document translation task.
version: 1.0.0
tags: [translation, i18n, localization, content]
agent_types: [planner, worker, reviewer]
metadata:
  requires:
    anyBins:
      - bun
      - npx
---

# Pikit Translator

> Three-mode translation skill: **quick** for direct translation, **normal** for analysis-informed translation, **refined** for full publication-quality workflow with review and polish.

## User Input Tools

When this skill prompts the user, follow this tool-selection rule (priority order):

1. **Prefer built-in user-input tools** exposed by the current agent runtime — e.g., Pi `AskUserQuestion`, Codex `clarify`, or any equivalent.
2. **Fallback**: if no such tool exists, emit a numbered plain-text message and ask the user to reply with the chosen number/answer for each question.
3. **Batching**: if the tool supports multiple questions per call, combine all applicable questions into a single call; if only single-question, ask them one at a time in priority order.

Concrete `AskUserQuestion` references below are examples — substitute the local equivalent in other runtimes.

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `{baseDir}`
2. Script path = `{baseDir}/scripts/main.ts`
3. Resolve `${BUN_X}` runtime:
   - If `bun` installed → `bun`
   - If `npx` available → `npx -y bun`
   - Else suggest `brew install oven-sh/bun/bun` or `npm install -g bun`
4. Replace all `{baseDir}` and `${BUN_X}` in this document with actual values

**Script Reference**:

| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | CLI entry point. Splits source content into chunks at markdown block boundaries. |

## Step 0: Load Preferences ⛔ BLOCKING

This step MUST complete before any translation — execution is blocked until preferences are loaded.

### Config Paths (priority order)

Check these paths in order; first hit wins.

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `.pi/skills/pikit-translate/config.md` | Project (lives alongside SKILL.md) |
| 2 | `~/.pi/agent/config/skills/pikit-translate.md` | User home |

### On Found

- Read, parse, apply settings
- On first use in session, briefly remind: "Using preferences from [path]. You can edit config.md to customize target language, glossary, etc."

### On Not Found

**Must** run first-time setup (see below) — do NOT silently use defaults.

### First-Time Setup (BLOCKING)

When config.md is not found, you **MUST** run first-time setup before ANY translation. This is a **BLOCKING** operation.

Collect ALL required preferences via `AskUserQuestion` in ONE call (batch all questions):

1. **Target language** — What language to translate into? (default: `vi-VN`)
2. **Default mode** — quick, normal, or refined? (default: `normal`)
3. **Audience** — general, technical, academic, or business? (default: `general`)
4. **Style** — storytelling, formal, technical, literal, conversational? (default: `storytelling`)

After user answers, save config.md to `.pi/skills/pikit-translate/config.md`, confirm "Preferences saved to [path]", then continue.

### Config Schema

See `references/config-schema.md` for full schema.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `target_language` | string | `vi-VN` | Target language code |
| `default_mode` | enum | `normal` | Translation mode: `quick`, `normal`, `refined` |
| `audience` | string | `general` | Target reader profile |
| `style` | string | `storytelling` | Translation style/v0ice |
| `chunk_threshold` | number | `4000` | Word count to trigger chunked parallel mode |
| `chunk_max_words` | number | `5000` | Max words per chunk |
| `glossary` | object | `{}` | Term → translation overrides |

## Modes

| Mode | Flag | Steps | When to Use |
|------|------|-------|-------------|
| Quick | `--mode quick` | Translate only | Short texts, informal, quick tasks |
| Normal | `--mode normal` | Analyze → Translate | Articles, blog posts, general content |
| Refined | `--mode refined` | Analyze → Draft → Review → Revise → Polish | Publication-quality, important documents |

**Auto-detect**: User says "quick" or "快翻" → quick mode. "refined" or "精翻" → refined mode. Otherwise → default mode from config.

**Upgrade prompt**: After normal mode completes, offer to continue with review + polish (refined steps 4-6).

## Translation Principles

Apply to all modes:

- **Rewrite, not translate**: Produce natural target-language text as if a skilled native writer composed it from scratch.
- **Accuracy first**: Facts, data, and logic must match the original exactly.
- **Natural flow**: Use idiomatic word order. Break long source sentences. Interpret metaphors by intended meaning, not word-for-word.
- **Terminology**: Use standard translations consistently. First occurrence of specialized terms: annotate with original in parentheses.
- **Preserve format**: Keep all markdown formatting (headings, bold, italic, images, links, code blocks).
- **Frontmatter**: If source has YAML frontmatter, rename source fields with `source` prefix, add translated values as new fields.

## Workflow

### Step 1: Materialize Source

Read source material: file path, inline text, or URL. Save to `{output-dir}/source.md`. Create output directory: `translate/{slug}-{target-lang}/`.

Detect source language if not specified.

`{output-dir}` defaults to `translate/{source-basename}-{target-lang}/` relative to working directory. Override via `--output` in config or CLI.

### Step 2: Load Glossary

2.1 Load built-in glossary for the language pair (if available).
2.2 Merge with config.md glossary entries (inline terms override built-in).
2.3 If `--glossary <file>` CLI arg is provided, load and merge (CLI overrides config).
2.4 Save merged glossary to `{output-dir}/glossary.md`.

### Step 3: Assess Content Length

Estimate word count of source. For short content (< chunk threshold), translate as single unit. For long content (>= threshold), proceed to chunked translation.

### Step 3a: Long Content — Chunked Parallel Translation

Only for normal/refined mode with content >= chunk_threshold (default 4000 words).

1. **Extract terminology**: Scan entire document for proper nouns, technical terms, recurring phrases.
2. **Build session glossary**: Merge extracted terms with loaded glossaries, establish consistent translations. Save to `{output-dir}/glossary-session.md`.
3. **Split into chunks**: Use `${BUN_X} {baseDir}/scripts/main.ts --input {output-dir}/source.md --output {output-dir}/chunks/`
   - Parses markdown at block boundaries (headings, paragraphs, lists, code blocks)
   - Each chunk target: ~2000 words
   - Saved as `{output-dir}/chunks/chunk-NN.md`
4. **Assemble shared context**: `{output-dir}/02-prompt.md` containing target language, audience, style, glossary, tone analysis, translation challenges.
5. **Spawn subagents** (one per chunk in parallel):
   - Each reads `02-prompt.md` for shared context
   - Each receives its chunk file path
   - Each writes `{output-dir}/chunks/chunk-NN-draft.md`
   - If Agent tool unavailable, translate chunks sequentially inline.
6. **Merge drafts**: Combine all chunk-NN-draft.md in order. Save as `03-draft.md` (refined) or `translation.md` (normal).

### Step 4: Translate (Quick Mode)

1. Translate source directly following translation principles.
2. Save to `{output-dir}/translation.md`.

### Step 4: Analyze + Translate (Normal Mode)

1. **Analyze** → `{output-dir}/01-analysis.md`
   - Domain, tone, terminology assessment
   - Translation challenges (comprehension gaps, figurative language, structural challenges)
2. **Assemble prompt** → `{output-dir}/02-prompt.md`
   - Translation instructions with context, glossary, challenges
3. **Translate** following the prompt → `{output-dir}/translation.md`
4. Offer upgrade: "Translation saved. To review and polish, reply **continue** or **润色**."

### Step 4-6: Full Refined Pipeline

**Step 4: Analyze** → `{output-dir}/01-analysis.md`
- Content summary, terminology table, tone/style assessment, translation challenges

**Step 5: Draft** → `{output-dir}/03-draft.md`
- Translate full content following analysis. From subagent if chunked.

**Step 6: Critical Review** → `{output-dir}/04-critique.md`
- Diagnosis only — no rewriting.
- Check: accuracy, native voice (unnatural phrasing), notes appropriateness, strategy execution.

**Step 7: Revision** → `{output-dir}/05-revision.md`
- Apply all critique findings to produce revised translation.

**Step 8: Polish** → `{output-dir}/translation.md`
- Final pass: read as standalone piece, smooth transitions, consistent voice, formatting check.

### Step 9: Output & Reminder

After final translation is written:

1. Collect image references from translated article.
2. If any images likely contain source-language text (screenshots, diagrams), remind user:
   ```
   Possible image localization needed:
   - ![example](path.png): likely still contains source-language text
   ```
3. Display summary:

```
**Translation complete** ({mode} mode)
Source: {source-path}
Languages: {from} → {to}
Output dir: {output-dir}/
Final: {output-dir}/translation.md
Glossary terms applied: {count}
```

## Output Artifacts

All intermediate files are preserved for inspection and resumption.

| File | Mode | Description |
|------|------|-------------|
| `source.md` | All | Normalized source material |
| `glossary.md` | All | Merged glossary |
| `glossary-session.md` | Chunked | Session glossary with extracted terms |
| `01-analysis.md` | Normal, Refined | Content analysis |
| `02-prompt.md` | Normal, Refined | Translation prompt with context |
| `03-draft.md` | Refined | Initial draft |
| `04-critique.md` | Refined | Critical review findings |
| `05-revision.md` | Refined | Revised translation |
| `translation.md` | All | Final translation |
| `chunks/` | Chunked | Source chunks `chunk-NN.md` + translated `chunk-NN-draft.md` |

## References

| File | Content |
|------|---------|
| `references/config-schema.md` | Full config.md schema definition |
| `references/pipeline-architecture.md` | Detailed pipeline explanation with subagent pattern |

## Extension Support

Custom configurations via config.md. See **Step 0** for paths and supported options.
