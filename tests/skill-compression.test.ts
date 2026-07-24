// Skill compression tests — P3 (superpowers-inspired upgrades arc D)
//
// Contract: each "most-loaded" skill must be ≤ 600 words (body only, excluding
// Raised from 500 → 600 to accommodate the anti-rationalization-table section (see skill-anatomy).
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
    maxWords: 600,
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
    maxWords: 600,
    markers: ["YAGNI", "variant", "interview", "reference"],
  },
  {
    name: "planning-and-task-breakdown",
    maxWords: 600,
    markers: ["most-likely-to-change", "mechanical", "plan", "spec"],
  },
  {
    name: "development-lifecycle",
    maxWords: 600,
    markers: [
      "/create",
      "/plan",
      "/ship",
      "/verify",
      "/research",
      "TODO.md",
      "PLAN.md",
      "PROGRESS.md",
      "DECISIONS.md",
      "### YYYY-MM-DD",
    ],
  },
  {
    name: "writing-skills",
    maxWords: 600,
    markers: ["Iron Law", "RED", "GREEN", "REFACTOR", "baseline", "pressure"],
  },
  {
    name: "code-review-and-quality",
    maxWords: 600,
    markers: ["scope", "delete", "Bloat", "review"],
  },
  {
    name: "debugging-and-error-recovery",
    maxWords: 600,
    markers: ["territory", "Retry", "escalat", "fallback"],
  },
  {
    name: "diagnose",
    maxWords: 600,
    markers: ["root cause", "trace", "instrument", "hypothesi"],
  },
  {
    name: "incremental-implementation",
    maxWords: 600,
    markers: ["smallest", "RED", "GREEN", "verify"],
  },
  {
    name: "verification-before-completion",
    maxWords: 600,
    markers: ["evidence", "assertion", "verif", "claim"],
  },
  // --- Batch 2: next 15 most-loaded (2026-07-04) ---
  {
    name: "test-driven-development",
    maxWords: 600,
    markers: ["RED", "GREEN", "REFACTOR", "Iron Law", "failing test", "behavior"],
  },
  {
    name: "inference-service",
    maxWords: 600,
    markers: ["queue", "circuit", "batching", "abort", "fallback"],
  },
  {
    name: "opencode-ts-service",
    maxWords: 600,
    markers: ["Tag", "Layer", "Effect", "errors as data", "any"],
  },
  {
    name: "design-taste-frontend",
    maxWords: 600,
    markers: ["typography", "whitespace", "spacing", "scale"],
  },
  {
    name: "opencode-ts-package",
    maxWords: 600,
    markers: ["exports", "workspace", "peerDependencies", "barrel"],
  },
  {
    name: "typescript-coding-standards",
    maxWords: 600,
    markers: ["any", "errors as data", "branded", "pure"],
  },
  {
    name: "effect-schema",
    maxWords: 600,
    markers: ["Schema", "decodeUnknown", "branded", "TaggedError", "boundary"],
  },
  {
    name: "redesign-existing-projects",
    maxWords: 600,
    markers: ["audit", "tokens", "component", "functionality"],
  },
  {
    name: "effect-http-api",
    maxWords: 600,
    markers: ["HttpApi", "endpoint", "schema", "error", "status"],
  },
  {
    name: "swiftui-expert-skill",
    maxWords: 600,
    markers: ["State", "Observable", "view", "state", "NavigationStack"],
  },
  {
    name: "high-end-visual-design",
    maxWords: 600,
    markers: ["typography", "restraint", "real", "premium", "agency"],
  },
  {
    name: "playwright",
    maxWords: 600,
    markers: ["locator", "role", "wait", "test", "user"],
  },
  {
    name: "customize-pi",
    maxWords: 600,
    markers: ["settings", "model", "context", "extension", "skill"],
  },
  {
    name: "security-and-hardening",
    maxWords: 600,
    markers: ["boundary", "authn", "authz", "secrets", "bcrypt", "rate limit"],
  },
  {
    name: "testing-anti-patterns",
    maxWords: 600,
    markers: ["tautology", "mock", "seam", "behavior", "production"],
  },
  // --- Batch 3: next 12 most-loaded (2026-07-04) ---
  {
    name: "figma",
    maxWords: 600,
    markers: ["FIGMA_API_KEY", "node_id", "tokens", "fetch"],
  },
  {
    name: "fallow",
    maxWords: 600,
    markers: ["dead", "dupes", "health", "format json", "evidence"],
  },
  {
    name: "code-cleanup",
    maxWords: 600,
    markers: ["lock behavior", "simplify", "delete", "verify", "scope"],
  },
  {
    name: "quality-loop",
    maxWords: 600,
    markers: ["iterate", "cap", "gate", "fix", "escalate"],
  },
  {
    name: "root-cause-tracing",
    maxWords: 600,
    markers: ["trace backward", "boundary", "hypothesis", "symptom", "regression test"],
  },
  {
    name: "documentation-and-adrs",
    maxWords: 600,
    markers: ["ADR", "context", "consequences", "alternatives", "doc rot"],
  },
  {
    name: "deprecation-and-migration",
    maxWords: 600,
    markers: ["deprecate", "migration", "codemod", "changelog", "major"],
  },
  {
    name: "api-and-interface-design",
    maxWords: 600,
    markers: ["contract", "version", "idempotency", "error", "schema"],
  },
  {
    name: "ci-cd-and-automation",
    maxWords: 600,
    markers: ["PR", "cache", "secret", "matrix", "deploy"],
  },
  {
    name: "defense-in-depth",
    maxWords: 600,
    markers: ["boundary", "validate", "schema", "trust", "constraints"],
  },
  {
    name: "performance-optimization",
    maxWords: 600,
    markers: ["measure", "baseline", "bottleneck", "Core Web Vitals", "algorithmic"],
  },
  {
    name: "opensrc",
    maxWords: 600,
    markers: ["source", "verify", "version", "test", "hypothesis"],
  },
  // --- Batch 4: next 12 most-loaded (2026-07-04) ---
  {
    name: "ast-grep",
    maxWords: 600,
    markers: ["pattern", "ast-grep", "structural", "rule", "rewrite"],
  },
  {
    name: "deep-module-design",
    maxWords: 600,
    markers: ["interface", "deep", "shallow", "module", "test seam"],
  },
  {
    name: "swift-concurrency",
    maxWords: 600,
    markers: ["actor", "Sendable", "Task", "isolation", "MainActor"],
  },
  {
    name: "frontend-design",
    maxWords: 600,
    markers: ["shadcn", "server component", "use client", "Tailwind", "shadcn/ui"],
  },
  {
    name: "pdf-extract",
    maxWords: 600,
    markers: ["pdfplumber", "scanned", "table", "OCR", "vision model"],
  },
  {
    name: "minimalist-ui",
    maxWords: 600,
    markers: ["whitespace", "monochrome", "bento", "rounded", "minimal"],
  },
  {
    name: "industrial-brutalist-ui",
    maxWords: 600,
    markers: ["mono", "border-radius", "hairline", "system chrome", "brutalist"],
  },
  {
    name: "cloudflare",
    maxWords: 600,
    markers: ["wrangler", "V8 isolate", "binding", "D1", "compatibility_date"],
  },
  {
    name: "improve-codebase-architecture",
    maxWords: 600,
    markers: ["refactor", "baseline", "smell", "strangler", "measure"],
  },
  {
    name: "using-git-worktrees",
    maxWords: 600,
    markers: ["worktree", "branch", "sibling", "prune", "isolation"],
  },
  {
    name: "agent-code-quality-gate",
    maxWords: 600,
    markers: ["gate", "scope", "duplication", "verification", "blocker"],
  },
  {
    name: "spec-driven-development",
    maxWords: 600,
    markers: ["spec", "goal", "non-goals", "criteria", "interview"],
  },
  // --- Batch 5: next 12 most-loaded (2026-07-04) ---
  {
    name: "grill-me",
    maxWords: 600,
    markers: ["grill", "assumption", "question", "plan", "hole"],
  },
  {
    name: "react-best-practices",
    maxWords: 600,
    markers: ["server component", "useEffect", "bundle", "React.memo", "code-split"],
  },
  {
    name: "design-system-audit",
    maxWords: 600,
    markers: ["token", "audit", "spec", "component", "breach"],
  },
  {
    name: "mockup-to-code",
    maxWords: 600,
    markers: ["design", "token", "component", "validate", "spec"],
  },
  {
    name: "resend",
    maxWords: 600,
    markers: ["React Email", "templates", "inbound", "webhook", "send"],
  },
  {
    name: "browser-tools",
    maxWords: 600,
    markers: ["browser", "Chrome", "macOS", "screenshot", "cookies"],
  },
  {
    name: "superpi",
    maxWords: 600,
    markers: ["skill", "Pi", "routing", "optional", "available"],
  },
  {
    name: "obsidian",
    maxWords: 600,
    markers: ["note", "tag", "vault", "frontmatter", "MCP"],
  },
  {
    name: "browser-testing-with-devtools",
    maxWords: 600,
    markers: ["browser", "DOM", "console", "network", "screenshot"],
  },
  {
    name: "accessibility-audit",
    maxWords: 600,
    markers: ["WCAG", "contrast", "keyboard", "focus", "label"],
  },
  {
    name: "aislop",
    maxWords: 600,
    markers: ["narrative", "console.log", "as any", "wrapper", "slop"],
  },
  {
    name: "core-data-expert",
    maxWords: 600,
    markers: ["fetch", "predicate", "migration", "merge", "batch"],
  },
  // --- Batch 6: final 2 (2026-07-04) ---
  {
    name: "stitch",
    maxWords: 600,
    markers: ["Stitch", "generate", "screen", "MCP"],
  },
  {
    name: "diagnostics",
    maxWords: 600,
    markers: ["diagnostics", "scope", "fallow", "typecheck", "lint"],
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
