#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionsDir = resolve(__dirname, '..');
const piDir = resolve(extensionsDir, '..');

const checks = [];

const PROMPT_PSEUDO_TOOL_PATTERNS = [
  { pattern: /^\s*Read\s*\(/m, replacement: 'tilth_read(' },
  { pattern: /^\s*memory_search\s*\(/m, replacement: 'memory-search(' },
  { pattern: /^\s*memory_update\s*\(/m, replacement: 'memory-update(' },
  { pattern: /^\s*memory_get\s*\(/m, replacement: 'memory-get(' },
  { pattern: /^\s*question\s*\(/m, replacement: 'ask_user_question(' },
  { pattern: /^\s*task\s*\(/m, replacement: 'Agent(' },
  { pattern: /^\s*subagent\s*\(/m, replacement: 'Agent(' },
  { pattern: /^\s*tilth_tilth_files\s*\(/m, replacement: 'tilth_files(' },
  { pattern: /^\s*tilth_tilth_search\s*\(/m, replacement: 'tilth_search(' },
  { pattern: /^\s*tilth_tilth_read\s*\(/m, replacement: 'tilth_read(' },
  { pattern: /^\s*tilth_tilth_deps\s*\(/m, replacement: 'tilth_deps(' },
];

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

function listSkillNames() {
  const skillsDir = join(piDir, 'skills');
  try {
    return new Set(
      readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
        .map((entry) => entry.name),
    );
  } catch (error) {
    fail('scan skills directory', error.message);
    return new Set();
  }
}

function listMarkdownFiles(relativeDir) {
  const absoluteDir = join(piDir, relativeDir);
  try {
    return readdirSync(absoluteDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => `${relativeDir}/${entry.name}`)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    fail(`scan ${relativeDir}`, error.message);
    return [];
  }
}

function listPromptCommandNames() {
  return new Set(
    listMarkdownFiles('prompts').map((relativePath) => relativePath.replace(/^prompts\//, '').replace(/\.md$/, '')),
  );
}

function extractSkillRefs(markdown) {
  const refs = new Set();
  for (const match of markdown.matchAll(/skill\(\{\s*name:\s*"([^"]+)"\s*\}\)/g)) refs.add(match[1]);
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  const skillsLine = frontmatter?.[1]
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('skills:'));
  if (skillsLine) {
    for (const name of skillsLine.slice('skills:'.length).split(',')) {
      const trimmed = name.trim();
      if (trimmed) refs.add(trimmed);
    }
  }
  return [...refs].sort((a, b) => a.localeCompare(b));
}

function validateAgentBlocks(relativePath, markdown) {
  const blocks = markdown.match(/Agent\(\{[\s\S]*?\}\);/g) ?? [];
  for (const block of blocks) {
    if (/\btask\s*:/.test(block)) {
      fail(`agent payload ${relativePath}`, 'Agent(...) block uses deprecated `task:` payload; use `prompt:` plus `description:`');
    }
    if (!/\bprompt\s*:/.test(block)) {
      fail(`agent payload ${relativePath}`, 'Agent(...) block is missing required `prompt:` payload');
    }
    if (!/\bdescription\s*:/.test(block)) {
      fail(`agent payload ${relativePath}`, 'Agent(...) block is missing required `description:` field');
    }
  }
}

function validateAskUserQuestionBlocks(relativePath, markdown) {
  const blocks = markdown.match(/ask_user_question\(\{[\s\S]*?\}\);/g) ?? [];
  for (const block of blocks) {
    if (!/\bquestions\s*:\s*\[/.test(block)) {
      fail(`ask_user_question payload ${relativePath}`, 'ask_user_question(...) block is missing required `questions:` array');
    }
    if (!/\bheader\s*:/.test(block)) {
      fail(`ask_user_question payload ${relativePath}`, 'ask_user_question(...) block is missing required `header:` field');
    }
    if (!/\bquestion\s*:/.test(block)) {
      fail(`ask_user_question payload ${relativePath}`, 'ask_user_question(...) block is missing required `question:` field');
    }
    if (!/\boptions\s*:\s*\[/.test(block)) {
      fail(`ask_user_question payload ${relativePath}`, 'ask_user_question(...) block is missing required `options:` array');
    }
    if (/\boptions\s*:\s*\[\s*\]/.test(block)) {
      fail(`ask_user_question payload ${relativePath}`, 'ask_user_question(...) block has empty `options:` array; provide 2-4 options');
    }
    if (!/\bmultiSelect\s*:\s*(true|false)/.test(block)) {
      fail(`ask_user_question payload ${relativePath}`, 'ask_user_question(...) block is missing required `multiSelect:` boolean');
    }
  }
}

const DANGEROUS_SHELL_PATTERNS = [
  { pattern: /^\s*git add \.\s*$/m, detail: 'shell example uses `git add .`; stage specific files instead' },
  { pattern: /^\s*git add -A\s*$/m, detail: 'shell example uses `git add -A`; stage specific files instead' },
  { pattern: /^\s*git push\b.*(?:\s--force\b|\s-f\b)/m, detail: 'shell example uses force push; never teach force-push flows by default' },
  { pattern: /^\s*git reset --hard\b/m, detail: 'shell example uses `git reset --hard`; destructive restore commands require explicit user approval' },
  { pattern: /^\s*git checkout \.\s*$/m, detail: 'shell example uses `git checkout .`; destructive restore commands require explicit user approval' },
  { pattern: /^\s*git clean -fd\b/m, detail: 'shell example uses `git clean -fd`; destructive restore commands require explicit user approval' },
  { pattern: /^\s*rm -rf\b/m, detail: 'shell example uses `rm -rf`; destructive delete commands should not appear in shipped prompt examples' },
  { pattern: /^\s*git commit\b.*\s--no-verify\b/m, detail: 'shell example uses `--no-verify`; never teach hook bypasses' },
];

function validateShellBlocks(relativePath, markdown) {
  const blocks = markdown.match(/```bash\n[\s\S]*?```/g) ?? [];
  for (const block of blocks) {
    for (const { pattern, detail } of DANGEROUS_SHELL_PATTERNS) {
      if (pattern.test(block)) {
        fail(`shell policy ${relativePath}`, detail);
      }
    }
  }
}

const PLACEHOLDER_SHELL_EXAMPLE_PATTERNS = [
  {
    pattern: /`git [^`\n]*<[^`\n>]+>[^`\n]*`/,
    detail: 'shipped markdown contains placeholder git command arguments like `git show <hash>`; use a concrete example command',
  },
  {
    pattern: /^\s*git add <[^\n>]+>\s*$/m,
    detail: 'shipped markdown contains placeholder `git add <...>` example; use a concrete file path',
  },
  {
    pattern: /^\s*git add [^\n]*\/specific\/[^\n]*$/m,
    detail: 'shipped markdown contains fake `git add .../specific/...` example path; use a concrete file path',
  },
];

function validateShellExamplePlaceholders(relativePath, markdown) {
  const normalizedMarkdown = markdown.replace(/\\`/g, '`');
  for (const { pattern, detail } of PLACEHOLDER_SHELL_EXAMPLE_PATTERNS) {
    if (pattern.test(normalizedMarkdown)) {
      fail(`shell example hygiene ${relativePath}`, detail);
    }
  }
}

function validateVerifyCommands(relativePath, markdown) {
  const lines = markdown.split('\n');
  for (const line of lines) {
    if (!line.includes('Verify:')) continue;
    const inlineCommands = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    for (const command of inlineCommands) {
      if (/\[[^\]]+\]/.test(command)) {
        fail(`verify command ${relativePath}`, 'Verify example contains placeholder text inside the command; use a concrete runnable command');
      }
    }
  }
}

const STALE_PROMPT_PATH_PATTERNS = [
  {
    pattern: /\.\.\/skill\//,
    detail: 'prompt references stale ../skill/... path; refer to the skill by name instead of a broken relative file path',
  },
  {
    pattern: /src\/path\/to\/file\.ts/,
    detail: 'shipped markdown contains fake example path `src/path/to/file.ts`; use a concrete example path',
  },
  {
    pattern: /path\/to\/file\.ts(?::\d+)?/,
    detail: 'shipped markdown contains fake example path `path/to/file.ts`; use a concrete example path',
  },
  {
    pattern: /\[relevant\/file\.ts if applicable\]/,
    detail: 'shipped markdown contains placeholder example path `[relevant/file.ts if applicable]`; use a concrete example path',
  },
  {
    pattern: /`(?:[^`\n]*[\s(])?(?:file|other)\.ts\b[^`\n]*`/,
    detail: 'shipped markdown contains placeholder inline file names like `file.ts`; use a concrete example path',
  },
  {
    pattern: /<relevant-file-path>/,
    detail: 'prompt contains placeholder artifact path `<relevant-file-path>`; use a concrete example path',
  },
];

const STALE_PROMPT_LABEL_PATTERNS = [
  {
    pattern: /`@(scout|explore|planner|reviewer|worker|vision)`/,
    detail: 'prompt uses stale `@agent` label syntax; refer to the agent by name or the Agent tool instead',
  },
  {
    pattern: /^\|\s*`task`\s*\|/m,
    detail: 'prompt tool table still lists `task`; use `Agent` for subagent dispatch',
  },
  {
    pattern: /\breview agent(s)?\b/,
    detail: 'prompt says `review agent`; use `reviewer agent` to match the actual custom agent name',
  },
];

const BUILTIN_PROMPT_COMMANDS = new Set(['dcp', 'usage']);

function stripFencedCodeBlocks(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function validatePromptPaths(relativePath, markdown) {
  const normalizedMarkdown = markdown.replace(/\\`/g, '`');
  for (const { pattern, detail } of STALE_PROMPT_PATH_PATTERNS) {
    if (pattern.test(normalizedMarkdown)) {
      fail(`prompt path hygiene ${relativePath}`, detail);
    }
  }
}

function validatePromptLabels(relativePath, markdown) {
  for (const { pattern, detail } of STALE_PROMPT_LABEL_PATTERNS) {
    if (pattern.test(markdown)) {
      fail(`prompt label hygiene ${relativePath}`, detail);
    }
  }
}

function validatePromptCommands(relativePath, markdown, knownPromptCommands) {
  const proseOnlyMarkdown = stripFencedCodeBlocks(markdown).replace(/\\`/g, '`');
  for (const match of proseOnlyMarkdown.matchAll(/`([^`\n]+)`/g)) {
    const inlineCode = match[1]?.trim();
    const command = inlineCode?.match(/^\/([a-z][a-z0-9-]*)\b/)?.[1];
    if (!command) continue;
    if (knownPromptCommands.has(command) || BUILTIN_PROMPT_COMMANDS.has(command)) continue;
    fail(
      `prompt command hygiene ${relativePath}`,
      `prompt references unknown slash command \`/${command}\`; use a shipped prompt command or an approved built-in command`,
    );
  }
}

function validateQuotedPromptCommands(relativePath, markdown, knownPromptCommands) {
  const proseOnlyMarkdown = stripFencedCodeBlocks(markdown)
    .replace(/\\`/g, '`')
    .replace(/`[^`\n]+`/g, ' ');
  for (const match of proseOnlyMarkdown.matchAll(/["']\/([a-z][a-z0-9-]*)(?:\s+(?:\$[A-Z_]+|<[^>\n]+>))?["']/g)) {
    const command = match[1];
    if (knownPromptCommands.has(command) || BUILTIN_PROMPT_COMMANDS.has(command)) continue;
    fail(
      `prompt command hygiene ${relativePath}`,
      `prompt references unknown quoted slash command \"/${command}\"; use a shipped prompt command or an approved built-in command`,
    );
  }
}

function validateActiveMarkdown(relativePath, knownSkills, knownPromptCommands) {
  const markdown = readText(relativePath);
  if (!markdown) return;

  for (const skillName of extractSkillRefs(markdown)) {
    if (knownSkills.has(skillName)) pass(`skill ref ${relativePath}::${skillName}`);
    else fail(`skill ref ${relativePath}::${skillName}`, 'referenced skill does not exist in .pi/skills');
  }

  for (const { pattern, replacement } of PROMPT_PSEUDO_TOOL_PATTERNS) {
    if (pattern.test(markdown)) {
      fail(`tool syntax ${relativePath}`, `contains deprecated pseudo-tool syntax; use ${replacement}`);
    }
  }

  validateAgentBlocks(relativePath, markdown);
  validateAskUserQuestionBlocks(relativePath, markdown);
  validateShellBlocks(relativePath, markdown);
  validateShellExamplePlaceholders(relativePath, markdown);
  validateVerifyCommands(relativePath, markdown);
  validatePromptPaths(relativePath, markdown);
  validatePromptLabels(relativePath, markdown);
  validatePromptCommands(relativePath, markdown, knownPromptCommands);
  validateQuotedPromptCommands(relativePath, markdown, knownPromptCommands);
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

for (const agentPath of listMarkdownFiles('agents')) {
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

const knownSkills = listSkillNames();
const knownPromptCommands = listPromptCommandNames();
for (const activeMarkdown of [...listMarkdownFiles('agents'), ...listMarkdownFiles('prompts')]) {
  validateActiveMarkdown(activeMarkdown, knownSkills, knownPromptCommands);
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
