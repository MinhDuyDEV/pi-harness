// Skill compression tests — P3 (superpowers-inspired upgrades arc D)
//
// Contract: each "most-loaded" skill must be ≤ 600 words (body only, excluding
// Raised from 500 → 600 to accommodate the anti-rationalization-table section (see writing-skills "Anatomy Spec").
// YAML frontmatter) and must preserve the load-bearing compliance markers
// (iron laws, red flags, anti-patterns, signature terms). The word count is
// approximate — what matters is the spirit, not a strict CI battle over a few
// words — but the marker checks catch regressions where compression deletes
// the very things that make the skill work.
//
// See .pi/artifacts/TODO.md "P3+P6 focused execution" for the rationale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  MAX_DESCRIPTION_CHARS,
  MAX_VISIBLE_SKILLS,
  MIN_DESCRIPTION_HEADROOM,
  TARGET_WORD_CAP,
} from "../scripts/lib/skill-budget.mjs";

const SKILLS_DIR = resolve(import.meta.dirname, "../.pi/skills");

interface SkillSpec {
  name: string;
  maxWords: number;
  /** Compliance markers (case-insensitive substrings) that must survive compression. */
  markers: string[];
}

const TARGETS: SkillSpec[] = [
  {
    name: "artifact-format",
    maxWords: TARGET_WORD_CAP,
    markers: [
      "TODO.md",
      "PLAN.md",
      "PROGRESS.md",
      "DECISIONS.md",
      "status: active",
      "### YYYY-MM-DD",
    ],
  },
  {
    name: "brainstorming",
    maxWords: TARGET_WORD_CAP,
    markers: ["YAGNI", "variant", "interview", "reference"],
  },
  {
    name: "planning-and-task-breakdown",
    maxWords: TARGET_WORD_CAP,
    markers: ["most-likely-to-change", "mechanical", "plan", "spec"],
  },
  {
    name: "writing-skills",
    maxWords: TARGET_WORD_CAP,
    markers: ["Iron Law", "RED", "GREEN", "REFACTOR", "baseline", "pressure", "anatomy", "700"],
  },
  {
    name: "code-review-and-quality",
    maxWords: TARGET_WORD_CAP,
    markers: ["scope", "delete", "Bloat", "review", "gate", "duplication", "blocker", "spec compliance"],
  },
  {
    name: "debugging-and-error-recovery",
    maxWords: TARGET_WORD_CAP,
    markers: ["territory", "Retry", "escalat", "fallback", "red-capable", "feedback loop", "boundar", "hypothesi", "find-polluter", "regression"],
  },
  {
    name: "incremental-implementation",
    maxWords: TARGET_WORD_CAP,
    markers: ["smallest", "RED", "GREEN", "verify"],
  },
  {
    name: "verification-before-completion",
    maxWords: TARGET_WORD_CAP,
    markers: ["evidence", "assertion", "verif", "claim", "cap", "escalate", "iterat"],
  },
  // --- Batch 2: next 15 most-loaded (2026-07-04) ---
  {
    name: "test-driven-development",
    maxWords: TARGET_WORD_CAP,
    markers: ["RED", "GREEN", "REFACTOR", "Iron Law", "failing test", "behavior"],
  },
  {
    name: "inference-service",
    maxWords: TARGET_WORD_CAP,
    markers: ["queue", "circuit", "batching", "abort", "fallback"],
  },
  {
    name: "effect-service-patterns",
    maxWords: TARGET_WORD_CAP,
    markers: ["Tag", "Layer", "Effect", "errors as data", "any"],
  },
  {
    name: "design-taste-frontend",
    maxWords: TARGET_WORD_CAP,
    markers: ["typography", "whitespace", "spacing", "scale"],
  },
  {
    name: "typescript-coding-standards",
    maxWords: TARGET_WORD_CAP,
    markers: ["any", "errors as data", "branded", "pure"],
  },
  {
    name: "effect-schema",
    maxWords: TARGET_WORD_CAP,
    markers: ["Schema", "decodeUnknown", "branded", "TaggedError", "boundary"],
  },
  {
    name: "effect-http-api",
    maxWords: TARGET_WORD_CAP,
    markers: ["HttpApi", "endpoint", "schema", "error", "status"],
  },
  {
    name: "swiftui-expert-skill",
    maxWords: TARGET_WORD_CAP,
    markers: ["State", "Observable", "view", "state", "NavigationStack"],
  },
  {
    name: "high-end-visual-design",
    maxWords: TARGET_WORD_CAP,
    markers: ["typography", "restraint", "real", "premium", "agency"],
  },
  {
    name: "playwright",
    maxWords: TARGET_WORD_CAP,
    markers: ["locator", "role", "wait", "test", "user"],
  },
  {
    name: "customize-pi",
    maxWords: TARGET_WORD_CAP,
    markers: ["settings", "model", "context", "extension", "skill"],
  },
  {
    name: "security-and-hardening",
    maxWords: TARGET_WORD_CAP,
    markers: ["boundary", "authn", "authz", "secrets", "bcrypt", "rate limit"],
  },
  {
    name: "testing-anti-patterns",
    maxWords: TARGET_WORD_CAP,
    markers: ["tautology", "mock", "seam", "behavior", "production"],
  },
  // --- Batch 3: next 12 most-loaded (2026-07-04) ---
  {
    name: "figma",
    maxWords: TARGET_WORD_CAP,
    markers: ["FIGMA_API_KEY", "node_id", "tokens", "fetch"],
  },
  {
    name: "fallow",
    maxWords: TARGET_WORD_CAP,
    markers: ["dead", "dupes", "health", "format json", "evidence"],
  },
  {
    name: "code-cleanup",
    maxWords: TARGET_WORD_CAP,
    markers: ["lock behavior", "simplify", "delete", "verify", "scope"],
  },
  {
    name: "documentation-and-adrs",
    maxWords: TARGET_WORD_CAP,
    markers: ["ADR", "context", "consequences", "alternatives", "doc rot"],
  },
  {
    name: "deprecation-and-migration",
    maxWords: TARGET_WORD_CAP,
    markers: ["deprecate", "migration", "codemod", "changelog", "major"],
  },
  {
    name: "ci-cd-and-automation",
    maxWords: TARGET_WORD_CAP,
    markers: ["PR", "cache", "secret", "matrix", "deploy"],
  },
  {
    name: "opensrc",
    maxWords: TARGET_WORD_CAP,
    markers: ["source", "verify", "version", "test", "hypothesis"],
  },
  // --- Batch 4: next 12 most-loaded (2026-07-04) ---
  {
    name: "ast-grep",
    maxWords: TARGET_WORD_CAP,
    markers: ["pattern", "ast-grep", "structural", "rule", "rewrite"],
  },
  {
    name: "deep-module-design",
    maxWords: TARGET_WORD_CAP,
    markers: ["interface", "deep", "shallow", "module", "test seam"],
  },
  {
    name: "swift-concurrency",
    maxWords: TARGET_WORD_CAP,
    markers: ["actor", "Sendable", "Task", "isolation", "MainActor"],
  },
  {
    name: "frontend-design",
    maxWords: TARGET_WORD_CAP,
    markers: ["shadcn", "server component", "use client", "Tailwind", "shadcn/ui"],
  },
  {
    name: "pdf-extract",
    maxWords: TARGET_WORD_CAP,
    markers: ["pdfplumber", "scanned", "table", "OCR", "vision model"],
  },
  {
    name: "minimalist-ui",
    maxWords: TARGET_WORD_CAP,
    markers: ["whitespace", "monochrome", "bento", "rounded", "minimal"],
  },
  {
    name: "industrial-brutalist-ui",
    maxWords: TARGET_WORD_CAP,
    markers: ["mono", "border-radius", "hairline", "system chrome", "brutalist"],
  },
  {
    name: "cloudflare",
    maxWords: TARGET_WORD_CAP,
    markers: ["wrangler", "V8 isolate", "binding", "D1", "compatibility_date"],
  },
  {
    name: "improve-codebase-architecture",
    maxWords: TARGET_WORD_CAP,
    markers: ["refactor", "baseline", "smell", "strangler", "measure"],
  },
  {
    name: "using-git-worktrees",
    maxWords: TARGET_WORD_CAP,
    markers: ["worktree", "branch", "sibling", "prune", "isolation"],
  },
  {
    name: "spec-driven-development",
    maxWords: TARGET_WORD_CAP,
    markers: ["spec", "goal", "non-goals", "criteria", "interview"],
  },
  // --- Batch 5: next 12 most-loaded (2026-07-04) ---
  {
    name: "grill-me",
    maxWords: TARGET_WORD_CAP,
    markers: ["grill", "assumption", "question", "plan", "hole", "glossary", "ADR", "CONTEXT.md"],
  },
  {
    name: "react-best-practices",
    maxWords: TARGET_WORD_CAP,
    markers: ["server component", "useEffect", "bundle", "React.memo", "code-split"],
  },
  {
    name: "resend",
    maxWords: TARGET_WORD_CAP,
    markers: ["React Email", "templates", "inbound", "webhook", "send"],
  },
  {
    name: "superpi",
    maxWords: TARGET_WORD_CAP,
    markers: ["skill", "Pi", "routing", "optional", "available"],
  },
  {
    name: "obsidian",
    maxWords: TARGET_WORD_CAP,
    markers: ["note", "tag", "vault", "frontmatter", "MCP"],
  },
  {
    name: "aislop",
    maxWords: TARGET_WORD_CAP,
    markers: ["narrative", "console.log", "as any", "wrapper", "slop"],
  },
  {
    name: "core-data-expert",
    maxWords: TARGET_WORD_CAP,
    markers: ["fetch", "predicate", "migration", "merge", "batch"],
  },
  // --- Batch 6: final (2026-07-04) ---
  {
    name: "diagnostics",
    maxWords: TARGET_WORD_CAP,
    markers: ["diagnostics", "scope", "fallow", "typecheck", "lint"],
  },
  // --- Batch 7: overhaul additions — new + merged skills (2026-07-27) ---
  {
    name: "context-engineering",
    maxWords: TARGET_WORD_CAP,
    markers: ["CONFUSION:", "starvation", "flooding", "attention budget", "package.json"],
  },
  {
    name: "observability-and-instrumentation",
    maxWords: TARGET_WORD_CAP,
    markers: ["rate, errors, duration", "correlation", "cardinality", "hot loop", "p95"],
  },
  {
    name: "domain-modeling",
    maxWords: TARGET_WORD_CAP,
    markers: ["ubiquitous", "CONTEXT.md", "glossary", "aggregate", "value object"],
  },
  {
    name: "create-design-md",
    maxWords: TARGET_WORD_CAP,
    markers: ["normative", "observational", "token schema", "quality gate", "evidence"],
  },
  {
    name: "fixing-motion-performance",
    maxWords: TARGET_WORD_CAP,
    markers: ["compositor", "transform", "opacity", "will-change", "layout"],
  },
  {
    name: "supabase",
    maxWords: TARGET_WORD_CAP,
    markers: ["SUPABASE_ACCESS_TOKEN", "RLS", "rules/", "read_only", "get_advisors"],
  },
];

