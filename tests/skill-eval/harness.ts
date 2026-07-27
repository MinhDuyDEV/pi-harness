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

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
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
 * Score a response with explicit human-marked criterion names. The rubric is
 * intentionally not guessed from prose: the evaluator supplies `metCriteria`
 * after reading the response, so recorded scores remain auditable.
 */
export function scoreWithCriteria(
  response: string,
  scenario: Scenario,
  metCriteria: readonly string[] = [],
): {
  score: number;
  max: number;
  details: Array<{ criterion: string; weight: number; met: boolean }>;
} {
  const met = new Set(metCriteria);
  const details = scenario.rubric.criteria.map((criterion) => ({
    criterion: criterion.name,
    weight: criterion.weight,
    met: met.has(criterion.name),
  }));
  return {
    score: details.reduce((total, detail) => total + (detail.met ? detail.weight : 0), 0),
    max: scenario.rubric.maxScore,
    details,
  };
}

/** Backwards-compatible shape check: no criteria means an unscored response. */
export function score(response: string, scenario: Scenario) {
  void response;
  return scoreWithCriteria(response, scenario);
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

interface CliOptions {
  scenario: string;
  condition: "baseline" | "with-skill";
  responseFile: string;
  outFile?: string;
  metCriteria: string[];
}

function parseCliArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? argv[++index];
    if (!value) throw new Error(`Missing value for --${key}`);
    values.set(key, value);
  }
  const scenario = values.get("scenario");
  const condition = values.get("condition");
  const responseFile = values.get("response-file");
  if (!scenario || !responseFile || (condition !== "baseline" && condition !== "with-skill")) {
    throw new Error(
      "Usage: harness.ts --scenario <name> --condition baseline|with-skill --response-file <path> [--met <criterion,...>] [--out <path>]",
    );
  }
  return {
    scenario,
    condition,
    responseFile,
    outFile: values.get("out"),
    metCriteria: (values.get("met") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  };
}

async function runCli(argv: string[]): Promise<void> {
  const options = parseCliArgs(argv);
  const scenario = SCENARIOS[options.scenario];
  if (!scenario) throw new Error(`Unknown scenario: ${options.scenario}`);
  const response = await readFile(resolve(options.responseFile), "utf8");
  const result = scoreWithCriteria(response, scenario, options.metCriteria);
  const record = {
    scenario: options.scenario,
    condition: options.condition,
    responseFile: resolve(options.responseFile),
    recordedAt: new Date().toISOString(),
    score: result,
  };
  const outFile = options.outFile
    ? resolve(options.outFile)
    : resolve(__dirname, "runs", `${options.condition}-${options.scenario}.json`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...record, outFile }, null, 2));
}

// Bootstrap: load all scenarios on import.
await loadScenarios();

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
