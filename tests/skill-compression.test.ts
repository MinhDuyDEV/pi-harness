// Skill compression tests — P3 (superpowers-inspired upgrades arc D)
//
// Contract: each "most-loaded" skill must be ≤ 500 words (body only, excluding
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
    maxWords: 500,
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
    maxWords: 500,
    markers: ["YAGNI", "variant", "interview", "reference"],
  },
  {
    name: "planning-and-task-breakdown",
    maxWords: 500,
    markers: ["most-likely-to-change", "mechanical", "plan", "spec"],
  },
  {
    name: "development-lifecycle",
    maxWords: 500,
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
    maxWords: 500,
    markers: ["Iron Law", "RED", "GREEN", "REFACTOR", "baseline", "pressure"],
  },
  {
    name: "code-review-and-quality",
    maxWords: 500,
    markers: ["scope", "delete", "Bloat", "review"],
  },
  {
    name: "debugging-and-error-recovery",
    maxWords: 500,
    markers: ["territory", "Retry", "escalat", "fallback"],
  },
  {
    name: "diagnose",
    maxWords: 500,
    markers: ["root cause", "trace", "instrument", "hypothesi"],
  },
  {
    name: "incremental-implementation",
    maxWords: 500,
    markers: ["smallest", "RED", "GREEN", "verify"],
  },
  {
    name: "verification-before-completion",
    maxWords: 500,
    markers: ["evidence", "assertion", "verif", "claim"],
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
