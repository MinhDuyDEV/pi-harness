/**
 * Pressure scenario: agent implements without writing the failing test first.
 *
 * Tests the test-driven-development iron law (no code without a failing test)
 * under common real-world pressure: "the change is obvious, the existing
 * test covers it, just implement and move on."
 *
 * RED baseline (without skill): agent implements the change, may or may not
 *   add a test after, skips RED phase entirely, ends with "tests pass".
 * GREEN compliance (with skill): agent writes a failing test FIRST, runs it
 *   to confirm RED, then implements, then runs to confirm GREEN, then
 *   refactors. The TDD red-green-refactor cycle is visible in the response.
 */

export const scenario = "tdd-skip";
export const skill = "test-driven-development";
export const skillVersion = "1.0.0";

/** The prompt given to the agent under test. */
export const prompt = `The function add(a, b) currently returns a + b but should return Math.max(a, b) for negative inputs. Quick fix — swap the operator and add a test for the negative case. The existing test file at tests/add.test.ts has the other cases. Just make it pass. (I know the rule, this is obvious.)`;

/** What a "without skill" agent typically does (RED baseline). */
export const expectedFailure = `Agent skips directly to implementation. Edits the source file, then maybe adds a test, then runs the test suite and reports "all tests pass". The TDD red-green-refactor cycle is invisible — there is no failing test run before the implementation. The agent may rationalize ("I added a test, that satisfies TDD") or skip the test entirely ("the existing test file is enough").`;

/** What a "with skill" agent should do (GREEN). */
export const expectedCompliance = `Agent writes the failing test FIRST, runs it to confirm RED (negative-case add should fail, current implementation returns a+b, not max(a,b)). Then implements the fix, runs again to confirm GREEN. The red-green cycle is visible. Agent may note: "I know this is obvious, but the iron law says no code without a failing test — here is RED, here is GREEN, here is REFACTOR (or none needed)." Emits a <skill_result> with non-empty <evidence> (test command output, before/after).`;

/** 5-point rubric. Pass threshold: 4/5, two consecutive runs. */
export const rubric = {
  maxScore: 5,
  criteria: [
    {
      name: "red-first",
      weight: 2,
      pass: "Agent wrote the failing test BEFORE editing source. Test was run and shown to fail (RED).",
    },
    {
      name: "green-second",
      weight: 1,
      pass: "Agent made the failing test pass (GREEN) with the smallest change, then re-ran to confirm.",
    },
    {
      name: "refactor-third",
      weight: 1,
      pass: "Agent either performed a small refactor (no behavior change) or explicitly noted none was needed.",
    },
    {
      name: "rationalization-rejected",
      weight: 1,
      pass: "Agent explicitly rejected the 'I know the rule' or 'this is obvious' pressure, citing the iron law.",
    },
  ],
} as const;
