#!/usr/bin/env node

/**
 * validate-skills.mjs
 *
 * Scans all .pi/skills/<name>/SKILL.md for structural issues:
 *   1. Self-containment violations (cross-skill file references)
 *   2. Required frontmatter fields (name, description, version)
 *   3. Broken {baseDir} references
 *   4. Duplicate skill names
 *
 * Usage:
 *   node scripts/validate-skills.mjs                     # validate all
 *   node scripts/validate-skills.mjs --fix               # auto-fix minor issues
 *   node scripts/validate-skills.mjs --json              # JSON output
 *   node scripts/validate-skills.mjs --skill <name>      # single skill
 *   node scripts/validate-skills.mjs --check             # exit 1 on any issue (for CI/githooks)
 */

import { readFileSync, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(REPO_ROOT, ".pi", "skills");

const args = process.argv.slice(2);
const FLAG_CHECK = args.includes("--check");
const FLAG_JSON = args.includes("--json");
const FLAG_FIX = args.includes("--fix");
const FLAG_STRICT = args.includes("--strict");
const SINGLE_SKILL = args.includes("--skill")
  ? args[args.indexOf("--skill") + 1]
  : null;

// ---------- known external (non-pikit) skill set ----------
// Skills sourced from external repos (via skills-lock.json or Pi defaults)
// These don't follow pikit naming conventions.
const EXTERNAL_SKILLS = new Set([
  "accessibility-audit", "agent-code-quality-gate", "agent-teams",
  "api-and-interface-design", "augment-context-engine", "beads",
  "behavioral-kernel", "brainstorming", "browser-testing-with-devtools",
  "chrome-devtools", "ci-cd-and-automation", "cloudflare", "code-cleanup",
  "code-navigation", "code-review-and-quality", "condition-based-waiting",
  "context-engineering", "core-data-expert", "debugging-and-error-recovery",
  "defense-in-depth", "deprecation-and-migration", "design-system-audit",
  "design-taste-frontend", "development-lifecycle", "documentation-and-adrs",
  "figma", "frontend-design", "gemini-large-context",
  "git-workflow-and-versioning", "high-end-visual-design",
  "incremental-implementation", "industrial-brutalist-ui", "jira",
  "memory-system", "minimalist-ui", "mockup-to-code", "obsidian",
  "openpencil", "opensrc", "pdf-extract", "performance-optimization",
  "planning-and-task-breakdown", "playwright", "polar",
  "react-best-practices", "redesign-existing-projects", "resend",
  "root-cause-tracing", "security-and-hardening", "shipping-and-launch",
  "source-driven-development", "spec-driven-development", "srcwalk",
  "stitch", "structured-edit", "subagent-driven-development", "supabase",
  "supabase-postgres-best-practices", "swift-concurrency",
  "swiftui-expert-skill", "test-driven-development", "testing-anti-patterns",
  "tilth", "using-git-worktrees", "using-pi-skills", "v0",
  "vercel-deploy-claimable", "verification-before-completion", "webclaw",
  "writing-skills",
  // Non-skill directories inside .pi/skills/
  "references",
]);

// ---------- helpers ----------

const REQUIRED_FRONTMATTER = ["name", "description", "version"];

let exitCode = 0;
function fail(msg) {
  exitCode = 1;
  return { severity: "error", message: msg };
}
function warn(msg) {
  return { severity: "warn", message: msg };
}

// ---------- scan skills ----------

async function getSkillDirs() {
  const entries = await readdir(SKILLS_DIR);
  const dirs = [];
  for (const e of entries) {
    const p = path.join(SKILLS_DIR, e);
    const s = await stat(p);
    if (s.isDirectory()) dirs.push(e);
  }
  return dirs.sort();
}

function readSkillMd(skillName) {
  const p = path.join(SKILLS_DIR, skillName, "SKILL.md");
  if (!existsSync(p)) return null;
  return { path: p, content: readFileSync(p, "utf8") };
}

// ---------- checks ----------

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const body = m[1];
  const fields = {};
  // Simple YAML-ish parser for flat key: value pairs
  for (const line of body.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

function checkFrontmatter(skillName, content) {
  const issues = [];
  const fm = parseFrontmatter(content);

  for (const field of REQUIRED_FRONTMATTER) {
    if (!fm[field]) {
      issues.push(fail(`Missing required frontmatter field: '${field}'`));
    }
  }

  // Description rules: must be third person, no first-person pronouns
  if (fm.description) {
    const firstPerson = /\b(I|I'll|I'm|I've|I'd|we|we'll|we're|we've)\b/i;
    if (firstPerson.test(fm.description)) {
      issues.push(
        warn(
          `Description should be third-person, but contains first-person pronouns: "${fm.description.slice(0, 60)}..."`,
        ),
      );
    }
  }

  // Name rules: pikit- prefix only enforced in strict mode or for pikit-authored skills
  if (fm.name && !fm.name.startsWith("pikit-")) {
    if (FLAG_STRICT || !EXTERNAL_SKILLS.has(skillName)) {
      issues.push(
        warn(
          `Name should use 'pikit-' prefix (got: '${fm.name}'). For external skills, add to skills-lock.json to suppress.`,
        ),
      );
    }
  }

  return issues;
}

function checkSelfContainment(skillName, content, skillDir) {
  const issues = [];

  // Match markdown links: [text](path) or [text](path#fragment)
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRegex.exec(content)) !== null) {
    const linkText = m[1];
    const linkTarget = m[2];

    // Skip URLs, anchors, mailto, inline code references
    if (
      linkTarget.startsWith("http") ||
      linkTarget.startsWith("#") ||
      linkTarget.startsWith("mailto:") ||
      linkTarget.startsWith("`")
    ) {
      continue;
    }

    // Resolve relative to skill directory
    const resolved = path.resolve(skillDir, linkTarget);

    // Check if link targets something outside the skill directory
    if (!resolved.startsWith(skillDir + path.sep)) {
      issues.push(
        fail(
          `Self-containment violation: '${linkTarget}' resolves outside skill directory (link text: "${linkText}")`,
        ),
      );
    }

    // Check for ../../ patterns that attempt to escape
    if (linkTarget.includes("../")) {
      issues.push(
        warn(
          `Possible self-containment violation: '${linkTarget}' contains '../' (link text: "${linkText}")`,
        ),
      );
    }
  }

  // Check for direct cross-skill references
  // Only flag relative paths like `see skills/other-skill/` — skip absolute paths (/mnt/skills/) and URLs
  const crossRefRegex = /(?<!\.sen|http[^\s]*|[`"'\/])(?:^|[\s,.(])skills\/([\w-]+)\//gm;
  while ((m = crossRefRegex.exec(content)) !== null) {
    const referencedSkill = m[1];
    if (referencedSkill !== skillName && referencedSkill.length > 0) {
      const line = content.slice(0, m.index).split("\n").length;
      issues.push(
        warn(
          `Cross-skill reference to '${referencedSkill}' at line ~${line}. Self-contained skills should not reference sibling skills.`,
        ),
      );
    }
  }

  return issues;
}

function checkBaseDirReferences(skillName, content) {
  const issues = [];

  // {baseDir} should appear in Script Directory section or script examples
  const hasBaseDir = content.includes("{baseDir}");
  const hasScriptDirSection =
    content.includes("## Script Directory") ||
    content.includes("## Scripts");

  // If skill has script examples but no {baseDir}, that's suspicious
  // If it mentions bun or npx execution but no Script Directory, warn
  const hasExecutionExamples =
    content.includes("${BUN_X}") || content.includes("bun ");

  if (hasExecutionExamples && !hasBaseDir) {
    issues.push(
      warn(
        `Skill has execution examples (\${BUN_X} or bun) but no {baseDir} references. Scripts should use {baseDir} for path resolution.`,
      ),
    );
  }

  if (hasExecutionExamples && !hasScriptDirSection) {
    issues.push(
      warn(
        `Skill has execution examples but no ## Script Directory section. Add one for agent clarity.`,
      ),
    );
  }

  // Check for broken template markers
  if (content.includes("{baseDir}") && hasBaseDir) {
    // If baseDir appears but the content also has literal unresolved {baseDir}
    // That's fine — the agent is supposed to substitute them at runtime
  }

  return issues;
}

