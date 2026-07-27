# Skill Evaluation Harness

Pressure scenarios for testing whether skills actually change agent behavior.
The writing-skills Iron Law (RED baseline → GREEN minimal → REFACTOR loopholes)
applies here: a skill is "done" only when a subagent with the skill behaves
materially better than one without it on a designed pressure scenario.

## What This Is

A minimal harness. Five scenarios. Five skills. Five scoring rubrics. Expandable.

**Not** a full eval suite — that's the multi-week effort the deferral note
for P6 describes. This started as the 2-3-scenario concrete next step the
deferral recommends; the 2026-07 skills overhaul expanded it to cover the
merged skills.

## Structure

```
tests/skill-eval/
  README.md           this file
  harness.ts          runner, scoring, comparison
  scenarios/
    vfc-claim-done.ts        verification-before-completion: "just confirm done"
    tdd-skip.ts              test-driven-development: skip the failing test
    debug-no-repro.ts        debugging-and-error-recovery: patch without a red-capable command
    review-wrong-problem.ts  code-review-and-quality: polish a diff that misses the spec
    ctx-contradiction.ts     context-engineering: silent pick + guessed test command
  results.md          human-eval scoring sheet
```

## Scenario Index

| Scenario | Skill under test | Pressure applied | Discriminating marker |
|---|---|---|---|
| `vfc-claim-done` | verification-before-completion | "I'm in a hurry, just confirm done" | `<skill_result>` with non-empty `<evidence>` |
| `tdd-skip` | test-driven-development | "obvious fix, just make it pass" | visible RED before implementation |
| `debug-no-repro` | debugging-and-error-recovery | ready-made theory + "no time to reproduce" | "No red-capable command, no theory-building" gate |
| `review-wrong-problem` | code-review-and-quality | immaculate diff, "mostly want style feedback" | stage-1 spec check before any quality nit |
| `ctx-contradiction` | context-engineering | "pick whichever" + "npm test, don't go digging" | `CONFUSION:` callout + stack discovery |

## How a Scenario Works

Each scenario file exports:

- `prompt` — the input that pressures the agent to skip the iron law
- `rubric` — the 5-point scoring criteria
- `expectedFailure` — what a "without skill" run looks like (RED baseline)
- `expectedCompliance` — what a "with skill" run should produce (GREEN)

The harness `harness.ts` runs both conditions via the `task` tool and
records the responses. A human scorer (you) reads the responses and
fills out `results.md`.

## Why This Isn't Automated Yet

- **Cost.** Each scenario requires a real subagent run. A 2-scenario harness
  is 4 runs (with × without × 2 skills). A full eval suite is 10× that.
- **Subjectivity.** The rubric scores whether the agent *recognized* the
  pressure and *applied* the iron law. That's not a regex match; it's a
  judgment call. We do it by hand first, automate after the rubric is stable.
- **TDD's own red phase.** Per writing-skills: run RED (no skill) first,
  record the failure, then run GREEN (with skill), compare. The harness
  enforces the order.

## Run It

```bash
# RED: baseline (no skill)
node --import tsx tests/skill-eval/harness.ts --scenario vfc-claim-done --condition baseline

# GREEN: with skill
node --import tsx tests/skill-eval/harness.ts --scenario vfc-claim-done --condition with-skill

# Compare
diff tests/skill-eval/runs/baseline-vfc-claim-done.json \
     tests/skill-eval/runs/with-skill-vfc-claim-done.json
```

(Actually exercising the harness requires the `task` tool to be wired up
in a real pi session. The static `prompt` + `rubric` + `expectedFailure`
export is what the test file validates.)

## Expanding the Harness

To add a new scenario:

1. Create `tests/skill-eval/scenarios/<skill-abbrev>-<pressure>.ts`.
2. Export `scenario`, `prompt`, `rubric`, `expectedFailure`, `expectedCompliance`.
3. Registration is automatic — `harness.ts` loads every `.ts` file in
   `scenarios/` at import time; the shape tests in `skill-eval.test.ts`
   run against each registered scenario (exports present, rubric weights
   sum to `maxScore`, pass descriptions substantive).
4. If the scenario covers a new skill, add its prefix to the coverage
   test at the bottom of `skill-eval.test.ts`.
5. Run RED, then GREEN, score, record in `results.md`.

## Pass Criteria

A scenario is "passing" when:

- The baseline (no skill) run fails the rubric (score < 2/5).
- The with-skill run passes (score ≥ 4/5).
- The same prompt produces a materially different response (not a fluke).
- A second consecutive with-skill run also passes (not lucky).

If any of these fail, the skill is *not* doing its job. Fix the skill, not
the rubric.
