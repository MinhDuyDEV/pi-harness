/**
 * Static tests for the skill-eval harness.
 *
 * Validates that every scenario file exports the required shape (scenario,
 * prompt, expectedFailure, expectedCompliance, rubric), that the rubric
 * weights sum to a meaningful total, and that the harness loads cleanly.
 *
 * Live scoring (with-skill vs baseline) is human-judgment and recorded in
 * results.md. The point of these tests is to catch the harness itself
 * regressing, not to score individual scenarios.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, score, compare } from "./harness.ts";

test("harness loads at least 2 scenarios", () => {
  assert.ok(
    Object.keys(SCENARIOS).length >= 2,
    `Expected ≥2 scenarios, found ${Object.keys(SCENARIOS).length}: ${Object.keys(SCENARIOS).join(", ")}`,
  );
});

for (const [name, s] of Object.entries(SCENARIOS)) {
  test(`scenario "${name}" has all required exports`, () => {
    assert.ok(s.scenario === name, `scenario name mismatch: ${s.scenario} vs ${name}`);
    assert.ok(s.prompt.length > 50, "prompt must be substantive (>50 chars)");
    assert.ok(s.expectedFailure.length > 50, "expectedFailure must be substantive");
    assert.ok(s.expectedCompliance.length > 50, "expectedCompliance must be substantive");
    assert.ok(s.rubric.maxScore > 0, "rubric.maxScore must be > 0");
    assert.ok(s.rubric.criteria.length >= 3, "rubric must have ≥3 criteria");
  });

  test(`scenario "${name}" rubric weights sum to maxScore`, () => {
    const sum = s.rubric.criteria.reduce((acc, c) => acc + c.weight, 0);
    assert.equal(
      sum,
      s.rubric.maxScore,
      `rubric weights (${sum}) must equal maxScore (${s.rubric.maxScore})`,
    );
  });

  test(`scenario "${name}" rubric criteria have non-empty pass descriptions`, () => {
    for (const c of s.rubric.criteria) {
      assert.ok(c.pass.length > 20, `criterion "${c.name}" pass description too short`);
      assert.ok(c.weight > 0, `criterion "${c.name}" weight must be > 0`);
    }
  });

  test(`scenario "${name}" score() returns a valid shape`, () => {
    const result = score("sample response", s);
    assert.equal(result.max, s.rubric.maxScore);
    assert.equal(result.details.length, s.rubric.criteria.length);
    for (const d of result.details) {
      assert.equal(typeof d.met, "boolean");
    }
  });

  test(`scenario "${name}" compare() returns a meaningful-difference indicator`, () => {
    const c = compare(name, "no skill response", "with skill response");
    assert.ok(c !== null);
    assert.equal(c.scenario, name);
    assert.equal(typeof c.meaningfulDifference, "boolean");
  });
}

test("harness covers the core skills (vfc, tdd, debug, review, ctx)", () => {
  const names = Object.keys(SCENARIOS);
  // Naming convention: <skill-or-abbrev>-<pressure>
  const expected: Array<[string, string]> = [
    ["vfc-", "verification-before-completion"],
    ["tdd-", "test-driven-development"],
    ["debug-", "debugging-and-error-recovery"],
    ["review-", "code-review-and-quality"],
    ["ctx-", "context-engineering"],
  ];
  for (const [prefix, skill] of expected) {
    assert.ok(
      names.some((n) => n.startsWith(prefix)),
      `Expected a ${skill} scenario (prefix "${prefix}"); have: ${names.join(", ")}`,
    );
  }
});
