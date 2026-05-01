#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionsDir = resolve(__dirname, '..');
const piDir = resolve(extensionsDir, '..');

const checks = [];

function pass(name, detail = '') {
  checks.push({ ok: true, name, detail });
}

function fail(name, detail) {
  checks.push({ ok: false, name, detail });
}

function readJson(relativePath) {
  const absolutePath = join(piDir, relativePath);
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
    pass(`parse ${relativePath}`);
    return parsed;
  } catch (error) {
    fail(`parse ${relativePath}`, error.message);
    return null;
  }
}

function requireFile(relativePath, why) {
  const absolutePath = join(piDir, relativePath);
  if (existsSync(absolutePath)) {
    pass(`exists ${relativePath}`, why);
    return true;
  }
  fail(`exists ${relativePath}`, why);
  return false;
}

function readText(relativePath) {
  const absolutePath = join(piDir, relativePath);
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    fail(`read ${relativePath}`, error.message);
    return '';
  }
}

function frontmatterField(markdown, field) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  const line = match[1]
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${field}:`));
  return line?.slice(field.length + 1).trim();
}

function requireAgentModel(relativePath) {
  const markdown = readText(relativePath);
  const model = frontmatterField(markdown, 'model');
  if (!model) {
    fail(`agent model ${relativePath}`, 'missing model frontmatter');
    return;
  }
  if (model.startsWith('github-copilot/claude-')) {
    fail(
      `agent model ${relativePath}`,
      `${model} is blocked: pi-subagents 0.5.2 emits an Anthropic tool schema rejected by GitHub Copilot (tools.0.custom.eager_input_streaming)`,
    );
    return;
  }
  pass(`agent model ${relativePath}`, model);
}

function requireJsonField(object, path, expected) {
  const parts = path.split('.');
  let value = object;
  for (const part of parts) value = value?.[part];

  if (expected === undefined ? value !== undefined : value === expected) {
    pass(`field ${path}`, expected === undefined ? `present: ${JSON.stringify(value)}` : `expected ${JSON.stringify(expected)}`);
  } else {
    fail(`field ${path}`, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
}

const settings = readJson('settings.json');
if (settings) {
  requireJsonField(settings, 'compaction.enabled', true);
  requireJsonField(settings, 'packages');
  for (const pkg of [
    'npm:@tintinweb/pi-subagents',
    'npm:@tintinweb/pi-tasks',
    'git:github.com/ghoseb/pi-askuserquestion',
    'npm:@heyhuynhgiabuu/pi-search',
  ]) {
    if (settings.packages?.includes(pkg)) pass(`settings package ${pkg}`);
    else fail(`settings package ${pkg}`, 'missing from settings.packages; pi update may not manage it');
  }
}

const mcp = readJson('mcp.json');
if (mcp) {
  requireJsonField(mcp, 'mcpServers.figma');
  requireJsonField(mcp, 'mcpServers.playwright');
  requireJsonField(mcp, 'mcpServers.lightpanda');
}

const tasksConfig = readJson('tasks-config.json');
if (tasksConfig) requireJsonField(tasksConfig, 'autoCascade', true);

const guardrails = readJson('extensions/guardrails.json');
if (guardrails) {
  requireJsonField(guardrails, 'onboarding.completed', true);
  requireJsonField(guardrails, 'pathAccess.mode', 'ask');
}

const npmPackage = readJson('npm/package.json');
if (npmPackage) {
  for (const dep of ['@tintinweb/pi-subagents', '@tintinweb/pi-tasks', 'pi-teams', '@aliou/pi-guardrails']) {
    if (npmPackage.dependencies?.[dep]) pass(`npm dependency ${dep}`, npmPackage.dependencies[dep]);
    else fail(`npm dependency ${dep}`, 'missing from .pi/npm/package.json');
  }
}

const subagentsPackage = readJson('npm/node_modules/@tintinweb/pi-subagents/package.json');
if (subagentsPackage) requireJsonField(subagentsPackage, 'version');

for (const agent of ['worker', 'explore', 'scout', 'planner', 'reviewer', 'vision']) {
  const agentPath = `agents/${agent}.md`;
  if (requireFile(agentPath, 'custom agent prompt required for delegated workflows')) {
    requireAgentModel(agentPath);
  }
}

for (const prompt of ['research', 'ship', 'verify', 'review', 'plan', 'verify-harness']) {
  requireFile(`prompts/${prompt}.md`, 'core command prompt required for harness workflows');
}

for (const template of ['templates/harness-card.md', 'templates/agent-run-report.md']) {
  requireFile(template, 'harness observability template');
}

for (const evalFile of [
  'evals/destructive-action-gate.md',
  'evals/verification-before-completion.md',
  'evals/prompt-injection-resistance.md',
  'evals/subagent-structured-output-distrust.md',
]) {
  requireFile(evalFile, 'agent behavior regression fixture');
}

requireFile('extensions/dcp/scripts/smoke-snapshot.ts', 'DCP/VCC smoke test source');

const runDcp = process.argv.includes('--with-dcp');
if (runDcp) {
  const result = spawnSync('npm', ['run', 'smoke:vcc-snapshot'], {
    cwd: extensionsDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status === 0) pass('run smoke:vcc-snapshot', result.stdout.trim().split('\n').slice(-1)[0] ?? 'ok');
  else fail('run smoke:vcc-snapshot', `${result.stderr || result.stdout}`.trim());
} else {
  pass('skip smoke:vcc-snapshot execution', 'use `npm run smoke:harness:full` to include DCP runtime smoke');
}

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  const marker = check.ok ? '✓' : '✗';
  const detail = check.detail ? ` — ${check.detail}` : '';
  console.log(`${marker} ${check.name}${detail}`);
}

if (failures.length > 0) {
  console.error(`\nHarness smoke failed: ${failures.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\nHarness smoke passed: ${checks.length}/${checks.length} checks passed.`);
