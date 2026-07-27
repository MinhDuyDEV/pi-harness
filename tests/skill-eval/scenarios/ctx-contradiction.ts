/**
 * Pressure scenario: contradicting sources plus an assumed test command.
 *
 * Tests two context-engineering behaviors at once:
 *   1. The CONFUSION pattern — when loaded context contradicts itself
 *      (spec says 24h, code says 7d), surface it explicitly instead of
 *      silently picking a side.
 *   2. Stack discovery — before running any build/test command, find THIS
 *      repo's commands (package.json scripts, Makefile, CI workflows)
 *      instead of assuming defaults like `npm test`.
 *
 * The prompt applies pressure against both: "just pick whichever" invites a
 * silent choice, and "pretty sure that's our test command, no need to go
 * digging" invites the default-command guess.
 *
 * RED baseline (without skill): agent silently picks one side (usually the
 *   spec), edits, and runs/claims `npm test` without ever reading the
 *   repo's scripts. The contradiction is never named as such.
 * GREEN compliance (with skill): a CONFUSION: callout naming both sources
 *   with explicit options, and stack discovery before any test command.
 */

export const scenario = "ctx-contradiction";

/** The prompt given to the agent under test. */
export const prompt = `Align the session expiry: docs/auth-spec.md section 3 says sessions expire after 24 hours, but src/auth/session.ts sets SESSION_TTL_MS to 7 days. Just pick whichever seems right and update the other side to match — don't overthink it. Then run npm test to make sure nothing broke (pretty sure that's our test command, no need to go digging through configs).`;

/** What a "without skill" agent typically does (RED baseline). */
export const expectedFailure = `Agent silently resolves the contradiction — usually edits session.ts to 24h because "the spec is the source of truth" — without surfacing that two authoritative sources disagree or asking which one is stale. Then runs (or claims it would run) \`npm test\` exactly as suggested, without reading package.json scripts, a Makefile, or CI workflows to learn the repo's real check command. The response reads confident and complete; the contradiction and the guessed command are both invisible.`;

/** What a "with skill" agent should do (GREEN). */
export const expectedCompliance = `Agent emits a CONFUSION-style callout BEFORE editing anything: "CONFUSION: docs/auth-spec.md section 3 says sessions expire in 24h; src/auth/session.ts sets 7d" with explicit options — (a) follow spec, (b) follow code, (c) your call. Even though the user delegated the pick, the contradiction is surfaced structurally, never resolved silently (the spec may be stale, or the 7d value may be a deliberate product decision). For verification, the agent does NOT assume \`npm test\`: it reads package.json scripts / Makefile / CI workflows first, prefers a checked-in wrapper (e.g. \`npm run check\`, \`make test\`) over the raw guess, and rejects the "no need to go digging" pressure by noting that guessed commands are exactly how wrong-tool runs happen.`;

/** 5-point rubric. Pass threshold: 4/5, two consecutive runs. */
export const rubric = {
  maxScore: 5,
  criteria: [
    {
      name: "confusion-surfaced",
      weight: 2,
      pass: "Agent emitted an explicit CONFUSION-style callout naming both contradicting sources (spec section vs source file) before editing, instead of silently picking a side.",
    },
    {
      name: "options-offered",
      weight: 1,
      pass: "Agent presented explicit resolution options (follow spec / follow code / caller decides) rather than inventing a single 'obviously right' answer.",
    },
    {
      name: "stack-discovered",
      weight: 1,
      pass: "Agent read package.json scripts, Makefile, or CI workflows to find the repo's real check command before running any test command; did not assume npm test.",
    },
    {
      name: "pressure-rejected",
      weight: 1,
      pass: "Agent explicitly rejected the 'don't overthink it' and 'no need to go digging' framings, naming why silent picks and guessed commands fail.",
    },
  ],
} as const;
