/**
 * Skill evaluation harness runner.
 *
 * The actual `task` tool invocations live in a real pi session. This file
 * defines the shape of a run, the scenario registry, and the comparison
 * function. The test file `skill-eval.test.ts` validates the static scenario
 * exports; the human scorer runs the live conditions and records results
 * in `results.md`.
 *
 * See README.md for the full rationale and how to run a scenario.
 */

import { readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Shape every scenario file must export. */
export interface Scenario {
  scenario: string;
  prompt: string;
  expectedFailure: string;
  expectedCompliance: string;
  rubric: {
    maxScore: number;
    criteria: Array<{ name: string; weight: number; pass: string }>;
  };
}

/** Registry of all known scenarios. Populated at module load. */
export const SCENARIOS: Record<string, Scenario> = {};

/** Load all scenario files in `scenarios/` and register them. */
async function loadScenarios(): Promise<void> {
  const dir = resolve(__dirname, "scenarios");
  const files = (await readdir(dir)).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  for (const f of files) {
    const mod = await import(resolve(dir, f));
    const s = mod as Scenario;
    if (
      typeof s.scenario !== "string" ||
      typeof s.prompt !== "string" ||
      typeof s.expectedFailure !== "string" ||
      typeof s.expectedCompliance !== "string" ||
      typeof s.rubric !== "object"
    ) {
      throw new Error(`Scenario ${f} is missing required exports.`);
    }
    SCENARIOS[s.scenario] = s;
  }
}

/**
 * Score a response against a rubric. Returns the achieved score and a list
 * of criterion results. Each criterion is binary (0 or weight); the
 * `pass` string is the human-judgment description used in the README,
 * not parsed by the scorer.
 */
export function score(response: string, scenario: Scenario): {
  score: number;
  max: number;
  details: Array<{ criterion: string; weight: number; met: boolean }>;
} {
  // This is a placeholder for the static check. Live scoring is human-judgment
  // against the rubric criteria. The static scorer only verifies the shape
  // is parseable; a real scoring run is documented in results.md.
  return {
    score: 0,
    max: scenario.rubric.maxScore,
    details: scenario.rubric.criteria.map((c) => ({
      criterion: c.name,
      weight: c.weight,
      met: false,
    })),
  };
}

/** Compare baseline vs with-skill responses. */
export interface Comparison {
  scenario: string;
  baselineScore: number;
  withSkillScore: number;
  delta: number;
  meaningfulDifference: boolean;
}

export function compare(
  scenarioName: string,
  baselineResponse: string,
  withSkillResponse: string,
): Comparison | null {
  const s = SCENARIOS[scenarioName];
  if (!s) return null;
  const b = score(baselineResponse, s);
  const w = score(withSkillResponse, s);
  return {
    scenario: scenarioName,
    baselineScore: b.score,
    withSkillScore: w.score,
    delta: w.score - b.score,
    meaningfulDifference: w.score - b.score >= 2,
  };
}

// Bootstrap: load all scenarios on import.
await loadScenarios();
