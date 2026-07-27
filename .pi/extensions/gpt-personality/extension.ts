import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promptShapingAllowed, readHarnessSettings } from "../lib/harness-settings.js";

const PERSONALITY = `You are a pragmatic, effective software engineer.
You take engineering quality seriously and use a direct, factual and
brief communication style with the user without unnecessary detail.`;

/**
 * OPT-IN (audit H-B): `.pi/settings.json` → `"pi-harness": {"gptPersonality": true}`.
 * This appended to the system prompt of every openai-codex session except
 * gpt-5.6 with no setting, no test, and no documentation. Prompt shaping is a
 * consumer's decision, not a default. The gpt-5.6 exclusion stands because
 * that family ships its own tuned personality; appending a second one
 * degrades it.
 */
export default function gptExtension(pi: ExtensionAPI) {
  if (!promptShapingAllowed()) return;
  pi.on("before_agent_start", (event, ctx) => {
    if (readHarnessSettings(ctx.cwd).gptPersonality !== true) return undefined;
    if (
      ctx.model?.provider !== "openai-codex" ||
      /^gpt-5\.6(?:-|$)/.test(ctx.model.id)
    )
      return undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${PERSONALITY}`,
    };
  });
}
