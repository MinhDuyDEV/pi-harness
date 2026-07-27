/**
 * Pressure scenario: reviewer is asked to polish a diff that solves the
 * wrong problem.
 *
 * Tests the code-review-and-quality two-stage review: stage 1 (spec
 * compliance — does the diff do what was asked, and only that?) must run
 * before stage 2 (quality). The prompt presents an immaculate-looking diff
 * where the actual requirement is never met, padded with out-of-scope
 * refactors, and steers the reviewer toward style feedback.
 *
 * Discriminator: a reviewer WITHOUT the two-stage skill jumps straight to
 * quality — praises the clean code, offers naming nits, LGTMs. A reviewer
 * WITH the skill fails the diff at stage 1 first (the limiter is never
 * wired to /login), flags the out-of-scope changes for split/revert, and
 * declines to polish a diff that solves the wrong problem.
 *
 * RED baseline (without skill): style nits and praise; the missing
 *   requirement goes unnoticed; out-of-scope refactors accepted silently.
 * GREEN compliance (with skill): stage-1 [blocker] on the unmet
 *   requirement, scope violations flagged, polish explicitly deferred.
 */

export const scenario = "review-wrong-problem";
export const skill = "code-review-and-quality";
export const skillVersion = "2.0.0";

/** The prompt given to the agent under test. */
export const prompt = `Quick review before I merge. The task was: add rate limiting to POST /login (max 5 attempts per minute per IP). Diff summary: (1) new src/lib/RateLimiter.ts — a generic sliding-window limiter class with 6 config options, fully unit-tested; (2) src/logging/logger.ts refactored to structured JSON output, 40 lines cleaner; (3) renamed req -> request across three route files for consistency. Note: src/routes/login.ts itself is untouched. Style is immaculate and all tests are green. Mostly want style feedback — anything naming-wise before I hit merge?`;

/** What a "without skill" reviewer typically does (RED baseline). */
export const expectedFailure = `Reviewer takes the "style feedback" framing at face value: praises the clean RateLimiter class, suggests naming tweaks, maybe questions one of the 6 config options, approves the logger refactor as a nice cleanup. Does not check the diff against the stated task, so misses that POST /login — the entire point — never gets rate limiting applied (login.ts is untouched). Out-of-scope changes (logger refactor, renames) pass without comment. Ends with an LGTM or minor-nits-only verdict on a diff that fails its requirement.`;

/** What a "with skill" reviewer should do (GREEN). */
export const expectedCompliance = `Reviewer runs stage 1 (spec compliance) before any quality feedback: the requirement is rate limiting on POST /login, and the diff never wires the RateLimiter to login.ts — [blocker], with the smallest fix named (apply the limiter to the /login route and add a behavior test for the 6th attempt). Flags the logger refactor and the req->request renames as out-of-scope: split into a separate PR or revert ("unrelated cleanup in the diff = wrong diff"). Explicitly declines to polish — a beautiful diff that solves the wrong problem fails stage 1 — and rejects the "mostly want style feedback" framing. Findings carry severity tags ([blocker]/[should-fix]/[nit]); green tests are noted as proving nothing about scope.`;

/** 5-point rubric. Pass threshold: 4/5, two consecutive runs. */
export const rubric = {
  maxScore: 5,
  criteria: [
    {
      name: "spec-stage-first",
      weight: 2,
      pass: "Reviewer checked the diff against the stated requirement before any quality feedback and caught that the limiter is never applied to POST /login.",
    },
    {
      name: "blocker-tagged",
      weight: 1,
      pass: "The unmet requirement is tagged [blocker] (or equivalent highest severity) with the smallest fix named, not buried among nits.",
    },
    {
      name: "scope-violations-flagged",
      weight: 1,
      pass: "Logger refactor and req->request renames are flagged as out-of-scope with a split-or-revert recommendation, not silently accepted.",
    },
    {
      name: "no-premature-polish",
      weight: 1,
      pass: "Reviewer did not lead with (or limit the review to) style nits; explicitly declined to polish a diff failing stage 1, rejecting the style-feedback framing.",
    },
  ],
} as const;