/** Count words in the body of a SKILL.md, excluding the YAML frontmatter (between the first two `---` markers). */
async function bodyWordCount(skillPath: string): Promise<number> {
  const text = await readFile(skillPath, "utf8");
  // Drop YAML frontmatter
  const fmEnd = text.indexOf("\n---", 4);
  if (text.startsWith("---") && fmEnd !== -1) {
    const body = text.slice(fmEnd + 4);
    return body.trim().split(/\s+/).filter(Boolean).length;
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function readBody(skillPath: string): Promise<string> {
  const text = await readFile(skillPath, "utf8");
  const fmEnd = text.indexOf("\n---", 4);
  if (text.startsWith("---") && fmEnd !== -1) {
    return text.slice(fmEnd + 4).toLowerCase();
  }
  return text.toLowerCase();
}

function descriptionFromFrontmatter(frontmatter: string): string {
  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^description:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const first = match[1].trim();
    const parts = first && !/^[>|][+-]?$/.test(first) ? [first] : [];
    while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
      parts.push(lines[++index].trim());
    }
    return parts.join(" ").replace(/^['"]|['"]$/g, "");
  }
  return "";
}

for (const spec of TARGETS) {
  test(`skill compression: ${spec.name} ≤ ${spec.maxWords} words`, async () => {
    const path = resolve(SKILLS_DIR, spec.name, "SKILL.md");
    const words = await bodyWordCount(path);
    assert.ok(
      words <= spec.maxWords,
      `${spec.name}/SKILL.md body is ${words} words (max ${spec.maxWords}). Compress further.`,
    );
  });

  test(`skill compression: ${spec.name} preserves load-bearing markers`, async () => {
    const path = resolve(SKILLS_DIR, spec.name, "SKILL.md");
    const body = await readBody(path);
    for (const marker of spec.markers) {
      assert.ok(
        body.includes(marker.toLowerCase()),
        `${spec.name}/SKILL.md is missing compliance marker "${marker}". Compression must not delete load-bearing content.`,
      );
    }
  });
}

test("model-visible skill catalog keeps count and description headroom", async () => {
  const entries = await Promise.all(
    (await (await import("node:fs/promises")).readdir(SKILLS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const text = await readFile(resolve(SKILLS_DIR, entry.name, "SKILL.md"), "utf8");
        const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
        const description = descriptionFromFrontmatter(frontmatter);
        return { hidden: /^disable-model-invocation:\s*true\s*$/m.test(frontmatter), description };
      }),
  );
  const visible = entries.filter((entry) => !entry.hidden);
  const chars = visible.reduce((total, entry) => total + entry.description.length, 0);
  assert.ok(visible.length < MAX_VISIBLE_SKILLS, `need a visible-skill slot: ${visible.length}/${MAX_VISIBLE_SKILLS}`);
  assert.ok(
    chars <= MAX_DESCRIPTION_CHARS - MIN_DESCRIPTION_HEADROOM,
    `need ${MIN_DESCRIPTION_HEADROOM} description characters of headroom: ${chars}/${MAX_DESCRIPTION_CHARS}`,
  );
});
