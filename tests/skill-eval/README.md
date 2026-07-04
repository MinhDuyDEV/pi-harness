# Skill Evaluation Harness

Pressure scenarios for testing whether skills actually change agent behavior.
The writing-skills Iron Law (RED baseline → GREEN minimal → REFACTOR loopholes)
applies here: a skill is "done" only when a subagent with the skill behaves
materially better than one without it on a designed pressure scenario.

## What This Is

A minimal harness. Two scenarios. Two skills. Two scoring rubrics. Expandable.

**Not** a full eval suite — that's the multi-week effort the deferral note
for P6 describes. This is the 2-3-scenario concrete next step the deferral
recommends as the right starting point in a fresh session.

## Structure

```
tests/skill-eval/
  README.md           this file
  harness.ts          runner, scoring, comparison
  scenarios/
    vfc-claim-done.ts  verification-before-completion pressure test
    tdd-skip.ts       test-driven-development pressure test
  results.md          human-eval scoring sheet
```

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

1. Create `tests/skill-eval/scenarios/<skill>-<pressure>.ts`.
2. Export `prompt`, `rubric`, `expectedFailure`, `expectedCompliance`.
3. Register it in `harness.ts` SCENARIOS map.
4. Add a test in `skill-eval.test.ts` asserting the scenario file has
   all four exports and the rubric sums to a meaningful total.
5. Run RED, then GREEN, score, record in `results.md`.

## Pass Criteria

A scenario is "passing" when:

- The baseline (no skill) run fails the rubric (score < 2/5).
- The with-skill run passes (score ≥ 4/5).
- The same prompt produces a materially different response (not a fluke).
- A second consecutive with-skill run also passes (not lucky).

If any of these fail, the skill is *not* doing its job. Fix the skill, not
the rubric.
