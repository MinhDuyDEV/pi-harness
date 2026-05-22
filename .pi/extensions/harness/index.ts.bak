/**
 * harness extension — entry point.
 *
 * Auto-discovered from .pi/extensions/harness/index.ts by Pi SDK.
 * Provides v2 harness tools (status, intake, init, lint, story, decision, test-matrix)
 * and one /goal slash command.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HARNESS_REQUIRED_DOCS, HARNESS_OPTIONAL_DIRS, HARNESS_TEMPLATE_FILES } from './templates'
import {
  harnessStatusExecute,
  harnessIntakeExecute,
  harnessInitExecute,
  harnessLintExecute,
  storyCreateExecute,
  decisionRecordExecute,
  testMatrixUpdateExecute,
} from './harness-tools'

export default function (pi: ExtensionAPI) {
  // ── v2 harness tools ─────────────────────────────────────────────────────

  pi.registerTool({
    name: 'harness_status',
    label: 'Harness Status',
    description: 'Inspect repo-local harness docs, harness directories, and execution state. Use this before choosing a harness action.',
    promptSnippet: 'Inspect current harness state before acting',
    parameters: Type.Object({
      focus: Type.Optional(Type.String({ description: 'Optional focus area or goal to include in status context' })),
    }),
    execute: harnessStatusExecute,
  })

  pi.registerTool({
    name: 'harness_intake',
    label: 'Harness Intake',
    description: 'Classify a user intent for the goal/harness loop: intent type, risk, missing inputs, and next safe action. Does not mutate files.',
    promptSnippet: 'Classify goal intent, risk, missing inputs, and next safe action',
    parameters: Type.Object({
      intent: Type.String({ description: 'User goal, request, spec, or next action to classify' }),
    }),
    execute: harnessIntakeExecute,
  })

  pi.registerTool({
    name: 'harness_init',
    label: 'Initialize Harness',
    description: 'Scaffold repo-local harness docs and templates. Creates missing files only by default; set overwrite to replace existing harness docs.',
    promptSnippet: 'Scaffold docs/HARNESS.md, FEATURE_INTAKE, TEST_MATRIX, and templates',
    parameters: Type.Object({
      overwrite: Type.Optional(Type.Boolean({ description: 'Overwrite existing harness docs/templates (default: false)' })),
    }),
    execute: harnessInitExecute,
  })

  pi.registerTool({
    name: 'harness_lint',
    label: 'Harness Lint',
    description: 'Check repo-local harness docs for missing required files, stale scaffolding gaps, and validation/test-matrix issues.',
    promptSnippet: 'Audit harness docs, stories, and validation matrix for gaps',
    parameters: Type.Object({}),
    execute: harnessLintExecute,
  })

  pi.registerTool({
    name: 'story_create',
    label: 'Create Story',
    description: 'Create or update a repo-local story packet in docs/stories/. Use after harness_intake when durable product work is needed.',
    promptSnippet: 'Create a story packet with product contract, acceptance criteria, validation, and evidence placeholders',
    parameters: Type.Object({
      title: Type.String({ description: 'Story title' }),
      objective: Type.String({ description: 'Product contract or goal this story should satisfy' }),
      acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: 'Acceptance criteria bullets' })),
      validation: Type.Optional(Type.String({ description: 'Expected command, test, or evidence path' })),
      status: Type.Optional(Type.String({ enum: ['planned', 'in_progress', 'implemented', 'changed', 'retired'], description: 'Story status (default: planned)' })),
      overwrite: Type.Optional(Type.Boolean({ description: 'Overwrite an existing story with the same slug (default: false)' })),
    }),
    execute: storyCreateExecute,
  })

  pi.registerTool({
    name: 'decision_record',
    label: 'Record Decision',
    description: 'Create or update a repo-local decision record in docs/decisions/. Use for architecture, product, or harness tradeoffs.',
    promptSnippet: 'Record a durable decision with context, decision, consequences, and evidence',
    parameters: Type.Object({
      title: Type.String({ description: 'Decision title' }),
      context: Type.String({ description: 'Context or problem being decided' }),
      decision: Type.String({ description: 'Decision made' }),
      consequences: Type.Optional(Type.String({ description: 'Consequences, tradeoffs, or follow-up implications' })),
      status: Type.Optional(Type.String({ enum: ['proposed', 'accepted', 'superseded'], description: 'Decision status (default: accepted)' })),
      overwrite: Type.Optional(Type.Boolean({ description: 'Overwrite an existing decision with the same date/title slug (default: false)' })),
    }),
    execute: decisionRecordExecute,
  })

  pi.registerTool({
    name: 'test_matrix_update',
    label: 'Update Test Matrix',
    description: 'Append one validation row to docs/TEST_MATRIX.md. Use to connect product behavior to proof before or after execution.',
    promptSnippet: 'Append validation coverage to docs/TEST_MATRIX.md',
    parameters: Type.Object({
      area: Type.String({ description: 'Product or harness area' }),
      behavior: Type.String({ description: 'Behavior being validated' }),
      status: Type.String({ enum: ['planned', 'in_progress', 'implemented', 'changed', 'retired'], description: 'Validation status' }),
      evidence: Type.String({ description: 'Command, test, file path, or evidence reference' }),
      notes: Type.Optional(Type.String({ description: 'Optional notes' })),
    }),
    execute: testMatrixUpdateExecute,
  })

  // ── /goal slash command ──────────────────────────────────────────────────
  // Cast to any because Pi's type for registerCommand doesn't reflect the
  // runtime behavior where returning { prompt: string } queues a prompt.

  const goalCommand = {
    description: 'Set or view the current goal for the goal/harness loop. Inspects, classifies, acts, verifies, and reports next step.',
    handler: async (argsString: string, ctx: { cwd?: string }) => {
      const cwd = ctx.cwd ?? ''
      const intent = (argsString ?? '').trim()

      const requiredDocs = HARNESS_REQUIRED_DOCS.map((doc) => {
        const absPath = path.join(cwd, doc)
        const exists = existsSync(absPath)
        return { path: doc, exists, bytes: exists ? readFileSync(absPath, 'utf-8').length : 0 }
      })
      const dirs = HARNESS_OPTIONAL_DIRS.map((dir) => {
        const absDir = path.join(cwd, dir)
        let files: string[] = []
        if (existsSync(absDir)) {
          files = readdirSync(absDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
            .map((entry) => path.posix.join(dir, entry.name))
            .sort()
        }
        return { path: dir, files }
      })
      const missingDocs = requiredDocs.filter((doc) => !doc.exists).map((doc) => doc.path)
      const summary = [
        'Harness status',
        '',
        `Required docs: ${requiredDocs.filter((d) => d.exists).length}/${requiredDocs.length} present`,
        ...requiredDocs.map((d) => `- ${d.exists ? '✓' : '×'} ${d.path}${d.bytes ? ` (${d.bytes} bytes)` : ''}`),
        '',
        'Harness directories:',
        ...dirs.map((d) => `- ${d.path}: ${d.files.length} markdown file(s)`),
        ...(missingDocs.length
          ? [`\nMissing docs: ${missingDocs.join(', ')}`]
          : ['']),
      ].join('\n')

      const goalDetail = intent ? `\n\nUser intent: ${intent}` : ''

      return {
        prompt: `Run the Pi/OpenPi goal-harness while-loop for this user intent:

${intent || 'Inspect the active goal/harness state and recommend the next safe action.'}

Goal contract:
- Treat this as a durable objective with a verifiable stopping condition.
- Preserve the full objective. If it cannot be finished now, make concrete progress and leave the next step explicit.
- Work from current-state evidence before claiming progress.
- Completion is unproven until every explicit requirement has authoritative evidence.

Current harness state: ${summary}${goalDetail}

Prefer repo-local harness docs as durable product truth when present: docs/HARNESS.md, docs/FEATURE_INTAKE.md, docs/TEST_MATRIX.md, docs/product/, docs/stories/, docs/decisions/, docs/templates/.

Use harness_status, harness_intake, harness_init, harness_lint, story_create, decision_record, and test_matrix_update as the primary v2 tools.

Loop contract:
1. Inspect state first: use harness_status unless exact state is already visible in this turn.
2. Classify the intent with harness_intake unless the classification is already obvious and low-risk.
3. Classify risk before acting: tiny, normal, or high-risk.
4. If required inputs are missing or ambiguous, ask one targeted clarification question instead of guessing.
5. Choose exactly one next safe action at a time.
6. For create/intake requests, prefer harness_init, harness_intake, story_create, decision_record, test_matrix_update, and repo-local artifacts.
7. For implementation/task execution, read the relevant docs/story first and finish with test_matrix_update, harness_lint, or validation-evidence summary.
8. Preserve OpenPi authority boundaries.
9. Final response must be concise: classification, action taken, files/tools touched, current status/evidence, and next suggested /goal intent.`,
      }
    },
  }

  pi.registerCommand('goal', goalCommand as any)
}
