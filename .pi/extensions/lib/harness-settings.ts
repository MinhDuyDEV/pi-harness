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
  /**
   * Per-extension gates: `{ "pi-harness": { "extensions": { "<key>": boolean } } }`.
   * Provider extensions (deepseek, mimo, xai) default to OFF — a consumer who
   * installs the harness should not get third-party model providers registered
   * until they opt in. This repo's own settings.json turns them on.
   *
   * NOT gated here (future work, do not change without care): dcp, tui,
   * checkpoint, rewind — those are core UX and flipping their default to off
   * would break the current experience.
   */
  extensions?: Record<string, boolean>;
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
      ...(record.extensions !== undefined ? { extensions: readGates(record.extensions) } : {}),
    };
  } catch {
    return {};
  }
}

function readGates(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const gates: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") gates[key] = value;
  }
  return gates;
}

/**
 * Read the on/off gate for one extension key. `source` is either a project
 * cwd (settings are read from `<cwd>/.pi/settings.json`; omit for
 * `process.cwd()`) or an already-parsed {@link HarnessSettings}. A missing or
 * non-boolean gate yields `defaultValue`.
 */
export function readExtensionGate(
  source: string | HarnessSettings | undefined,
  extensionKey: string,
  defaultValue: boolean,
): boolean {
  const settings = typeof source === "object" ? source : readHarnessSettings(source);
  const gate = settings.extensions?.[extensionKey];
  return typeof gate === "boolean" ? gate : defaultValue;
}