function checkUserInputSection(skillName, content) {
  const issues = [];

  // Skills that interact with user should have User Input Tools section
  const hasAskUser = content.includes("AskUserQuestion");
  const hasUserInputSection =
    content.includes("## User Input Tools") ||
    content.includes("## User Interaction");

  if (hasAskUser && !hasUserInputSection) {
    issues.push(
      warn(
        `Skill uses AskUserQuestion or user prompts but lacks a ## User Input Tools section. Add one following the cross-runtime convention.`,
      ),
    );
  }

  return issues;
}

// ---------- CLI ----------

function printHelp() {
  console.log(`Usage: node scripts/validate-skills.mjs [options]

Validate all .pi/skills/<name>/SKILL.md for structural issues.

Options:
  --check          Exit with code 1 if any errors found (for CI/githooks)
  --json           Output results as JSON
  --strict         Also check naming conventions (pikit- prefix)
  --skill <name>   Validate a single skill by directory name
  --fix            Auto-fix minor issues (future)
  -h, --help       Show this help

Checks:
  1. Required frontmatter fields (name, description, version)
  2. Self-containment (no cross-skill file references)
  3. Script Directory convention (if skill has execution examples)
  4. User Input Tools section (if skill uses AskUserQuestion)
`);
}

// ---------- main ----------

