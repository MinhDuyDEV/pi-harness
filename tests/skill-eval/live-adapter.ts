/**
 * Optional boundary for paid/live model execution.
 *
 * The deterministic harness never imports this module. A caller that wants to
 * execute a scenario must provide an adapter module via SKILL_EVAL_LIVE_ADAPTER
 * exporting `runScenario({ scenario, condition }): Promise<string>`, then feed
 * the captured response into `harness.ts` for explicit adjudication.
 */
import type { Scenario } from "./harness.ts";

export type LiveCondition = "baseline" | "with-skill";
export interface LiveAdapter {
  runScenario(input: { scenario: Scenario; condition: LiveCondition }): Promise<string>;
}

export async function loadLiveAdapter(): Promise<LiveAdapter> {
  const modulePath = process.env.SKILL_EVAL_LIVE_ADAPTER;
  if (!modulePath) {
    throw new Error(
      "Live evaluation is optional. Set SKILL_EVAL_LIVE_ADAPTER to an adapter module; offline rubric recording needs no model.",
    );
  }
  const loaded = await import(modulePath) as Partial<LiveAdapter>;
  if (typeof loaded.runScenario !== "function") {
    throw new Error("SKILL_EVAL_LIVE_ADAPTER must export runScenario({ scenario, condition }).");
  }
  return loaded as LiveAdapter;
}
