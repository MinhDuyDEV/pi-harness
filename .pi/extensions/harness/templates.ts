/**
 * templates.ts — Harness doc template content strings.
 * Extracted from index.ts for code quality.
 */

export const HARNESS_REQUIRED_DOCS = [
  'docs/HARNESS.md',
  'docs/FEATURE_INTAKE.md',
  'docs/TEST_MATRIX.md',
] as const

export const HARNESS_OPTIONAL_DIRS = [
  'docs/product',
  'docs/stories',
  'docs/decisions',
  'docs/templates',
] as const

export const HARNESS_TEMPLATE_FILES: Record<string, string> = {
  'docs/HARNESS.md': `# Harness

This repository uses a goal/harness loop:

human intent -> intake -> story packet -> agent loop -> product delta -> validation proof -> harness delta -> next goal

## Operating Rules

- Repo-local docs are durable product truth.
- Legacy \`.pi/specs\` entries are compatibility execution state only.
- Every meaningful change should identify affected product docs, story/checkpoint, and validation evidence.
- Prefer one safe action at a time: inspect, classify, act, verify, report next goal.
`,
  'docs/FEATURE_INTAKE.md': `# Feature Intake

Use this checklist before creating or executing work.

## Classify Input

- intake/status
- new feature
- bugfix
- change request
- maintenance
- harness improvement
- clarify

## Risk Flags

- auth or authorization
- data model, migration, or data loss
- audit/security behavior
- external providers
- public contracts
- cross-platform behavior
- weak proof surface
- multi-domain change

## Output

- restated work item
- affected docs/stories
- risk level: tiny | normal | high-risk
- missing information
- next safe action
`,
  'docs/TEST_MATRIX.md': `# Test Matrix

Map product behavior to proof.

| Area | Behavior | Status | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Harness | Goal/harness loop is discoverable | planned | /goal, harness_status | Replace legacy spec command surfaces |

Statuses: planned, in_progress, implemented, changed, retired.
`,
  'docs/templates/story.md': `# Story: <title>

Status: planned

## Product Contract

## Relevant Product Docs

## Acceptance Criteria

## Design Notes

## Validation

| Check | Command / Evidence | Status |
| --- | --- | --- |

## Harness Delta

## Evidence
`,
  'docs/templates/spec-intake.md': `# Spec Intake

## Source

## Project Summary

## Candidate Product Docs

## Candidate Stories

## Architecture Questions

## Validation Shape

## Open Decisions

## First Story Candidates

## Harness Delta
`,
}
