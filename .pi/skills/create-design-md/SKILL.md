---
name: create-design-md
description: Generates or updates DESIGN.md — a normative design-system document — from a repository or a public URL, with
  an evidence pipeline and a one-token-schema rule. User-invoked; load via /skill:create-design-md when a repo's design system
  needs documenting or a reference site's visual system needs capturing.
metadata:
  version: 1.0.0
  tags:
  - design
  - documentation
  dependencies: []
disable-model-invocation: true
---

# Create DESIGN.md

Produces `DESIGN.md`: the repo's normative design document. Read-only toward the product — never modify source, dependencies, or configuration while generating it.

## Two Modes

**Repository mode** (input: local codebase). Read token files, themes, component sources, design docs. Output is *normative*: real token names, component ownership, documented rationale.

**URL mode** (input: public site). Inspect rendered pages at desktop and mobile widths — DOM, computed styles, loaded stylesheets. Output is *observational*: only what is visible and measurable. You cannot establish internal naming or undocumented rationale from a rendered page, so don't invent them.

## Evidence Pipeline

Every candidate value passes through: role → value → source → scope → recurrence → confidence. URL-mode findings need three proofs:

1. **Observation** — visible or computed, not assumed.
2. **Basis** — measured or recurring; one occurrence is an accident, not a system.
3. **Consequence** — it changes an implementation choice.

## Document Shape

Frontmatter (version, name, description, token categories), then Overview, then only the sections the evidence supports: Colors, Themes, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts.

## The Quality Gate

**Outside the Overview, every sentence must change an implementation choice.** If deleting a sentence changes nothing about what a developer builds, delete it. This kills component inventories, generic advice ("use consistent spacing"), and prose restating the YAML.

## One Token Schema

Never let repository or URL evidence introduce a second token schema. Map findings into the canonical field names; reject invented scales. Capture the system, not the inventory — do not copy every discovered token, and do not promote one-off local styling into product intent.

## Prohibitions

- No modification of product source, dependencies, or config.
- No invented brand personality or rationale.
- No citations, audit notes, or unresolved conflicts inside DESIGN.md — report those in chat alongside the file.

## Process

1. Confirm mode (repo path or URL) and whether a DESIGN.md already exists (update vs create).
2. Collect evidence through the pipeline; prefer recurring, high-confidence values.
3. Draft, applying the quality gate and the single token schema.
4. Re-read every sentence outside the Overview against the gate; delete failures.
5. Report sources and conflicts separately from the document.

## Red Flags

A DESIGN.md longer than the system it describes; sentences no implementation depends on; a second naming scheme for tokens; URL mode asserting intent ("the brand favors…"); every token in the codebase transcribed; product source edited while generating the doc.
