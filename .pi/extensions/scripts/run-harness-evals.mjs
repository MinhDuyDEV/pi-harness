#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionsDir = resolve(__dirname, '..');
const piDir = resolve(extensionsDir, '..');
const evalsDir = join(piDir, 'evals');

const requiredSections = [
  '## Purpose',
  '## Prompt',
  '## Expected Behavior',
  '## Failure Conditions',
  '## Suggested Deterministic Checks',
];

const requiredFixtures = [
  'destructive-action-gate.md',
  'verification-before-completion.md',
  'prompt-injection-resistance.md',
  'subagent-structured-output-distrust.md',
];

const policyTerms = new Map([
  ['destructive-action-gate.md', ['approval', 'destructive', 'force-push']],
  ['verification-before-completion.md', ['verification', 'evidence', 'claim']],
  ['prompt-injection-resistance.md', ['untrusted', 'prompt injection', 'secrets']],
  ['subagent-structured-output-distrust.md', ['subagent', 'structured', 'verification']],
]);

const checks = [];

function pass(name, detail = '') {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail) {
  checks.push({ ok: false, name, detail });
}

function sectionBody(markdown, section) {
  const start = markdown.indexOf(section);
  if (start === -1) return '';
  const bodyStart = start + section.length;
  const next = markdown.slice(bodyStart).search(/\n## /);
  return (next === -1 ? markdown.slice(bodyStart) : markdown.slice(bodyStart, bodyStart + next)).trim();
}

if (!existsSync(evalsDir)) {
  fail('exists evals directory', `${evalsDir} is missing`);
} else {
  pass('exists evals directory', evalsDir);
}

for (const fixture of requiredFixtures) {
  const path = join(evalsDir, fixture);
  if (!existsSync(path)) {
    fail(`exists ${fixture}`, 'required harness eval fixture is missing');
    continue;
  }

  const markdown = readFileSync(path, 'utf8');
  pass(`exists ${fixture}`);

  if (/\bTODO\b|\bTBD\b|placeholder/i.test(markdown)) {
    fail(`no placeholders ${fixture}`, 'fixture contains TODO/TBD/placeholder text');
  } else {
    pass(`no placeholders ${fixture}`);
  }

  for (const section of requiredSections) {
    if (!markdown.includes(section)) {
      fail(`section ${fixture} ${section}`, 'missing required section');
      continue;
    }
    const body = sectionBody(markdown, section);
    if (body.length < 25) fail(`section body ${fixture} ${section}`, 'section is too thin to be useful');
    else pass(`section body ${fixture} ${section}`, `${body.length} chars`);
  }

  const promptBody = sectionBody(markdown, '## Prompt');
  if (/```(?:text)?[\s\S]+```/.test(promptBody)) pass(`prompt fenced ${fixture}`);
  else fail(`prompt fenced ${fixture}`, 'Prompt section must contain a fenced prompt block');

  const expectedItems = (sectionBody(markdown, '## Expected Behavior').match(/^-/gm) ?? []).length;
  const failureItems = (sectionBody(markdown, '## Failure Conditions').match(/^-/gm) ?? []).length;
  const deterministicItems = (sectionBody(markdown, '## Suggested Deterministic Checks').match(/^-/gm) ?? []).length;

  if (expectedItems >= 2) pass(`expected behaviors ${fixture}`, `${expectedItems} bullets`);
  else fail(`expected behaviors ${fixture}`, 'need at least 2 expected behavior bullets');

  if (failureItems >= 2) pass(`failure conditions ${fixture}`, `${failureItems} bullets`);
  else fail(`failure conditions ${fixture}`, 'need at least 2 failure condition bullets');

  if (deterministicItems >= 1) pass(`deterministic checks ${fixture}`, `${deterministicItems} bullets`);
  else fail(`deterministic checks ${fixture}`, 'need at least 1 deterministic check bullet');

  const lower = markdown.toLowerCase();
  for (const term of policyTerms.get(fixture) ?? []) {
    if (lower.includes(term)) pass(`policy term ${fixture} ${term}`);
    else fail(`policy term ${fixture} ${term}`, 'missing expected harness concept');
  }
}

if (existsSync(evalsDir)) {
  const unknown = readdirSync(evalsDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'README.md' && !requiredFixtures.includes(name));
  if (unknown.length === 0) pass('no unknown eval fixtures');
  else fail('no unknown eval fixtures', `unregistered eval fixture(s): ${unknown.join(', ')}`);
}

for (const check of checks) {
  const marker = check.ok ? '✓' : '✗';
  const detail = check.detail ? ` — ${check.detail}` : '';
  console.log(`${marker} ${check.name}${detail}`);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\nHarness eval validation failed: ${failures.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\nHarness eval validation passed: ${checks.length}/${checks.length} checks passed.`);
