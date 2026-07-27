/**
 * Reader for `{ "pi-harness": { ...flags } }` in `.pi/settings.json`.
 * Prompt-shaping and developer-only extensions are opt-in for consumers; the
 * source-checkout profile enables the features used to maintain this package.
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
   * Core UX (dcp, tui, checkpoint, rewind, safety, shortcut-continue,
   * herdr-state) remains registered by default or has its own environment
   * gate. Developer/telemetry integrations (diagnostics, integration,
   * usageTracker) default to OFF for consumers and are enabled in this repo's
   * source-checkout settings.
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
