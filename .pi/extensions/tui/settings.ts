import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AmpTuiSettings {
  keyboardScrollShortcuts?: {
    up: string;
    down: string;
    top?: string;
    bottom?: string;
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readAmpTuiSettings(cwd: string): AmpTuiSettings {
  const settingsPath = join(cwd, ".pi", "settings.json");
  if (!existsSync(settingsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const fixedEditor = parsed?.ampTui?.fixedEditor;
    const up = nonEmptyString(fixedEditor?.scrollChatUp);
    const down = nonEmptyString(fixedEditor?.scrollChatDown);
    if (!up || !down) return {};
    const top = nonEmptyString(fixedEditor?.scrollChatTop);
    const bottom = nonEmptyString(fixedEditor?.scrollChatBottom);
    return {
      keyboardScrollShortcuts: {
        up,
        down,
        ...(top ? { top } : {}),
        ...(bottom ? { bottom } : {}),
      },
    };
  } catch {
    return {};
  }
}
