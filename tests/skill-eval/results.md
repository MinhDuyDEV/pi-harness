# Skill Eval — Results

Per the writing-skills Iron Law, a skill is "done" only when a subagent with
the skill behaves *measurably* better than one without it on a designed
pressure scenario. This file records those measurements.

## How to Read

For each scenario:
- **Baseline** = subagent run *without* the skill, given the scenario prompt.
- **With-skill** = subagent run *with* the skill loaded, given the same prompt.
- **Delta** = with-skill score − baseline score.
- **Pass** = baseline < 2/5 AND with-skill ≥ 4/5 AND meaningful-difference ≥ 2.

Score from 0 to maxScore per the rubric in each scenario file. Each criterion
is binary (full weight or zero). Pass thresholds are the skill-eval test
harness defaults; adjust per scenario if a rubric is calibrated tighter.

## Recorded Runs

_(Empty. Add rows after each live run.)_

| Scenario | Date | Baseline | With-skill | Delta | Pass | Notes |
|---|---|---|---|---|---|---|
| vfc-claim-done | _TBD_ | _/_ | _/_ | _/_ | _TBD_ | _run the scenario_ |
| tdd-skip       | _TBD_ | _/_ | _/_ | _/_ | _TBD_ | _run the scenario_ |

## Run Template

When you run a scenario, append a row. Format:

```
| <scenario-name> | YYYY-MM-DD | <baseline-score>/<max> | <with-skill-score>/<max> | <delta> | yes/no | <one-line: what the agent did or didn't do> |
```

## What "Pass" Means in Practice

A passing scenario is **not** a final verdict. It means:

- The skill is doing its job on this specific prompt under these specific
  conditions. Pressure was applied, iron law held, agent emitted the
  expected artifact.
- The same prompt run twice in a row also passes (not a fluke).
- A close variant of the prompt also passes (not overfitted to this exact wording).

The third condition is what makes the harness expensive. A 1-prompt test
can be passed by accident. A 5-variant test requires the skill to actually
generalize.

## When a Skill Fails the Harness

The fix is almost always in the skill, not the rubric:

- **Baseline passes too** (agent already does the right thing) → the
  prompt isn't pressuring the right failure. Pick a sharper scenario.
- **With-skill fails** → the skill description isn't triggering, or the
  iron law is buried under verbose prose. Compress, sharpen the
  EXTREMELY-IMPORTANT markers, or move the iron law higher.
- **Delta is small** (both conditions score similarly) → the skill is
  *narrating* the iron law without enforcing it. Add a recipe with
  explicit anti-rationalization.
- **With-skill passes but with a different failure** (the agent finds
  a new way to fail) → the loophole is real. Write a REFACTOR scenario
  to close it, per writing-skills.

## Next Steps

To expand from the 2-scenario baseline:

1. Add 1-2 more scenarios per skill (different pressure modes).
2. Add 1-2 more skills to the harness (e.g. brainstorming, code-review).
3. Automate the run (the `task` tool is wired up; the harness just needs
   the runner script fleshed out).
4. Move from human-scored to model-scored once the rubric is stable
   (cheaper, more reproducible, but introduces its own biases).
