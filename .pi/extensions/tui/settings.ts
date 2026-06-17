import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readWorkingPaddingTop } from "./working-indicator.js";

export interface PiTuiSettings {
  /** Blank lines above the streaming "⠙ Working..." row (fixed-editor status slice + loader message). Default 1. */
  workingPaddingTop?: number;
  keyboardScrollShortcuts?: {
    up: string;
    down: string;
    top?: string;
    bottom?: string;
  };
}

/** @deprecated Use PiTuiSettings */
export type AmpTuiSettings = PiTuiSettings;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPiTuiBlock(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const piTui = parsed?.piTui;
  if (piTui && typeof piTui === "object") return piTui as Record<string, unknown>;
  const legacy = parsed?.ampTui;
  if (legacy && typeof legacy === "object") return legacy as Record<string, unknown>;
  return undefined;
}

export function readPiTuiSettings(cwd: string): PiTuiSettings {
  const settingsPath = join(cwd, ".pi", "settings.json");
  if (!existsSync(settingsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    const block = readPiTuiBlock(parsed);
    const workingPaddingTop = readWorkingPaddingTop(block?.workingPaddingTop);
    const fixedEditor = block?.fixedEditor as Record<string, unknown> | undefined;
    const up = nonEmptyString(fixedEditor?.scrollChatUp);
    const down = nonEmptyString(fixedEditor?.scrollChatDown);
    const shortcuts =
      up && down
        ? {
            keyboardScrollShortcuts: {
              up,
              down,
              ...(nonEmptyString(fixedEditor?.scrollChatTop)
                ? { top: nonEmptyString(fixedEditor?.scrollChatTop)! }
                : {}),
              ...(nonEmptyString(fixedEditor?.scrollChatBottom)
                ? { bottom: nonEmptyString(fixedEditor?.scrollChatBottom)! }
                : {}),
            },
          }
        : {};
    return {
      workingPaddingTop,
      ...shortcuts,
    };
  } catch {
    return { workingPaddingTop: 1 };
  }
}

/** @deprecated Use readPiTuiSettings */
export const readAmpTuiSettings = readPiTuiSettings;