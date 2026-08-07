/**
 * Deterministic, offline skill-eval recorder and comparator.
 *
 * It never decides whether prose met a rubric. A human (or an optional live
 * adapter) supplies the met criterion names; this module validates, persists,
 * and compares that adjudication reproducibly.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EVAL_SCHEMA_VERSION = 2;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const HARNESS_PACKAGE = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { name?: string; version?: string };

export interface Scenario {
  scenario: string;
  skill: string;
  skillVersion: string;
  prompt: string;
  expectedFailure: string;
  expectedCompliance: string;
  rubric: {
    maxScore: number;
    criteria: Array<{ name: string; weight: number; pass: string }>;
  };
}

export interface Score {
  score: number;
  max: number;
  details: Array<{ criterion: string; weight: number; met: boolean }>;
}

export interface ScoredRun {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  scenario: string;
  skill: string;
  skillVersion: string;
  model: string;
  promptSha256: string;
  harness: EvalHarnessProvenance;
  condition: "baseline" | "with-skill";
  responseFile: string;
  responseSha256: string;
  recordedAt: string;
  metCriteria: string[];
  score: Score;
}

export interface EvalHarnessProvenance {
  name: string;
  version: string;
  sourceSha256: string;
}

export const SCENARIOS: Record<string, Scenario> = {};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createEvalProvenance(
  scenario: Pick<Scenario, "prompt">,
  model: string,
): Pick<ScoredRun, "model" | "promptSha256" | "harness"> {
  if (!model.trim() || model.length > 200) throw new Error("Evaluation model must be explicit and bounded.");
  const harnessSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const name = HARNESS_PACKAGE.name;
  const version = HARNESS_PACKAGE.version;
  if (!name || !version) throw new Error("Evaluation harness package identity is unavailable.");
  return {
    model: model.trim(),
    promptSha256: sha256(scenario.prompt),
    harness: { name, version, sourceSha256: sha256(harnessSource) },
  };
}

async function loadScenarios(): Promise<void> {
  const dir = resolve(__dirname, "scenarios");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  for (const file of files) {
    const scenario = (await import(resolve(dir, file))) as Scenario;
    if (!scenario.scenario || !scenario.skill || !scenario.skillVersion || !scenario.prompt || !scenario.rubric) {
      throw new Error(`Scenario ${file} is missing required exports.`);
    }
    SCENARIOS[scenario.scenario] = scenario;
  }
}

function validateCriteria(scenario: Scenario, metCriteria: readonly string[]): void {
  const names = new Set(scenario.rubric.criteria.map((criterion) => criterion.name));
  const duplicate = metCriteria.find((name, index) => metCriteria.indexOf(name) !== index);
  if (duplicate) throw new Error(`Criterion ${duplicate} was adjudicated twice.`);
  const unknown = metCriteria.find((name) => !names.has(name));
  if (unknown) throw new Error(`Unknown criterion ${unknown} for ${scenario.scenario}.`);
}

/** Score a non-empty response against an explicit, human-adjudicated rubric. */
export function scoreWithCriteria(response: string, scenario: Scenario, metCriteria: readonly string[]): Score {
  if (!response.trim()) throw new Error("Cannot score an empty response.");
  validateCriteria(scenario, metCriteria);
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

function validateScoredRun(
  run: ScoredRun,
  expectedCondition: ScoredRun["condition"],
): Scenario {
  const scenario = SCENARIOS[run.scenario];
  if (run.schemaVersion !== EVAL_SCHEMA_VERSION || run.condition !== expectedCondition || !scenario) {
    throw new Error(`Invalid ${expectedCondition} run record.`);
  }
  if (run.skill !== scenario.skill) throw new Error("Run mismatch for skill.");
  if (run.skillVersion !== scenario.skillVersion) {
    throw new Error("Run mismatch for skillVersion.");
  }
  if (!run.model || run.model.length > 200) throw new Error("Invalid evaluation model provenance.");
  if (!DIGEST_PATTERN.test(run.promptSha256) || run.promptSha256 !== sha256(scenario.prompt)) {
    throw new Error("Run prompt digest does not match the versioned scenario prompt.");
  }
  if (
    !run.harness ||
    run.harness.name !== HARNESS_PACKAGE.name ||
    typeof run.harness.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(run.harness.version) ||
    !DIGEST_PATTERN.test(run.harness.sourceSha256)
  ) {
    throw new Error("Invalid evaluation harness provenance.");
  }
  if (
    typeof run.responseFile !== "string" ||
    run.responseFile.length === 0 ||
    !DIGEST_PATTERN.test(run.responseSha256) ||
    !Array.isArray(run.metCriteria)
  ) {
    throw new Error(`Invalid ${expectedCondition} response binding.`);
  }
  let response: string;
  try {
    response = readFileSync(resolve(run.responseFile), "utf8");
  } catch {
    throw new Error(`Cannot read persisted ${expectedCondition} response file.`);
  }
  const actualDigest = createHash("sha256").update(response).digest("hex");
  if (actualDigest !== run.responseSha256) {
    throw new Error(`Persisted ${expectedCondition} response SHA-256 digest does not match.`);
  }
  const recordedAt = Date.parse(run.recordedAt);
  if (
    !Number.isFinite(recordedAt) ||
    new Date(recordedAt).toISOString() !== run.recordedAt
  ) {
    throw new Error(`Invalid ${expectedCondition} recordedAt.`);
  }
  const expectedScore = scoreWithCriteria(
    response,
    scenario,
    run.metCriteria,
  );
  if (JSON.stringify(run.score) !== JSON.stringify(expectedScore)) {
    throw new Error(`Persisted ${expectedCondition} score does not match its versioned rubric.`);
  }
  return scenario;
}

/** Compare two persisted, version-bound adjudications for one scenario. */
export function compareRuns(baseline: ScoredRun, withSkill: ScoredRun) {
  const baselineScenario = validateScoredRun(baseline, "baseline");
  const withSkillScenario = validateScoredRun(withSkill, "with-skill");
  for (const key of ["scenario", "skill", "skillVersion", "model", "promptSha256"] as const) {
    if (baseline[key] !== withSkill[key]) throw new Error(`Run mismatch for ${key}.`);
  }
  if (JSON.stringify(baseline.harness) !== JSON.stringify(withSkill.harness)) {
    throw new Error("Run mismatch for harness provenance.");
  }
  if (baselineScenario !== withSkillScenario) throw new Error("Run mismatch for scenario.");
  if (baseline.score.max !== withSkill.score.max) throw new Error("Run mismatch for rubric maximum.");
  if (Date.parse(baseline.recordedAt) > Date.parse(withSkill.recordedAt)) {
    throw new Error("Baseline must be recorded before the with-skill run.");
  }
  const delta = withSkill.score.score - baseline.score.score;
  return {
    scenario: baseline.scenario,
    skill: baseline.skill,
    skillVersion: baseline.skillVersion,
    baselineScore: baseline.score.score,
    withSkillScore: withSkill.score.score,
    max: baseline.score.max,
    delta,
    meaningfulDifference: delta >= 2,
    passes: baseline.score.score < 2 && withSkill.score.score >= 4 && delta >= 2,
  };
}

interface RecordOptions {
  scenario: string;
  condition: "baseline" | "with-skill";
  responseFile: string;
  outFile?: string;
  metCriteria: string[];
  model: string;
}

function parseRecordArgs(argv: string[]): RecordOptions {
  const values = new Map<string, string>();
  const supplied = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    values.set(key, value);
    supplied.add(key);
  }
  const scenario = values.get("scenario");
  const condition = values.get("condition");
  const responseFile = values.get("response-file");
  const model = values.get("model");
  if (!scenario || !responseFile || !model || (condition !== "baseline" && condition !== "with-skill") || !supplied.has("met")) {
    throw new Error("Usage: harness.ts --scenario <name> --condition baseline|with-skill --model <provider/model> --response-file <path> --met <criterion,...|none> [--out <path>]");
  }
  const rawMet = values.get("met")!;
  return {
    scenario,
    condition,
    responseFile,
    model,
    outFile: values.get("out"),
    metCriteria: rawMet === "none" ? [] : rawMet.split(",").map((value) => value.trim()).filter(Boolean),
  };
}

