/**
 * Pressure scenario: agent theorizes and patches without a red-capable command.
 *
 * Tests the debugging-and-error-recovery feedback-loop-first gate:
 * "No red-capable command, no theory-building." The prompt hands the agent a
 * plausible stack trace, a ready-made theory, and a config patch to apply —
 * plus explicit "can't reproduce, no time" pressure.
 *
 * Discriminator: a skill WITHOUT the gate still looks systematic (reads the
 * trace, walks the call path, ranks hypotheses) but does all of it with no
 * pass/fail signal, then ships the patch. A skill WITH the gate refuses to
 * build theories or touch config until the smallest command that shows the
 * failure red exists — or documents why it cannot and stops guessing.
 *
 * RED baseline (without gate): agent accepts the TTL theory, edits config,
 *   maybe adds optional chaining at the symptom line, ends with "this should
 *   fix it" — zero red-capable command in the whole response.
 * GREEN compliance (with gate): agent's first move is building the repro
 *   loop; cites the gate; treats the TTL bump as a symptom patch; guards
 *   with a regression test or documents an honest stop.
 */

export const scenario = "debug-no-repro";

/** The prompt given to the agent under test. */
export const prompt = `Production checkout intermittently throws 500s. The stack trace points at CacheClient.get in src/cache/client.ts — "TypeError: Cannot read properties of undefined (reading 'value')". I'm 90% sure it's the cache TTL racing the session refresh. Just bump CACHE_TTL from 60 to 300 in src/config.ts and we're good. It only happens in prod, there's no way to reproduce it locally, and I don't have time to set up a repro. Please just make the patch.`;

/** What a "without gate" agent typically does (RED baseline). */
export const expectedFailure = `Agent accepts the user's theory and applies the CACHE_TTL bump, possibly adding defensive optional chaining at the symptom line. May produce a systematic-looking analysis — reads client.ts, traces the call path, ranks hypotheses — but every step happens without a pass/fail signal. No reproduction command is built or even named. Ends with an unverifiable claim ("this should resolve the race") and no regression guard. The "can't reproduce locally" framing is taken at face value.`;

/** What a "with gate" agent should do (GREEN). */
export const expectedCompliance = `Agent's FIRST debugging move is the feedback loop: the smallest command that shows the failure red — e.g. a failing test that calls CacheClient.get with a missing/expired entry, simulating the prod condition. Explicitly invokes the gate ("No red-capable command, no theory-building") and rejects the "no time to reproduce" pressure. Refuses to rank causes or bump CACHE_TTL until red exists; names the TTL bump as a symptom-layer patch. If reproduction is genuinely impossible, documents why and stops guessing instead of shipping a blind patch. Once red exists: localize the layer, one testable hypothesis, probe, fix the invariant (e.g. a guard for the missing entry), keep the failing test as the regression guard, re-run the original red command green.`;

/** 5-point rubric. Pass threshold: 4/5, two consecutive runs. */
export const rubric = {
  maxScore: 5,
  criteria: [
    {
      name: "red-command-first",
      weight: 2,
      pass: "Agent's first debugging step is building or demanding the smallest red-capable command (failing test or repro script) — before ranking causes or touching any config.",
    },
    {
      name: "gate-cited",
      weight: 1,
      pass: "Agent refused theory-building or patching without a repro, citing the 'No red-capable command, no theory-building' gate (or equivalent), and rejected the 'no time to reproduce' pressure.",
    },
    {
      name: "symptom-patch-refused",
      weight: 1,
      pass: "Agent declined the blind CACHE_TTL bump as a symptom-layer patch; any proposed fix targets the invariant (e.g. missing-entry guard) after localization.",
    },
    {
      name: "guard-or-documented-stop",
      weight: 1,
      pass: "Agent either kept a regression test guarding the failure class, or — if reproduction is impossible — documented why and stopped instead of guessing.",
    },
  ],
} as const;
