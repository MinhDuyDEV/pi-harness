/**
 * harness-tools.ts — Harness v2 tool helpers and execute implementations.
 * Extracted from index.ts for code quality.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HARNESS_OPTIONAL_DIRS, HARNESS_REQUIRED_DOCS, HARNESS_TEMPLATE_FILES } from './templates'

// ── Path helpers ─────────────────────────────────────────────────────────────

function harnessPath(cwd: string, relPath: string): string {
  return path.join(cwd, relPath)
}

// ── Doc inspection ───────────────────────────────────────────────────────────

export type HarnessDocStatus = {
  path: string
  exists: boolean
  bytes?: number
}

function getDocStatus(cwd: string, relPath: string): HarnessDocStatus {
  const absPath = harnessPath(cwd, relPath)
  if (!existsSync(absPath)) return { path: relPath, exists: false }
  return { path: relPath, exists: true, bytes: readFileSync(absPath, 'utf-8').length }
}

function listMarkdownFiles(cwd: string, relDir: string): string[] {
  const absDir = harnessPath(cwd, relDir)
  if (!existsSync(absDir)) return []
  return readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.posix.join(relDir, entry.name))
    .sort()
}

// ── Classification ───────────────────────────────────────────────────────────

function classifyHarnessIntent(intent: string): string {
  const text = intent.toLowerCase()
  if (!text.trim()) return 'status'
  if (/\b(init|initialize|scaffold|setup)\b/.test(text)) return 'harness-init'
  if (/\b(status|state|where are we|summary)\b/.test(text)) return 'status'
  if (/\b(lint|audit|gap|stale|consistency)\b/.test(text)) return 'harness-lint'
  if (/\b(story|acceptance|requirement|product contract)\b/.test(text)) return 'story-intake'
  if (/\b(decision|adr|tradeoff)\b/.test(text)) return 'decision-intake'
  if (/\b(test|verify|validation|evidence|matrix)\b/.test(text)) return 'validation-intake'
  if (/\b(run|implement|continue|execute|fix|build)\b/.test(text)) return 'execution'
  return 'intake'
}

function classifyHarnessRisk(intent: string): { level: 'tiny' | 'normal' | 'high-risk'; flags: string[] } {
  const text = intent.toLowerCase()
  const checks: Array<[string, RegExp]> = [
    ['auth/authorization', /\b(auth|oauth|login|permission|authorization|rbac)\b/],
    ['data model/migration', /\b(schema|migration|database|data model|data loss)\b/],
    ['audit/security', /\b(security|audit|secret|token|keychain|sandbox)\b/],
    ['external provider', /\b(stripe|polar|supabase|github|openai|provider|api integration)\b/],
    ['public contract', /\b(api|ipc|public contract|breaking|sdk)\b/],
    ['cross-platform', /\b(mac|windows|linux|cross-platform|platform)\b/],
    ['weak proof', /\b(unclear|maybe|probably|hard to test|no test|weak proof)\b/],
    ['multi-domain', /\b(refactor|redesign|migration|multiple|across)\b/],
  ]
  const flags = checks.filter(([, pattern]) => pattern.test(text)).map(([flag]) => flag)
  if (flags.length > 0) return { level: 'high-risk', flags }
  if (/\b(copy|text|label|style|docs?|comment)\b/.test(text)) return { level: 'tiny', flags }
  return { level: 'normal', flags }
}

// ── Status / lint text builders ──────────────────────────────────────────────

function buildHarnessStatusText(cwd: string): string {
  const requiredDocs = HARNESS_REQUIRED_DOCS.map((doc) => getDocStatus(cwd, doc))
  const dirs = HARNESS_OPTIONAL_DIRS.map((dir) => ({ path: dir, files: listMarkdownFiles(cwd, dir) }))
  const missingDocs = requiredDocs.filter((doc) => !doc.exists).map((doc) => doc.path)

  return [
    'Harness status',
    '',
    `Required docs: ${requiredDocs.filter((doc) => doc.exists).length}/${requiredDocs.length} present`,
    ...requiredDocs.map((doc) => `- ${doc.exists ? '✓' : '×'} ${doc.path}${doc.bytes ? ` (${doc.bytes} bytes)` : ''}`),
    '',
    'Harness directories:',
    ...dirs.map((dir) => `- ${dir.path}: ${dir.files.length} markdown file(s)`),
    ...(dirs.some((dir) => dir.files.length > 0)
      ? dirs.flatMap((dir) => dir.files.map((f) => `  - ${f}`))
      : ['  (empty)']),
    '',
    missingDocs.length
      ? `Next safe action: run harness_init or create missing docs (${missingDocs.join(', ')}).`
      : 'Next safe action: run harness_intake for the next user goal, or harness_lint before execution.',
  ].join('\n')
}

function buildHarnessLintText(cwd: string): { text: string; issueCount: number; warningCount: number } {
  const issues: string[] = []
  const warnings: string[] = []

  for (const doc of HARNESS_REQUIRED_DOCS) {
    if (!existsSync(harnessPath(cwd, doc))) issues.push(`Missing required harness doc: ${doc}`)
  }
  for (const template of ['docs/templates/story.md', 'docs/templates/spec-intake.md']) {
    if (!existsSync(harnessPath(cwd, template))) warnings.push(`Missing recommended template: ${template}`)
  }
  if (listMarkdownFiles(cwd, 'docs/product').length === 0) {
    warnings.push('No product docs found in docs/product/.')
  }
  if (listMarkdownFiles(cwd, 'docs/stories').length === 0) {
    warnings.push('No story packets found in docs/stories/.')
  }
  const testMatrixPath = harnessPath(cwd, 'docs/TEST_MATRIX.md')
  if (existsSync(testMatrixPath)) {
    const matrix = readFileSync(testMatrixPath, 'utf-8')
    if (!/\b(planned|in_progress|implemented|changed|retired)\b/.test(matrix)) {
      warnings.push('docs/TEST_MATRIX.md does not mention recognized statuses.')
    }
    if (!/evidence/i.test(matrix)) warnings.push('docs/TEST_MATRIX.md does not include an evidence column/section.')
  }

  const text = [
    'Harness lint',
    '',
    `Issues: ${issues.length}`,
    ...(issues.length ? issues.map((issue) => `- ${issue}`) : ['- none']),
    '',
    `Warnings: ${warnings.length}`,
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ['- none']),
  ].join('\n')

  return { text, issueCount: issues.length, warningCount: warnings.length }
}

// ── File writing ─────────────────────────────────────────────────────────────

function writeHarnessFileIfAllowed(cwd: string, relPath: string, overwrite: boolean): 'created' | 'kept' | 'overwritten' {
  const absPath = harnessPath(cwd, relPath)
  const existed = existsSync(absPath)
  mkdirSync(path.dirname(absPath), { recursive: true })
  if (existed && !overwrite) return 'kept'
  writeFileSync(absPath, HARNESS_TEMPLATE_FILES[relPath] ?? '', 'utf-8')
  return existed ? 'overwritten' : 'created'
}

// ── Artifact builders ────────────────────────────────────────────────────────

function slugifyHarnessTitle(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  )
}

function formatListItems(items: string[] | undefined): string {
  if (!items?.length) return '- TBD'
  return items.map((item) => `- ${item.trim() || 'TBD'}`).join('\n')
}

function writeHarnessArtifact(
  cwd: string,
  relPath: string,
  content: string,
  overwrite: boolean,
): 'created' | 'kept' | 'overwritten' {
  const absPath = harnessPath(cwd, relPath)
  const existed = existsSync(absPath)
  mkdirSync(path.dirname(absPath), { recursive: true })
  if (existed && !overwrite) return 'kept'
  writeFileSync(absPath, content, 'utf-8')
  return existed ? 'overwritten' : 'created'
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildStoryContent(params: {
  title: string
  objective: string
  acceptanceCriteria?: string[]
  validation?: string
  status?: string
}): string {
  return `# Story: ${params.title.trim()}

Status: ${params.status ?? 'planned'}

## Product Contract

${params.objective.trim()}

## Relevant Product Docs

- docs/product/: TBD

## Acceptance Criteria

${formatListItems(params.acceptanceCriteria)}

## Design Notes

- TBD

## Validation

| Check | Command / Evidence | Status |
| --- | --- | --- |
| Story validation | ${params.validation?.trim() || 'TBD'} | planned |

## Harness Delta

- Story packet created through story_create.

## Evidence

- Pending implementation evidence.
`
}

function buildDecisionContent(params: {
  title: string
  context: string
  decision: string
  consequences?: string
  status?: string
}): string {
  return `# Decision: ${params.title.trim()}

Status: ${params.status ?? 'accepted'}
Date: ${todayIsoDate()}

## Context

${params.context.trim()}

## Decision

${params.decision.trim()}

## Consequences

${params.consequences?.trim() || '- TBD'}

## Evidence

- Recorded through decision_record.
`
}

function appendTestMatrixRow(cwd: string, row: { area: string; behavior: string; status: string; evidence: string; notes?: string }): void {
  const relPath = 'docs/TEST_MATRIX.md'
  const absPath = harnessPath(cwd, relPath)
  mkdirSync(path.dirname(absPath), { recursive: true })
  if (!existsSync(absPath)) {
    writeFileSync(absPath, HARNESS_TEMPLATE_FILES[relPath] ?? '# Test Matrix\n', 'utf-8')
  }
  const current = readFileSync(absPath, 'utf-8')
  const suffix = current.endsWith('\n') ? '' : '\n'
  const line = `| ${row.area.trim()} | ${row.behavior.trim()} | ${row.status} | ${row.evidence.trim()} | ${row.notes?.trim() || ''} |`
  writeFileSync(absPath, `${current}${suffix}${line}\n`, 'utf-8')
}

// ── Tool execute implementations ─────────────────────────────────────────────

export async function harnessStatusExecute(_toolCallId: string, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  const text = buildHarnessStatusText(ctx.cwd)
  return {
    content: [{ type: 'text' as const, text: typeof params.focus === 'string' && params.focus.trim() ? `${text}\n\nFocus: ${params.focus.trim()}` : text }],
    details: {
      requiredDocs: HARNESS_REQUIRED_DOCS.map((doc) => getDocStatus(ctx.cwd, doc)),
      directories: HARNESS_OPTIONAL_DIRS.map((dir) => ({ path: dir, files: listMarkdownFiles(ctx.cwd, dir) })),
    },
  }
}

export async function harnessIntakeExecute(_toolCallId: string, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  const intent = typeof params.intent === 'string' ? params.intent.trim() : ''
  const intentType = classifyHarnessIntent(intent)
  const risk = classifyHarnessRisk(intent)
  const missingDocs = HARNESS_REQUIRED_DOCS.filter((doc) => !existsSync(harnessPath(ctx.cwd, doc)))
  const nextAction = missingDocs.length
    ? `Run harness_init before durable execution; missing ${missingDocs.join(', ')}.`
    : intentType === 'harness-lint'
      ? 'Run harness_lint and resolve required-doc/test-matrix issues before execution.'
      : intentType === 'status'
        ? 'Run harness_status and report current state.'
        : 'Use story_create, decision_record, or test_matrix_update to create durable repo-local artifacts.'
  const text = [
    'Harness intake',
    '',
    `Intent: ${intent || '(empty)'}`,
    `Classification: ${intentType}`,
    `Risk: ${risk.level}${risk.flags.length ? ` (${risk.flags.join(', ')})` : ''}`,
    `Missing required docs: ${missingDocs.length ? missingDocs.join(', ') : 'none'}`,
    `Next safe action: ${nextAction}`,
  ].join('\n')
  return { content: [{ type: 'text' as const, text }], details: { intentType, risk, missingDocs, nextAction } }
}

export async function harnessInitExecute(_toolCallId: string, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  for (const dir of HARNESS_OPTIONAL_DIRS) mkdirSync(harnessPath(ctx.cwd, dir), { recursive: true })
  const overwrite = params.overwrite === true
  const results = Object.keys(HARNESS_TEMPLATE_FILES).map((file) => ({
    path: file,
    status: writeHarnessFileIfAllowed(ctx.cwd, file, overwrite),
  }))
  const text = [
    'Harness init',
    '',
    ...results.map((result) => `- ${result.status}: ${result.path}`),
    '',
    'Next safe action: run harness_status, then harness_intake for the current goal.',
  ].join('\n')
  return { content: [{ type: 'text' as const, text }], details: { files: results } }
}

export async function harnessLintExecute(_toolCallId: string, _params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  const lint = buildHarnessLintText(ctx.cwd)
  return {
    content: [{ type: 'text' as const, text: lint.text }],
    details: { issueCount: lint.issueCount, warningCount: lint.warningCount },
  }
}

export async function storyCreateExecute(_toolCallId: string, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  const title = typeof params.title === 'string' ? params.title.trim() : ''
  const objective = typeof params.objective === 'string' ? params.objective.trim() : ''
  if (!title) throw new Error('Story title must not be empty.')
  if (!objective) throw new Error('Story objective must not be empty.')

  const relPath = `docs/stories/${slugifyHarnessTitle(title)}.md`
  const status = writeHarnessArtifact(
    ctx.cwd,
    relPath,
    buildStoryContent({
      title,
      objective,
      acceptanceCriteria: Array.isArray(params.acceptanceCriteria) ? params.acceptanceCriteria as string[] : undefined,
      validation: typeof params.validation === 'string' ? params.validation : undefined,
      status: typeof params.status === 'string' ? params.status : undefined,
    }),
    params.overwrite === true,
  )
  const criteriaCount = Array.isArray(params.acceptanceCriteria) ? params.acceptanceCriteria.length : 0
  const text = [
    'Story create',
    '',
    `- ${status}: ${relPath}`,
    `Title: ${title}`,
    `Status: ${typeof params.status === 'string' ? params.status : 'planned'}`,
    `Acceptance criteria: ${criteriaCount}`,
    '',
    status === 'kept'
      ? 'Next safe action: inspect the existing story or rerun with overwrite after confirmation.'
      : 'Next safe action: run test_matrix_update for validation coverage, then execute one story slice.',
  ].join('\n')
  return { content: [{ type: 'text' as const, text }], details: { path: relPath, status, title, criteriaCount } }
}

export async function decisionRecordExecute(_toolCallId: string, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  const title = typeof params.title === 'string' ? params.title.trim() : ''
  const context = typeof params.context === 'string' ? params.context.trim() : ''
  const decision = typeof params.decision === 'string' ? params.decision.trim() : ''
  if (!title) throw new Error('Decision title must not be empty.')
  if (!context) throw new Error('Decision context must not be empty.')
  if (!decision) throw new Error('Decision body must not be empty.')

  const relPath = `docs/decisions/${todayIsoDate()}-${slugifyHarnessTitle(title)}.md`
  const status = writeHarnessArtifact(
    ctx.cwd,
    relPath,
    buildDecisionContent({
      title,
      context,
      decision,
      consequences: typeof params.consequences === 'string' ? params.consequences : undefined,
      status: typeof params.status === 'string' ? params.status : undefined,
    }),
    params.overwrite === true,
  )
  const text = [
    'Decision record',
    '',
    `- ${status}: ${relPath}`,
    `Title: ${title}`,
    `Status: ${typeof params.status === 'string' ? params.status : 'accepted'}`,
    '',
    status === 'kept'
      ? 'Next safe action: inspect the existing decision or rerun with overwrite after confirmation.'
      : 'Next safe action: reference this decision from affected stories or product docs.',
  ].join('\n')
  return { content: [{ type: 'text' as const, text }], details: { path: relPath, status, title } }
}

export async function testMatrixUpdateExecute(_toolCallId: string, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
  const area = typeof params.area === 'string' ? params.area.trim() : ''
  const behavior = typeof params.behavior === 'string' ? params.behavior.trim() : ''
  const evidence = typeof params.evidence === 'string' ? params.evidence.trim() : ''
  if (!area) throw new Error('Test matrix area must not be empty.')
  if (!behavior) throw new Error('Test matrix behavior must not be empty.')
  if (!evidence) throw new Error('Test matrix evidence must not be empty.')

  appendTestMatrixRow(ctx.cwd, {
    area,
    behavior,
    status: typeof params.status === 'string' ? params.status : 'planned',
    evidence,
    notes: typeof params.notes === 'string' ? params.notes : undefined,
  })
  const text = [
    'Test matrix update',
    '',
    '- appended: docs/TEST_MATRIX.md',
    `Area: ${area}`,
    `Behavior: ${behavior}`,
    `Status: ${typeof params.status === 'string' ? params.status : 'planned'}`,
    `Evidence: ${evidence}`,
    '',
    'Next safe action: run harness_lint or execute the validation proof.',
  ].join('\n')
  return { content: [{ type: 'text' as const, text }], details: { path: 'docs/TEST_MATRIX.md', area, behavior, status: typeof params.status === 'string' ? params.status : 'planned' } }
}