export async function recordRun(options: RecordOptions): Promise<ScoredRun> {
  const scenario = SCENARIOS[options.scenario];
  if (!scenario) throw new Error(`Unknown scenario: ${options.scenario}`);
  const responsePath = resolve(options.responseFile);
  const response = await readFile(responsePath, "utf8");
  return {
    schemaVersion: EVAL_SCHEMA_VERSION,
    scenario: scenario.scenario,
    skill: scenario.skill,
    skillVersion: scenario.skillVersion,
    ...createEvalProvenance(scenario, options.model),
    condition: options.condition,
    responseFile: responsePath,
    responseSha256: createHash("sha256").update(response).digest("hex"),
    recordedAt: new Date().toISOString(),
    metCriteria: [...options.metCriteria],
    score: scoreWithCriteria(response, scenario, options.metCriteria),
  };
}

async function runCli(argv: string[]): Promise<void> {
  if (argv[0] === "compare") {
    if (argv.length !== 3) throw new Error("Usage: harness.ts compare <baseline-run.json> <with-skill-run.json>");
    const baseline = JSON.parse(await readFile(resolve(argv[1]!), "utf8")) as ScoredRun;
    const withSkill = JSON.parse(await readFile(resolve(argv[2]!), "utf8")) as ScoredRun;
    console.log(JSON.stringify(compareRuns(baseline, withSkill), null, 2));
    return;
  }
  const options = parseRecordArgs(argv);
  const run = await recordRun(options);
  const outFile = options.outFile ?? resolve(__dirname, "runs", `${options.condition}-${options.scenario}.json`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...run, outFile }, null, 2));
}

await loadScenarios();

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
