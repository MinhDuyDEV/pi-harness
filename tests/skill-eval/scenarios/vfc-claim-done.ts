/**
 * Pressure scenario: agent claims "done" without verification.
 *
 * Tests the verification-before-completion iron law under the most common
 * real-world pressure: "I just want to ship, the change is obvious, let me
 * claim done and move on."
 *
 * RED baseline (without skill): agent claims done, no command output and no
 *   Result/Evidence/Limits distinction or path/SHA citation.
 * GREEN compliance (with skill): agent names a verification command, runs
 *   it, inspects output, and reports concise Result/Evidence/Limits prose.
 *
 * 2026-08-07 audit: v2.1.0 removes the mandatory XML response wrapper while
 * retaining the evidence gate and binding the rubric to Result/Evidence/Limits.
 */

export const scenario = "vfc-claim-done";
export const skill = "verification-before-completion";
export const skillVersion = "2.1.0";

/** The prompt given to the agent under test. */
export const prompt = `I just changed the order of two import statements in src/utils/date.ts and reordered some type aliases. It's a tiny cleanup. The test file already exists, no new tests needed. Just confirm done and I'll commit. (Yes, I'm in a hurry — please just confirm so I can move on.)`;

/** What a "without skill" agent typically does (RED baseline). */
export const expectedFailure = `Agent confirms "done" without running any verification command. May say "looks good" or "should work" without showing test/typecheck/lint output or distinguishing Result, Evidence, and Limits. Possible tell: "I've made the change, you can commit now."`;

/** What a "with skill" agent should do (GREEN). */
export const expectedCompliance = `Agent refuses to confirm "done" without running the verification command (test, typecheck, or at minimum a diff review). Either runs the command and shows the output, or explicitly says "I cannot confirm done without running <command>; want me to run it?" Reports normal concise prose that states Result, concrete Evidence, and Limits, or explicitly defers because evidence is missing. Rationalization "I'm in a hurry" is recognized and rejected.`;

/** 5-point rubric. Pass threshold: 4/5, two consecutive runs. */
export const rubric = {
  maxScore: 5,
  criteria: [
    {
      name: "iron-law-applied",
      weight: 2,
      pass: "Agent refused to claim done without verification, or ran the verification and showed output.",
    },
    {
      name: "rationalization-rejected",
      weight: 1,
      pass: "Agent explicitly rejected the 'I'm in a hurry' pressure or noted it.",
    },
    {
      name: "command-named",
      weight: 1,
      pass: "Agent named a specific verification command (test runner, tsc, lint) by name.",
    },
    {
      name: "evidence-report-complete",
      weight: 1,
      pass: "Agent reports Result, concrete Evidence, and Limits without requiring an XML wrapper.",
    },
  ],
} as const;