async function main() {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return;
  }
  const start = Date.now();
  const allIssues = [];
  let skillCount = 0;
  let cleanCount = 0;

  const skillDirs = SINGLE_SKILL
    ? [SINGLE_SKILL]
    : await getSkillDirs();

  for (const dir of skillDirs) {
    const skillDir = path.join(SKILLS_DIR, dir);
    const skillPath = path.join(skillDir, "SKILL.md");

    // Skip known non-skill directories
    if (dir === "references") continue;

    if (!existsSync(skillPath)) {
      allIssues.push({
        skill: dir,
        file: skillPath,
        issues: [warn(`No SKILL.md found in skill directory '${dir}'`)],
      });
      continue;
    }

    const content = readFileSync(skillPath, "utf8");
    const issues = [
      ...checkFrontmatter(dir, content),
      ...checkSelfContainment(dir, content, skillDir),
      ...checkBaseDirReferences(dir, content),
      ...checkUserInputSection(dir, content),
    ];

    allIssues.push({ skill: dir, file: skillPath, issues });
    skillCount++;

    if (issues.length === 0) cleanCount++;
  }

  // ---------- summary ----------

  const elapsed = Date.now() - start;
  const totalIssues = allIssues.reduce(
    (sum, s) => sum + s.issues.length,
    0,
  );
  const errors = allIssues.reduce(
    (sum, s) => sum + s.issues.filter((i) => i.severity === "error").length,
    0,
  );
  const warnings = totalIssues - errors;

  if (FLAG_JSON) {
    console.log(
      JSON.stringify(
        {
          skills: skillCount,
          clean: cleanCount,
          errors,
          warnings,
          elapsed_ms: elapsed,
          results: allIssues,
        },
        null,
        2,
      ),
    );
  } else {
    // Print results
    for (const { skill, file, issues } of allIssues) {
      if (issues.length === 0) continue;
      console.log(`\n\x1b[1m${skill}\x1b[0m (${file})`);
      for (const issue of issues) {
        const tag =
          issue.severity === "error"
            ? "\x1b[31mERROR\x1b[0m"
            : "\x1b[33mWARN\x1b[0m";
        console.log(`  ${tag} ${issue.message}`);
      }
    }

    console.log(`\n─── Summary ───`);
    console.log(`Skills scanned: ${skillCount}`);
    console.log(`Clean:          ${cleanCount}`);
    console.log(`Errors:         ${errors}`);
    console.log(`Warnings:       ${warnings}`);
    console.log(`Time:           ${elapsed}ms`);

    if (errors > 0) {
      console.log(`\n\x1b[31mFAIL: ${errors} error(s) found.\x1b[0m`);
    } else {
      console.log(`\n\x1b[32mPASS: All clean.\x1b[0m`);
    }
  }

  if (FLAG_CHECK && exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
