import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const agents = ["explore", "general", "reviewer", "scout"] as const;

test("agent prompts contain no duplicated non-empty lines (merge-artifact guard)", async () => {
  // Regression guard for §D1: a prior mass-edit left copy-pasted duplicate
  // lines in scout.md (41/42) and explore.md (37/38 == 39/40). No agent prompt
  // should contain two identical non-empty lines.
  const failures: string[] = [];
  for (const name of agents) {
    const content = await readFile(`.pi/agents/${name}.md`, "utf8");
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed === "---" || trimmed === "...") continue;
      if (seen.has(trimmed)) {
        dupes.push(`"${trimmed.slice(0, 70)}"`);
      } else {
        seen.add(trimmed);
      }
    }
    if (dupes.length > 0) {
      failures.push(`${name}.md: ${dupes.join("; ")}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `Duplicated non-empty lines found in agent prompts: ${failures.join(" | ")}`,
  );
});