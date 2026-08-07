/**
 * Reader for `{ "pi-harness": { ...flags } }` in `.pi/settings.json`.
 * Prompt-shaping and developer-only extensions are opt-in for consumers; the
 * source-checkout profile enables the features used to maintain this package.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessSettings {
  /** Consumer extension bundle. Missing defaults to the `full` profile. */
  profile?: HarnessProfile;
  /** Inject the superpi routing bootstrap into sessions. Default false. */
  superpi?: boolean;
  /** Append the personality block for openai-codex models. Default false. */
  gptPersonality?: boolean;
  /**
   * Per-extension gates: `{ "pi-harness": { "extensions": { "<key>": boolean } } }`.
   * Core UX (dcp, checkpoint, rewind, safety, shortcut-continue,
   * herdr-state, workflow-state) is profile-controlled. The snap-edit port
   * (quick_edit/target_edit) is profile-controlled and defaults to the `full`
   * profile. Developer/telemetry integrations (diagnostics, integration,
   * usageTracker) default to OFF for consumers and are enabled in this repo's
   * source-checkout settings.
   */
  extensions?: Record<string, boolean>;
}

export type HarnessProfile = "full";
export type HarnessSeatRole = "root" | "implementer" | "peer" | "unknown";

const PROFILES = new Set<HarnessProfile>(["full"]);
const PROFILE_EXTENSIONS: Record<HarnessProfile, ReadonlySet<string>> = {
  full: new Set([
    "safety",
    "herdrState",
    "shortcutContinue",
    "checkpoint",
    "rewind",
    "learningCoordinator",
    "workflowState",
    "dcp",
    "continueAfterCompaction",
    "tps",
    "diagnostics",
    "integration",
    "usageTracker",
    "snapEdit",
  ]),
};
const WORKER_SAFE_EXTENSIONS = new Set(["safety", "herdrState"]);

export function readHarnessSettings(cwd: string = process.cwd()): HarnessSettings {
  try {
    const settings = JSON.parse(
      readFileSync(join(cwd, ".pi", "settings.json"), "utf8"),
    ) as { "pi-harness"?: unknown };
    const block = settings["pi-harness"];
    if (!block || typeof block !== "object" || Array.isArray(block)) return {};
    const record = block as Record<string, unknown>;
    return {
      ...(typeof record.profile === "string" && PROFILES.has(record.profile as HarnessProfile)
        ? { profile: record.profile as HarnessProfile }
        : {}),
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
  const seatRole = readHarnessSeatRole();
  if (seatRole !== "root" && !WORKER_SAFE_EXTENSIONS.has(extensionKey)) return false;
  const gate = settings.extensions?.[extensionKey];
  if (typeof gate === "boolean") return gate;
  if (settings.profile) return PROFILE_EXTENSIONS[settings.profile]?.has(extensionKey) ?? defaultValue;
  return defaultValue;
}

/**
 * Explicit seat role for a Herdr co-worker. Unknown values fail closed to a
 * worker-restricted role; absence preserves the ordinary interactive root.
 */
export function readHarnessSeatRole(): HarnessSeatRole {
  const value = process.env.PI_HARNESS_SEAT_ROLE;
  if (value === undefined || value === "" || value === "root") return "root";
  if (value === "implementer" || value === "peer") return value;
  return "unknown";
}

export function promptShapingAllowed(): boolean {
  return readHarnessSeatRole() === "root";
}
