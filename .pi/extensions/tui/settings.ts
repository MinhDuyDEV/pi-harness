import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { readWorkingPaddingTop } from "./working-indicator.js";

export interface PiTuiSettings {
  /** Blank lines above the streaming "⠙ Working..." row (fixed-editor status slice + loader message). Default 1. */
  workingPaddingTop?: number;
  /**
   * Mirrors the top-level `terminal.showTerminalProgress` setting from
   * `.pi/settings.json`. When false (the default), the extension must not
   * emit OSC 9;4 progress sequences directly to stdout — the user has
   * explicitly opted out. Only `true` means "user wants the tab-bar progress".
   */
  showTerminalProgress?: boolean;
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

function findSettingsPath(cwd: string): string | null {
  let current = resolve(cwd);
  for (let depth = 0; depth < 8; depth++) {
    const nested = join(current, ".pi", "settings.json");
    if (existsSync(nested)) return nested;

    const direct = join(current, "settings.json");
    if (basename(current) === ".pi" && existsSync(direct)) return direct;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Read `terminal.showTerminalProgress` from the top-level `terminal` block.
 * Defaults to `false` (matches pi core's `getShowTerminalProgress()`), so an
 * absent key or a non-boolean value means "do not show".
 */
function readShowTerminalProgress(parsed: Record<string, unknown>): boolean {
  const term = parsed?.terminal;
  if (!term || typeof term !== "object") return false;
  return (term as Record<string, unknown>).showTerminalProgress === true;
}

export function readPiTuiSettings(cwd: string): PiTuiSettings {
  const settingsPath = findSettingsPath(cwd);
  if (!settingsPath) return { showTerminalProgress: false };

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
    const showTerminalProgress = readShowTerminalProgress(parsed);
    return {
      workingPaddingTop,
      showTerminalProgress,
      ...shortcuts,
    };
  } catch {
    return { workingPaddingTop: 1, showTerminalProgress: false };
  }
}

/** @deprecated Use readPiTuiSettings */
export const readAmpTuiSettings = readPiTuiSettings;
