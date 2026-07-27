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
  harness.ts          deterministic recorder, scoring, and comparison
  live-adapter.ts     optional live-model boundary (never used by CI)
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

- `skill` and `skillVersion` — the exact workflow revision under test
- `prompt` — the input that pressures the agent to skip the iron law
- `rubric` — the 5-point scoring criteria
- `expectedFailure` — what a "without skill" run looks like (RED baseline)
- `expectedCompliance` — what a "with skill" run should produce (GREEN)

The harness never invokes a model. A real Pi session or an explicitly
configured optional adapter captures each response; a human scorer records the
criteria that were met. `harness.ts` validates that adjudication, binds it to
the scenario and skill version, hashes the response, and writes a deterministic
run record. `results.md` records only completed paired comparisons.

## Offline validation and optional live runs

- **Offline CI is deterministic.** It validates scenario shape, explicit
  criterion names, score records, version matching, and comparison policy. It
  never makes a network or model call.
- **Live runs are optional.** Set `SKILL_EVAL_LIVE_ADAPTER` to a module that
  exports `runScenario({ scenario, condition })` only in a separately approved
  environment. Capture its response, then use the same offline recorder below.
- **Cost and judgment.** Each live scenario still requires a real subagent
  response and explicit human adjudication; no regex or model judge silently
  decides whether a criterion passed.
- **Subjectivity.** The rubric scores whether the agent *recognized* the
  pressure and *applied* the iron law. That's not a regex match; it's a
  judgment call. We do it by hand first, automate after the rubric is stable.
- **TDD's own red phase.** Per writing-skills: run RED (no skill) first,
  record the failure, then run GREEN (with skill), compare. The comparator
  rejects a with-skill record timestamped before its baseline and validates
  both stored scores against the same versioned rubric.

## Run It

```bash
# RED: baseline (no skill), after saving the actual response. `--met` is
# mandatory: use `none` when no rubric criterion was met.
node --import tsx tests/skill-eval/harness.ts \
  --scenario vfc-claim-done --condition baseline \
  --response-file /tmp/vfc-baseline.txt \
  --met none

# GREEN: with skill
node --import tsx tests/skill-eval/harness.ts \
  --scenario vfc-claim-done --condition with-skill \
  --response-file /tmp/vfc-with-skill.txt \
  --met iron-law-applied,rationalization-rejected,command-named,evidence-block-emitted

# Compare only version-compatible, scored records
node --import tsx tests/skill-eval/harness.ts compare \
  tests/skill-eval/runs/baseline-vfc-claim-done.json \
  tests/skill-eval/runs/with-skill-vfc-claim-done.json
```

The recorder rejects empty responses and unknown/duplicate criteria. The
comparator rejects malformed or re-ordered records, forged score summaries,
and attempts to compare a different scenario, skill, or skill version. Each
JSON record includes the response SHA-256 and explicit adjudicated criterion
names.

## Expanding the Harness

To add a new scenario:

1. Create `tests/skill-eval/scenarios/<skill-abbrev>-<pressure>.ts`.
2. Export `scenario`, `prompt`, `rubric`, `expectedFailure`, `expectedCompliance`.
3. Registration is automatic — `harness.ts` loads every `.ts` file in
   `scenarios/` at import time; the shape tests in `skill-eval.test.ts`
   run against each registered scenario (exports present, rubric weights
   sum to `maxScore`, pass descriptions substantive).
4. State the `skill` and `skillVersion`; the comparison refuses drift.
5. Run RED, then GREEN, score, record in `results.md`.

## Pass Criteria

A scenario is "passing" when:

- The baseline (no skill) run fails the rubric (score < 2/5).
- The with-skill run passes (score ≥ 4/5).
- The delta is at least 2 rubric points.
- The paired run records have the same scenario, skill, skill version, and
  rubric maximum.
- A second consecutive with-skill run also passes before claiming generality.

If any of these fail, the skill is *not* doing its job. Fix the skill, not
the rubric.
