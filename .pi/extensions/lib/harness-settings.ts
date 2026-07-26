/**
 * Reader for the harness's own settings block in `.pi/settings.json`:
 * `{ "pi-harness": { ...flags } }`.
 *
 * Prompt-shaping extensions (superpi bootstrap, gpt-personality) are gated
 * through here as OPT-IN. They used to be on by default with at most an env
 * opt-out, while README/DESIGN promised the harness "never injects policy
 * into a consumer's system prompt" (audit H-A, H-B) — the docs described the
 * intended default, the code shipped the opposite. The harness's own
 * settings.json turns them on for this repo; a consumer who installs the
 * package gets no prompt injection until they say so.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessSettings {
  /** Inject the superpi routing bootstrap into sessions. Default false. */
  superpi?: boolean;
  /** Append the personality block for openai-codex models. Default false. */
  gptPersonality?: boolean;
}

export function readHarnessSettings(cwd: string = process.cwd()): HarnessSettings {
  try {
    const settings = JSON.parse(
      readFileSync(join(cwd, ".pi", "settings.json"), "utf8"),
    ) as { "pi-harness"?: unknown };
    const block = settings["pi-harness"];
    if (!block || typeof block !== "object" || Array.isArray(block)) return {};
    const record = block as Record<string, unknown>;
    return {
      ...(typeof record.superpi === "boolean" ? { superpi: record.superpi } : {}),
      ...(typeof record.gptPersonality === "boolean"
        ? { gptPersonality: record.gptPersonality }
        : {}),
    };
  } catch {
    return {};
  }
}
