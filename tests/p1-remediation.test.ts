import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const json = (...parts: string[]) => JSON.parse(read(...parts)) as Record<string, unknown>;
const promptFiles = () =>
  readdirSync(join(ROOT, ".pi", "prompts"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => [name, read(".pi", "prompts", name)] as const);

const ASK_USER_PIN = "npm:@mrclrchtr/supi-ask-user@4.0.0";

function markdownFiles(relativeDirectory: string): string[] {
  const directory = join(ROOT, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return markdownFiles(relative);
    return entry.isFile() && entry.name.endsWith(".md") ? [relative] : [];
  });
}

test("source and Full consumer settings pin the ask_user extension exactly", () => {
  for (const path of [[".pi", "settings.json"], ["templates", "consumer-settings.json"]]) {
    const settings = json(...path) as { packages?: string[] };
    assert.equal(settings.packages?.filter((entry) => entry === ASK_USER_PIN).length, 1);
  }
});

test("lifecycle prompts use loaded tools and never legacy pseudo-tools", () => {
  for (const [name, content] of promptFiles()) {
    assert.doesNotMatch(
      content,
      /\b(?:ask_user_question|memory-search|observation|AskUserQuestion)\b/,
      `${name}: legacy or unavailable prompt tool`,
    );
  }

  const init = read(".pi", "prompts", "init.md");
  const create = read(".pi", "prompts", "create.md");
  const plan = read(".pi", "prompts", "plan.md");
  assert.match(init, /`ask_user`/);
  assert.match(create, /`ask_user`/);
  assert.match(plan, /`ask_user`/);
  for (const content of [init, create, plan]) {
    assert.match(content, /plain-text|numbered/i, "interactive prompts need a non-TUI fallback");
  }
});

test("all shipped instruction prose avoids retired tool names", () => {
  for (const directory of [".pi/prompts", ".pi/agents", ".pi/templates", ".pi/skills", "docs"]) {
    for (const path of markdownFiles(directory)) {
      const content = read(path);
      assert.doesNotMatch(
        content,
        /\b(?:ask_user_question|memory-search|AskUserQuestion|multi_grep)\b|`observation`|\bobservation\s*\(/,
        `${path}: retired tool name`,
      );
    }
  }
});

test("brownfield init recommends a valid work-session lifecycle", () => {
  const init = read(".pi", "prompts", "init.md");
  assert.doesNotMatch(init, /\/verify --(?:review|test)/);
  assert.match(init, /\/create [^\n]+.*\/plan/is);
});

test("agent profiles contain no inert skill metadata or nonexistent multi_grep tool", () => {
  for (const name of readdirSync(join(ROOT, ".pi", "agents")).filter((file) => file.endsWith(".md"))) {
    const content = read(".pi", "agents", name);
    assert.doesNotMatch(content, /^skills:/m, `${name}: inert skills frontmatter`);
    assert.doesNotMatch(content, /\bmulti_grep\b/, `${name}: nonexistent tool`);
  }
});

test("skill templates use valid metadata and actual ask_user fallback contract", () => {
  const tooled = read(".pi", "templates", "skill-tooled.md");
  const config = read(".pi", "templates", "skill-config.md");
  for (const content of [tooled, config]) {
    assert.doesNotMatch(content, /^version:/m);
    assert.doesNotMatch(content, /^tags:/m);
    assert.doesNotMatch(content, /^agent_types:/m);
    assert.doesNotMatch(content, /AskUserQuestion|\$\{BUN_X\}|PI_HARNESS_CONFIG_DIR/);
    assert.match(content, /`ask_user`/);
    assert.match(content, /plain-text|numbered/i);
  }
});

test("consumer documentation matches delivery, native TUI ownership, model seats, and bootstrap preconditions", () => {
  const piReadme = read(".pi", "README.md");
  const profiles = read("docs", "harness-profiles.md");
  const rootReadme = read("README.md");
  const agents = read(".pi", "agents", "README.md");

  assert.doesNotMatch(piReadme, /APPEND_SYSTEM\.md[^\n]+not shipped/i);
  assert.match(piReadme, /initializer.*materialize/is);
  assert.match(piReadme, /canonical.*model.*pin/is);
  assert.match(profiles, /Pi 0\.84 owns fullscreen compositor behavior/is);
  assert.match(profiles, /former harness compositor was removed/is);
  assert.doesNotMatch(profiles, /pi-harness\.extensions\.tui|TUI capability.*disabled by default/is);
  assert.match(rootReadme, /mkdir.*my-repo/);
  assert.doesNotMatch(agents, /\\n\|/);
  assert.doesNotMatch(agents, /project `\.pi\/AGENTS\.md`/);
  assert.doesNotMatch(agents, /What pi-task implements/);
});
