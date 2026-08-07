import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EVAL_SCHEMA_VERSION,
  SCENARIOS,
  compareRuns,
  createEvalProvenance,
  scoreWithCriteria,
  type ScoredRun,
} from "./harness.ts";

test("harness loads five versioned scenarios", () => {
  assert.equal(Object.keys(SCENARIOS).length, 5);
});

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(`scenario ${name} has a complete, versioned rubric`, () => {
    assert.equal(scenario.scenario, name);
    assert.match(scenario.skill, /^[a-z0-9][a-z0-9-]*$/);
    assert.match(scenario.skillVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(scenario.prompt.length > 50);
    assert.ok(scenario.expectedFailure.length > 50);
    assert.ok(scenario.expectedCompliance.length > 50);
    assert.equal(scenario.rubric.criteria.reduce((total, criterion) => total + criterion.weight, 0), scenario.rubric.maxScore);
    assert.ok(scenario.rubric.criteria.length >= 3);
    const skillSource = readFileSync(
      new URL(`../../.pi/skills/${scenario.skill}/SKILL.md`, import.meta.url),
      "utf8",
    );
    assert.match(skillSource, new RegExp(`^\\s+version: ${scenario.skillVersion.replaceAll(".", "\\.")}$`, "m"));
  });

  test(`scenario ${name} rejects missing, duplicate, and unknown adjudication`, () => {
    assert.throws(() => scoreWithCriteria("", scenario, []), /empty response/);
    const first = scenario.rubric.criteria[0]!.name;
    assert.throws(() => scoreWithCriteria("response", scenario, [first, first]), /twice/);
    assert.throws(() => scoreWithCriteria("response", scenario, ["not-a-criterion"]), /Unknown criterion/);
  });
}

test("comparison is deterministic and bound to the same scenario and skill version", () => {
  const scenario = SCENARIOS["vfc-claim-done"]!;
  const root = mkdtempSync(join(tmpdir(), "skill-eval-"));
  const baselineFile = join(root, "baseline.txt");
  const withSkillFile = join(root, "with-skill.txt");
  const baselineResponse = "baseline response";
  const withSkillResponse = "with skill response";
  writeFileSync(baselineFile, baselineResponse, "utf8");
  writeFileSync(withSkillFile, withSkillResponse, "utf8");
  const baseline: ScoredRun = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    scenario: scenario.scenario,
    skill: scenario.skill,
    skillVersion: scenario.skillVersion,
    ...createEvalProvenance(scenario, "openai/gpt-5.6"),
    condition: "baseline",
    responseFile: baselineFile,
    responseSha256: createHash("sha256").update(baselineResponse).digest("hex"),
    recordedAt: "2026-07-27T00:00:00.000Z",
    metCriteria: [],
    score: scoreWithCriteria("baseline response", scenario, []),
  };
  const withSkill: ScoredRun = {
    ...baseline,
    condition: "with-skill",
    responseFile: withSkillFile,
    responseSha256: createHash("sha256").update(withSkillResponse).digest("hex"),
    metCriteria: scenario.rubric.criteria.map((criterion) => criterion.name),
    score: scoreWithCriteria("with skill response", scenario, scenario.rubric.criteria.map((criterion) => criterion.name)),
  };
  try {
    assert.deepEqual(compareRuns(baseline, withSkill), {
      scenario: scenario.scenario,
      skill: scenario.skill,
      skillVersion: scenario.skillVersion,
      baselineScore: 0,
      withSkillScore: scenario.rubric.maxScore,
      max: scenario.rubric.maxScore,
      delta: scenario.rubric.maxScore,
      meaningfulDifference: true,
      passes: true,
    });
    assert.throws(() => compareRuns(baseline, { ...withSkill, skillVersion: "999.0.0" }), /skillVersion/);
    assert.throws(() => compareRuns(baseline, { ...withSkill, model: "another/model" }), /model/);
    assert.throws(
      () => compareRuns(baseline, { ...withSkill, promptSha256: "0".repeat(64) }),
      /prompt/i,
    );
    assert.throws(
      () => compareRuns(baseline, {
        ...withSkill,
        harness: { ...withSkill.harness, sourceSha256: "0".repeat(64) },
      }),
      /harness/i,
    );
    assert.throws(
      () => compareRuns(baseline, {
        ...withSkill,
        score: { ...withSkill.score, score: withSkill.score.score - 1 },
      }),
      /does not match its versioned rubric/,
    );
    assert.throws(
      () => compareRuns(
        { ...baseline, recordedAt: "2026-07-27T00:00:01.000Z" },
        withSkill,
      ),
      /Baseline must be recorded before/,
    );

    writeFileSync(withSkillFile, "tampered after recording", "utf8");
    assert.throws(() => compareRuns(baseline, withSkill), /SHA-256|digest/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness covers the core skills", () => {
  assert.deepEqual(
    new Set(Object.values(SCENARIOS).map((scenario) => scenario.skill)),
    new Set([
      "verification-before-completion",
      "test-driven-development",
      "debugging-and-error-recovery",
      "code-review-and-quality",
      "context-engineering",
    ]),
  );
});
